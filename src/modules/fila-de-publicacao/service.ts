import { randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { hashDoTokenDaFabrica, validarNomeDaFonteDaFabrica } from '@/modules/fabrica/model'
import { PREFIXO_DO_TOKEN_DE_PUBLICACAO } from './contrato'
import {
  MOTIVOS,
  validarHoraDoLote,
  validarUrlDaVersao,
  type EstadoDoPedido,
  type ModoDePublicacao,
} from './model'
import { filtroDoNoAr, ORDEM_DO_NO_AR } from './no-ar'
import { registrarChegada } from './recepcao'

// O token é devolvido só aqui; no banco fica apenas o hash (mesmo hash da Fábrica).
export async function criarFonteDePublicacao(
  sujeito: Sujeito,
  nome: string,
): Promise<{ id: string; token: string }> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  const validado = validarNomeDaFonteDaFabrica(nome)
  if (!validado.ok) throw new ErroDeDominio(validado.erro)

  const token = `${PREFIXO_DO_TOKEN_DE_PUBLICACAO}${randomBytes(32).toString('base64url')}`
  const criada = await db.fonteDePublicacao.create({
    data: {
      nome: validado.nome,
      tokenHash: hashDoTokenDaFabrica(token),
      criadaPorId: sujeito.usuarioId,
    },
    select: { id: true },
  })
  return { id: criada.id, token }
}

export async function revogarFonteDePublicacao(sujeito: Sujeito, fonteId: string): Promise<void> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  const { count } = await db.fonteDePublicacao.updateMany({
    where: { id: fonteId, revogadaEm: null },
    data: { revogadaEm: new Date() },
  })
  if (count > 0) return

  const existe = await db.fonteDePublicacao.findUnique({
    where: { id: fonteId },
    select: { id: true },
  })
  throw new ErroDeDominio(existe ? 'Esta fonte já foi revogada.' : 'Fonte não encontrada.')
}

export async function listarFontesDePublicacao(sujeito: Sujeito) {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  return db.fonteDePublicacao.findMany({
    orderBy: { criadoEm: 'desc' },
    select: { id: true, nome: true, criadoEm: true, ultimoUsoEm: true, revogadaEm: true },
  })
}

/**
 * Grava a pausa geral pedida (o que a pessoa viu na tela), sem alternar às cegas: com a tela
 * velha, "Pausar tudo" sobre uma pausa que já existe continua pausado. Já no estado pedido, nada
 * muda (o instante da pausa fica). Devolve o estado final.
 */
export async function definirPausaGeral(sujeito: Sujeito, pausar: boolean): Promise<boolean> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  await db.$transaction(async (tx) => {
    const atual = await tx.pausaGeralDePublicacao.findUnique({ where: { id: 1 } })
    if ((atual?.pausadaEm != null) === pausar) return
    const dados = pausar
      ? { pausadaEm: new Date(), pausadaPorId: sujeito.usuarioId }
      : { pausadaEm: null, pausadaPorId: null }
    await tx.pausaGeralDePublicacao.upsert({
      where: { id: 1 },
      create: { id: 1, ...dados },
      update: dados,
    })
  })
  return pausar
}

// A mesma trava por repositório da recepção e do worker.
function comTrava<T>(
  repositorioId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${repositorioId}))`
    return fn(tx)
  })
}

const SEM_CONFIGURACAO = 'A publicação deste repositório não está configurada.'

/** A fila parada volta a andar; o estado é revalidado sob a trava. */
export async function retomarFila(sujeito: Sujeito, repositorioId: string): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  await comTrava(repositorioId, async (tx) => {
    const config = await tx.configuracaoDePublicacao.findUnique({
      where: { repositorioId },
      select: { situacao: true },
    })
    if (!config) throw new ErroDeDominio(SEM_CONFIGURACAO)
    if (config.situacao !== 'PARADO') throw new ErroDeDominio('Esta fila não está parada.')
    await tx.configuracaoDePublicacao.update({
      where: { repositorioId },
      data: { situacao: 'NORMAL', situacaoDesde: new Date(), situacaoMotivo: null },
    })
  })
}

/**
 * Depois de um histórico reescrito: o que foi publicado antes de agora deixa de valer como "no ar".
 * Só age quando a regra 2 está de fato falhando: o último recusado depois da base é por histórico
 * reescrito e nada foi publicado depois dele (revalidado sob a trava).
 */
export async function redefinirNoAr(sujeito: Sujeito, repositorioId: string): Promise<void> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  await comTrava(repositorioId, async (tx) => {
    const config = await tx.configuracaoDePublicacao.findUnique({
      where: { repositorioId },
      select: { baseRedefinidaEm: true },
    })
    if (!config) throw new ErroDeDominio(SEM_CONFIGURACAO)
    const base = config.baseRedefinidaEm
    const recusado = await tx.pedidoDePublicacao.findFirst({
      where: {
        repositorioId,
        estado: 'RECUSADO',
        concluidoEm: base ? { gt: base } : { not: null },
      },
      orderBy: { concluidoEm: 'desc' },
      select: { motivo: true, concluidoEm: true },
    })
    const publicado = await tx.pedidoDePublicacao.findFirst({
      where: filtroDoNoAr(repositorioId, base),
      orderBy: ORDEM_DO_NO_AR,
      select: { concluidoEm: true },
    })
    const reescrito =
      recusado?.motivo === MOTIVOS.historicoReescrito &&
      recusado.concluidoEm !== null &&
      (publicado?.concluidoEm == null || publicado.concluidoEm < recusado.concluidoEm)
    if (!reescrito) {
      throw new ErroDeDominio(
        'O histórico de main não foi reescrito: não há o que redefinir neste repositório.',
      )
    }
    // A versão conferida no site também deixa de valer: ela saiu do histórico de main.
    await tx.configuracaoDePublicacao.update({
      where: { repositorioId },
      data: { baseRedefinidaEm: new Date(), versaoNoAr: null, versaoConferidaEm: null },
    })
  })
}

const PEDIDO_NAO_ENCONTRADO = 'Pedido não encontrado.'

/**
 * Muda o que ainda não começou: só vale para pedido NA_FILA e sem atendimento do worker. O estado
 * é lido e gravado sob a trava do repositório, a mesma do worker.
 */
async function alterarPedidoNaFila(
  pedidoId: string,
  dados: Prisma.PedidoDePublicacaoUpdateManyMutationInput,
  recusaDoEstado: (estado: string) => string,
): Promise<void> {
  const pedido = await db.pedidoDePublicacao.findUnique({
    where: { id: pedidoId },
    select: { repositorioId: true },
  })
  if (!pedido) throw new ErroDeDominio(PEDIDO_NAO_ENCONTRADO)

  await comTrava(pedido.repositorioId, async (tx) => {
    const { count } = await tx.pedidoDePublicacao.updateMany({
      where: { id: pedidoId, estado: 'NA_FILA', atendidoPorId: null },
      data: dados,
    })
    if (count > 0) return
    const atual = await tx.pedidoDePublicacao.findUnique({
      where: { id: pedidoId },
      select: { estado: true },
    })
    if (!atual) throw new ErroDeDominio(PEDIDO_NAO_ENCONTRADO)
    throw new ErroDeDominio(recusaDoEstado(atual.estado))
  })
}

const JA_EM_ANDAMENTO = 'Este pedido já está sendo publicado.'
const JA_ENCERRADO = 'Este pedido já foi atendido ou cancelado.'
// NA_FILA entra porque a recusa só chega aqui quando o worker já pegou o pedido (atendidoPorId).
const EM_ANDAMENTO = new Set(['NA_FILA', 'VERIFICANDO', 'PUBLICANDO'])

/** Troca o modo (imediato ou lote) de um pedido que ainda espera na fila. */
export async function mudarModoDoPedido(
  sujeito: Sujeito,
  pedidoId: string,
  modo: ModoDePublicacao,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')
  if (modo !== 'imediato' && modo !== 'lote') throw new ErroDeDominio('Modo inválido.')

  await alterarPedidoNaFila(pedidoId, { modo: modo === 'lote' ? 'LOTE' : 'IMEDIATO' }, (estado) =>
    EM_ANDAMENTO.has(estado) ? JA_EM_ANDAMENTO : JA_ENCERRADO,
  )
}

const MOTIVO_DO_CANCELAMENTO = 'Cancelado pelo Paulo.'
const PEDIDO_DO_CONSERTO = 'Este pedido faz parte de um conserto e não pode ser cancelado aqui.'

/** Cancela um pedido que ainda espera na fila; a correção de um conserto não se cancela por aqui. */
export async function cancelarPedido(sujeito: Sujeito, pedidoId: string): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const pedido = await db.pedidoDePublicacao.findUnique({
    where: { id: pedidoId },
    select: { consertoId: true },
  })
  if (pedido?.consertoId) throw new ErroDeDominio(PEDIDO_DO_CONSERTO)

  await alterarPedidoNaFila(
    pedidoId,
    { estado: 'CANCELADO', motivo: MOTIVO_DO_CANCELAMENTO, concluidoEm: new Date() },
    (estado) => (EM_ANDAMENTO.has(estado) ? JA_EM_ANDAMENTO : JA_ENCERRADO),
  )
}

const WORKFLOW = /^[A-Za-z0-9._-]+\.ya?ml$/
const ENTRADA_DO_COMMIT = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/
const DESCRICAO_DO_PUBLICAR_AGORA = 'Publicar agora'
const REPOSITORIO_FORA_DO_PROJETO = 'Este repositório não está vinculado a este projeto.'

export interface EntradaDaConfiguracaoDePublicacao {
  projetoId: string
  repositorioId: string
  workflow: string
  entradaDoCommit: string
  horaDoLote: string
  modoPadrao: ModoDePublicacao
  automatico: boolean
  pausado: boolean
}

/**
 * Cria ou atualiza a configuração do repositório, que precisa estar vinculado ao projeto (ativo).
 * A situação da fila (consertando, parado) e a base do "no ar" não mudam por aqui.
 */
export async function salvarConfiguracaoDePublicacao(
  sujeito: Sujeito,
  entrada: EntradaDaConfiguracaoDePublicacao,
): Promise<void> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const workflow = entrada.workflow.trim()
  const entradaDoCommit = entrada.entradaDoCommit.trim()
  if (!WORKFLOW.test(workflow)) {
    throw new ErroDeDominio(
      'Informe o arquivo do workflow em .github/workflows, como deploy.yml (termina em .yml ou .yaml).',
    )
  }
  if (!ENTRADA_DO_COMMIT.test(entradaDoCommit)) {
    throw new ErroDeDominio(
      'A entrada do commit é o nome de um input do workflow: letras, números, _ ou -, começando por letra.',
    )
  }
  if (!validarHoraDoLote(entrada.horaDoLote)) {
    throw new ErroDeDominio('Informe a hora do lote como HH:MM, de 00:00 a 23:59.')
  }
  if (entrada.modoPadrao !== 'imediato' && entrada.modoPadrao !== 'lote') {
    throw new ErroDeDominio('Modo padrão inválido.')
  }

  const dados = {
    workflow,
    entradaDoCommit,
    horaDoLote: entrada.horaDoLote,
    modoPadrao: entrada.modoPadrao === 'lote' ? ('LOTE' as const) : ('IMEDIATO' as const),
    automatico: entrada.automatico,
    pausado: entrada.pausado,
  }
  await comTrava(entrada.repositorioId, async (tx) => {
    const repositorio = await tx.repositorioGitHub.findFirst({
      where: {
        id: entrada.repositorioId,
        projetoId: entrada.projetoId,
        removidoDaInstalacaoEm: null,
        projeto: { is: { arquivadoEm: null } },
      },
      select: { id: true },
    })
    if (!repositorio) throw new ErroDeDominio(REPOSITORIO_FORA_DO_PROJETO)
    await tx.configuracaoDePublicacao.upsert({
      where: { repositorioId: repositorio.id },
      create: { repositorioId: repositorio.id, ...dados },
      update: dados,
    })
  })
}

/**
 * O endereço da versão no ar (`{"commit": "<sha>"}`) que o Flow confere depois de cada deploy.
 * Vazio desliga a conferência. Trocar o endereço descarta a versão conferida no antigo: até a
 * próxima conferência, nada é dispensado como "já está no ar".
 */
export async function definirUrlDaVersao(
  sujeito: Sujeito,
  entrada: { projetoId: string; repositorioId: string; urlDaVersao: string },
): Promise<void> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')

  const validada = validarUrlDaVersao(entrada.urlDaVersao)
  if (!validada.ok) throw new ErroDeDominio(validada.erro)

  await comTrava(entrada.repositorioId, async (tx) => {
    const config = await tx.configuracaoDePublicacao.findFirst({
      where: {
        repositorioId: entrada.repositorioId,
        repositorio: {
          projetoId: entrada.projetoId,
          removidoDaInstalacaoEm: null,
          projeto: { is: { arquivadoEm: null } },
        },
      },
      select: { urlDaVersao: true },
    })
    if (!config) throw new ErroDeDominio(SEM_CONFIGURACAO)
    if (config.urlDaVersao === validada.url) return
    await tx.configuracaoDePublicacao.update({
      where: { repositorioId: entrada.repositorioId },
      data: { urlDaVersao: validada.url, versaoNoAr: null, versaoConferidaEm: null },
    })
  })
}

/**
 * "Publicar agora": um pedido imediato da ponta de main (sem commit: o worker resolve o HEAD),
 * pela mesma chegada da API: sob a trava do repositório, um segundo clique vira `dispensado`.
 */
export async function publicarAgora(
  sujeito: Sujeito,
  repositorioId: string,
): Promise<{ id: string; estado: EstadoDoPedido; motivo: string | null }> {
  exigirPermissao(sujeito, 'projetos.gerenciar')

  const repositorio = await db.repositorioGitHub.findFirst({
    where: {
      id: repositorioId,
      removidoDaInstalacaoEm: null,
      projeto: { is: { arquivadoEm: null } },
    },
    select: {
      id: true,
      configuracaoDePublicacao: { select: { modoPadrao: true, baseRedefinidaEm: true } },
    },
  })
  if (!repositorio) {
    throw new ErroDeDominio('Este repositório não está vinculado a um projeto ativo.')
  }

  const chegada = await registrarChegada(
    repositorio.id,
    { usuarioId: sujeito.usuarioId },
    { modo: 'imediato', descricao: DESCRICAO_DO_PUBLICAR_AGORA },
    null,
    repositorio.configuracaoDePublicacao,
    new Date(),
  )
  switch (chegada.tipo) {
    case 'criado':
      return { id: chegada.id, estado: 'na_fila', motivo: null }
    case 'dispensado':
      return { id: chegada.id, estado: 'dispensado', motivo: chegada.motivo }
    case 'recusado':
      return { id: chegada.id, estado: 'recusado', motivo: chegada.motivo }
  }
}
