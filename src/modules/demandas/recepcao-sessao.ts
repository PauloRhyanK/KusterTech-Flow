import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { moduloAtivo } from '@/lib/modulos'
import type { EntradaDaRecepcao } from '@/modules/fabrica/recepcao'
import { extrairTokenDaFabrica, hashDoTokenDaFabrica } from '@/modules/fabrica/model'
import { estadoNoFio } from '@/modules/fila-de-publicacao/contrato'
import { resumirErroParaLog } from '@/modules/github/model'
import { apagarArquivo } from './arquivos'
import {
  LIMITE_DO_CORPO_DA_DEMANDA,
  LIMITE_DO_CORPO_DO_PLANO,
  demandaDaSessaoSchema,
  planoDaSessaoSchema,
} from './contrato'
import type { EtapaDefinida } from './model'
import { abrirDemanda, guardarArquivo, paraOFio, registrarEvento } from './service'
import { avaliarArquivo } from './transicoes'

type Saida<S extends number> = { status: S; corpo: object }

const NAO_AUTORIZADO = { erro: 'Token inválido.' }
const NAO_ENCONTRADA = { erro: 'Demanda não encontrada.' }
const CORPO_INVALIDO = { erro: 'Corpo inválido.' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const instanteNoFio = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

async function autenticarFonteDeDemandas(
  authorization: string | null,
  agora: Date,
): Promise<{ id: string } | null> {
  const token = extrairTokenDaFabrica(authorization)
  if (token === null) return null
  const fonte = await db.fonteDeDemandas.findUnique({
    where: { tokenHash: hashDoTokenDaFabrica(token) },
    select: { id: true, revogadaEm: true },
  })
  if (!fonte || fonte.revogadaEm !== null) return null
  await db.fonteDeDemandas.update({ where: { id: fonte.id }, data: { ultimoUsoEm: agora } })
  return { id: fonte.id }
}

function falhaInterna(erro: unknown, o: string): Saida<500> {
  log.error({ erro: resumirErroParaLog(erro) }, `recepção de demandas das sessões falhou: ${o}`)
  return { status: 500, corpo: { erro: 'Falha interna.' } }
}

async function lerJson(
  e: EntradaDaRecepcao,
  limite: number,
  rotuloDoLimite: string,
): Promise<{ ok: true; json: unknown } | { ok: false; saida: Saida<413 | 415 | 422> }> {
  if (!(e.contentType ?? '').toLowerCase().includes('application/json')) {
    return {
      ok: false,
      saida: { status: 415, corpo: { erro: 'Envie o corpo como application/json.' } },
    }
  }
  const grande = { status: 413, corpo: { erro: `Corpo maior que ${rotuloDoLimite}.` } } as const
  if (e.contentLength !== null && Number(e.contentLength) > limite) {
    return { ok: false, saida: grande }
  }
  const texto = await e.corpo()
  if (Buffer.byteLength(texto, 'utf8') > limite) return { ok: false, saida: grande }
  try {
    return { ok: true, json: JSON.parse(texto) }
  } catch {
    return { ok: false, saida: { status: 422, corpo: CORPO_INVALIDO } }
  }
}

/** Tamanho decodificado de um base64 já validado pelo formato. */
function tamanhoDecodificado(b64: string): number {
  const preenchimento = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return (b64.length / 4) * 3 - preenchimento
}

async function localizarRepositorio(nome: string) {
  return db.repositorioGitHub.findFirst({
    where: {
      nomeCompleto: { equals: nome, mode: 'insensitive' },
      removidoDaInstalacaoEm: null,
      projetoId: { not: null },
      projeto: { is: { arquivadoEm: null } },
    },
    select: { id: true, projetoId: true },
  })
}

export async function receberDemandaDaSessao(
  e: EntradaDaRecepcao,
  agora: Date,
): Promise<Saida<200 | 201 | 401 | 404 | 413 | 415 | 422 | 500>> {
  try {
    const fonte = await autenticarFonteDeDemandas(e.authorization, agora)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }

    const lido = await lerJson(e, LIMITE_DO_CORPO_DA_DEMANDA, '42 MB')
    if (!lido.ok) return lido.saida
    const parse = demandaDaSessaoSchema.safeParse(lido.json)
    if (!parse.success) return { status: 422, corpo: CORPO_INVALIDO }
    const d = parse.data

    // Valida todos os anexos antes de gravar qualquer coisa: a demanda e os anexos entram juntos.
    const anexos: { nome: string; conteudo: string; bytes: Buffer }[] = []
    let usado = 0
    for (const a of d.anexos ?? []) {
      if (a.base64.length % 4 !== 0 || !BASE64.test(a.base64)) {
        return { status: 422, corpo: { erro: 'Anexo com base64 inválido.' } }
      }
      const tamanho = tamanhoDecodificado(a.base64)
      const av = avaliarArquivo({
        tipo: 'anexo',
        conteudo: a.conteudo,
        tamanho,
        usadoNaDemanda: usado,
      })
      if (!av.ok) return { status: 422, corpo: { erro: av.erro } }
      usado += tamanho
      anexos.push({ nome: a.nome, conteudo: a.conteudo, bytes: Buffer.from(a.base64, 'base64') })
    }

    const repositorio = await localizarRepositorio(d.repositorio)
    if (!repositorio?.projetoId) {
      return { status: 404, corpo: { erro: 'Repositório não encontrado.' } }
    }

    const aberta = await db.$transaction((tx) =>
      abrirDemanda(
        tx,
        {
          projetoId: repositorio.projetoId!,
          repositorioId: repositorio.id,
          titulo: d.titulo,
          descricao: d.descricao ?? null,
          tipo: d.tipo ?? null,
          nivel: d.nivel ?? null,
          temTela: d.temTela,
          origem: 'sessao',
          fonteId: fonte.id,
          chaveDaFonte: d.chave,
        },
        agora,
      ),
    )
    if (aberta.repetida) {
      return {
        status: 200,
        corpo: { id: aberta.id, etapa: 'recebida', url: `/demandas/${aberta.id}` },
      }
    }

    try {
      for (const a of anexos) {
        const r = await guardarArquivo({
          demandaId: aberta.id,
          arquivoId: randomUUID(),
          tipo: 'anexo',
          nome: a.nome,
          conteudo: a.conteudo,
          tamanhoDeclarado: a.bytes.byteLength,
          corpo: new Response(new Uint8Array(a.bytes)).body!,
          tela: null,
          enviadoPor: 'sessao',
          fonteId: fonte.id,
        })
        if (r.status !== 201) throw new ErroDeDominio((r.corpo as { erro: string }).erro)
      }
    } catch (erro) {
      // Nada entra pela metade: some a demanda (os arquivos gravados saem junto, com a linha).
      const gravados = await db.arquivoDaDemanda.findMany({
        where: { demandaId: aberta.id },
        select: { id: true },
      })
      await db.demanda.delete({ where: { id: aberta.id } })
      for (const g of gravados) await apagarArquivo(aberta.id, g.id)
      if (erro instanceof ErroDeDominio) return { status: 422, corpo: { erro: erro.message } }
      throw erro
    }
    return {
      status: 201,
      corpo: { id: aberta.id, etapa: 'recebida', url: `/demandas/${aberta.id}` },
    }
  } catch (erro) {
    return falhaInterna(erro, 'abrir demanda')
  }
}

export async function consultarDemandaDaSessao(
  authorization: string | null,
  id: string,
): Promise<Saida<200 | 401 | 404 | 500>> {
  try {
    const fonte = await autenticarFonteDeDemandas(authorization, new Date())
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }
    if (!UUID.test(id)) return { status: 404, corpo: NAO_ENCONTRADA }

    const d = await db.demanda.findUnique({
      where: { id },
      include: { repositorio: { select: { nomeCompleto: true } } },
    })
    if (!d) return { status: 404, corpo: NAO_ENCONTRADA }

    const etapa = (d.etapas as unknown as EtapaDefinida[]).find((x) => x.chave === d.etapaAtual)
    const pedido = moduloAtivo('fila-de-publicacao')
      ? await db.pedidoDePublicacao.findFirst({
          where: { demandaId: id },
          orderBy: { criadoEm: 'desc' },
          select: { estado: true, commit: true },
        })
      : null
    return {
      status: 200,
      corpo: {
        id: d.id,
        repositorio: d.repositorio.nomeCompleto,
        titulo: d.titulo,
        etapa: { chave: d.etapaAtual, nome: etapa?.nome ?? d.etapaAtual },
        destino: d.destino ? paraOFio.destino(d.destino) : null,
        nivel: paraOFio.nivel(d.nivel),
        temTela: d.temTela,
        espera: d.espera
          ? {
              tipo: d.espera,
              motivo: d.esperaMotivo,
              desde: instanteNoFio(d.esperaDesde ?? d.atualizadaEm),
            }
          : null,
        desenho:
          d.versaoDoDesenho > 0
            ? {
                versao: d.versaoDoDesenho,
                aprovada: d.desenhoAprovado === d.versaoDoDesenho,
                url: `/demandas/${d.id}/desenho`,
              }
            : null,
        artefato: d.artefatoUrl,
        plano: d.planoCaminho ? { caminho: d.planoCaminho, prUrl: d.planoPrUrl } : null,
        encerrada: d.encerrada,
        publicacao: pedido ? { estado: estadoNoFio(pedido.estado), commit: pedido.commit } : null,
        url: `/demandas/${d.id}`,
      },
    }
  } catch (erro) {
    return falhaInterna(erro, 'consulta')
  }
}

export async function receberPlanoDaSessao(
  authorization: string | null,
  id: string,
  e: EntradaDaRecepcao,
): Promise<Saida<200 | 201 | 401 | 404 | 409 | 413 | 415 | 422 | 500>> {
  try {
    const fonte = await autenticarFonteDeDemandas(authorization, new Date())
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }

    const lido = await lerJson(e, LIMITE_DO_CORPO_DO_PLANO, '16 KB')
    if (!lido.ok) return lido.saida
    const parse = planoDaSessaoSchema.safeParse(lido.json)
    if (!parse.success) return { status: 422, corpo: CORPO_INVALIDO }
    if (!UUID.test(id)) return { status: 404, corpo: NAO_ENCONTRADA }

    const { plano, resumo, artefato } = parse.data
    let r
    try {
      r = await registrarEvento({
        demandaId: id,
        idExterno: parse.data.id ?? randomUUID(),
        evento: {
          tipo: 'plano_entregue',
          dados: { plano, resumo: resumo ?? null, artefato: artefato ?? null },
          ator: 'sessao',
        },
        origem: 'sessao',
        em: new Date(),
        fonteId: fonte.id,
      })
    } catch (erro) {
      if (erro instanceof ErroDeDominio && erro.message === NAO_ENCONTRADA.erro) {
        return { status: 404, corpo: NAO_ENCONTRADA }
      }
      throw erro
    }
    switch (r.resultado) {
      case 'aplicado':
        return {
          status: 201,
          corpo: {
            resultado: 'aplicado',
            espera: r.estado.espera
              ? { tipo: r.estado.espera, motivo: r.estado.esperaMotivo }
              : null,
          },
        }
      case 'repetido':
        return { status: 200, corpo: { resultado: 'repetido' } }
      case 'conflito':
        return { status: 409, corpo: { erro: 'Evento com o mesmo id e conteúdo diferente.' } }
      case 'recusado':
        return { status: 409, corpo: { erro: r.motivo } }
    }
  } catch (erro) {
    return falhaInterna(erro, 'plano')
  }
}
