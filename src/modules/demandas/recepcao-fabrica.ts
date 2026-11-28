import { Buffer } from 'node:buffer'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { ARMAZENAMENTO_NAO_CONFIGURADO, ArmazenamentoNaoConfigurado } from './arquivos'
import { log } from '@/lib/log'
import { autenticarFonte, type EntradaDaRecepcao } from '@/modules/fabrica/recepcao'
import { resumirErroParaLog } from '@/modules/github/model'
import {
  LIMITE_DA_PAGINA,
  LIMITE_DO_CORPO_DO_EVENTO,
  eventoDaFabricaSchema,
  eventoDaFabricaV2Schema,
} from './contrato'
import {
  compararNaFila,
  etapasAplicaveis,
  modoDePublicacao,
  type Destino,
  type EtapaDefinida,
} from './model'
import { guardarArquivo, paraOFio, registrarEvento } from './service'
import { demandaParaAFabrica, type ParteParaAFabrica } from './visao-da-fabrica'

type Saida<S extends number> = { status: S; corpo: object }

const NAO_AUTORIZADO = { erro: 'Token inválido.' }
const NAO_ENCONTRADA = { erro: 'Demanda não encontrada.' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOME_DE_ARQUIVO = /^[A-Za-z0-9._-]{1,100}$/
const MAIOR_SEQ = BigInt(2) ** BigInt(63) - BigInt(1)
const ORIGENS_PARA_A_FABRICA = ['paulo', 'sessao', 'flow']

const instanteNoFio = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

function falhaInterna(erro: unknown, o: string): Saida<500> {
  log.error({ erro: resumirErroParaLog(erro) }, `recepção de demandas da Fábrica falhou: ${o}`)
  return { status: 500, corpo: { erro: 'Falha interna.' } }
}

/** Lê o corpo como texto e para de ler ao passar do limite (devolve o que leu, já acima dele). */
export async function lerTextoComLimite(
  corpo: ReadableStream<Uint8Array> | null,
  limite: number,
): Promise<string> {
  if (corpo === null) return ''
  const leitor = corpo.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    partes.push(value)
    total += value.byteLength
    if (total > limite) {
      await leitor.cancel()
      break
    }
  }
  return Buffer.concat(partes).toString('utf8')
}

export async function buscarDemandasParaAFabrica(
  authorization: string | null,
  desde: string | null,
  agora: Date,
  contrato: 1 | 2 = 1,
): Promise<Saida<200 | 400 | 401 | 500>> {
  try {
    const fonte = await autenticarFonte(authorization)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }

    const texto = desde ?? '0'
    if (!/^\d{1,19}$/.test(texto) || BigInt(texto) > MAIOR_SEQ) {
      return { status: 400, corpo: { erro: 'Cursor inválido.' } }
    }
    const inicio = BigInt(texto)

    await db.fonteDaFabrica.update({
      where: { id: fonte.id },
      data: { demandasBuscadasEm: agora, ultimoUsoEm: agora },
    })

    // A página é pela ordem dos eventos (a primeira mudança depois do cursor), não pela fila:
    // assim o cursor avança sem pular nenhuma demanda. A fila ordena só dentro da página.
    // Trava exclusiva do fluxo de eventos: espera os escritores em andamento terminarem, para que
    // nenhum `seq` menor que o cursor devolvido ainda esteja para ser confirmado.
    const mudadas = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demanda-eventos'))`
      return tx.eventoDaDemanda.groupBy({
        by: ['demandaId'],
        // demandas do motor novo (Fábrica 2.0) nunca vão ao kit legado
        where: { seq: { gt: inicio }, demanda: { motor: 'legado' } },
        _min: { seq: true },
        _max: { seq: true },
        orderBy: { _min: { seq: 'asc' } },
        take: LIMITE_DA_PAGINA + 1,
      })
    })
    const mais = mudadas.length > LIMITE_DA_PAGINA
    const pagina = mudadas.slice(0, LIMITE_DA_PAGINA)
    // Com mais páginas o cursor para antes da primeira demanda que ficou de fora; sem mais, vai
    // até o maior seq devolvido. O que passar do cursor numa demanda da página volta na próxima.
    const cursor = mais
      ? mudadas[LIMITE_DA_PAGINA]!._min.seq! - BigInt(1)
      : pagina.reduce((m, g) => (g._max.seq! > m ? g._max.seq! : m), inicio)
    if (pagina.length === 0) {
      return { status: 200, corpo: { cursor: String(inicio), mais: false, demandas: [] } }
    }

    const ids = pagina.map((g) => g.demandaId)
    const demandas = await db.demanda.findMany({
      where: { id: { in: ids }, motor: 'legado' },
      include: {
        repositorio: { select: { nomeCompleto: true } },
        projeto: { select: { nome: true } },
        partes: {
          orderBy: [{ ordem: 'asc' }, { chave: 'asc' }],
          include: {
            repositorio: { select: { nomeCompleto: true } },
            pedidos: {
              orderBy: { criadoEm: 'desc' },
              take: 1,
              include: { conserto: { select: { estado: true, prUrl: true } } },
            },
          },
        },
        arquivos: {
          where: { tipo: 'ANEXO', apagadoEm: null },
          orderBy: { criadoEm: 'asc' },
          select: { id: true, nome: true, conteudo: true, tamanho: true },
        },
        eventos: {
          where: {
            OR: [
              { seq: { gt: inicio, lte: cursor }, origem: { in: ORIGENS_PARA_A_FABRICA } },
              { tipo: 'ajuste_pedido' },
            ],
          },
          orderBy: { seq: 'asc' },
        },
      },
    })

    // O escopo vem do último destino decidido pelo Paulo (pode estar fora da janela de eventos).
    const escopos = new Map<string, string | null>()
    const decididos = await db.eventoDaDemanda.findMany({
      where: { demandaId: { in: ids }, tipo: 'destino_decidido' },
      orderBy: { seq: 'asc' },
      select: { demandaId: true, dados: true },
    })
    for (const e of decididos) {
      const escopo = (e.dados as { escopo?: unknown } | null)?.escopo
      escopos.set(e.demandaId, typeof escopo === 'string' ? escopo : null)
    }

    const ordenadas = demandas
      .map((d) => ({ d, destino: d.destino ? paraOFio.destino(d.destino) : null }))
      .sort((a, b) =>
        compararNaFila(
          { destino: a.destino, criadaEm: a.d.criadaEm },
          { destino: b.destino, criadaEm: b.d.criadaEm },
        ),
      )

    return {
      status: 200,
      corpo: {
        ...(contrato === 2 ? { contrato: 2 } : {}),
        cursor: String(cursor),
        mais,
        demandas: ordenadas.map(({ d, destino }) => {
          const etapas = etapasAplicaveis(d.etapas as unknown as EtapaDefinida[], d.temTela)
          const atual = etapas.find((e) => e.chave === d.etapaAtual)
          const partes: ParteParaAFabrica[] = d.partes.map((p) => {
            const pedido = p.pedidos[0]
            return {
              chave: p.chave,
              repositorio: p.repositorio.nomeCompleto,
              objetivo: p.objetivo,
              ordem: p.ordem,
              dependeDe: p.dependeDe,
              chegaAoAr: p.chegaAoAr.toLowerCase() as 'publicacao' | 'versao',
              estado: p.estado.toLowerCase(),
              motivo: p.motivo,
              plano: p.planoCaminho ? { caminho: p.planoCaminho, prUrl: p.planoPrUrl } : null,
              prs: p.prs,
              commitAlvo: p.commitAlvo,
              publicacao: pedido
                ? {
                    pedidoId: pedido.id,
                    estado: pedido.estado.toLowerCase(),
                    motivo: pedido.motivo,
                    conserto: pedido.conserto
                      ? {
                          estado: pedido.conserto.estado.toLowerCase(),
                          prUrl: pedido.conserto.prUrl,
                        }
                      : null,
                  }
                : null,
            }
          })
          return demandaParaAFabrica(
            {
              id: d.id,
              repositorio: d.repositorio.nomeCompleto,
              projeto: d.projeto.nome,
              titulo: d.titulo,
              descricao: d.descricao,
              tipo: d.tipo ? paraOFio.tipo(d.tipo) : null,
              destino,
              escopo: escopos.get(d.id) ?? null,
              nivel: paraOFio.nivel(d.nivel),
              planejamentoPesado: d.planejamentoPesado,
              temTela: d.temTela,
              origem: paraOFio.origem(d.origem),
              criadaEm: instanteNoFio(d.criadaEm),
              etapas,
              etapaAtual: { chave: d.etapaAtual, marco: atual?.marco ?? null },
              espera: d.espera
                ? {
                    tipo: d.espera,
                    motivo: d.esperaMotivo,
                    desde: instanteNoFio(d.esperaDesde ?? d.atualizadaEm),
                  }
                : null,
              encerrada: d.encerrada,
              naoChegouDesde: d.naoChegouDesde ? instanteNoFio(d.naoChegouDesde) : null,
              desenho: { versao: d.versaoDoDesenho, aprovada: d.desenhoAprovado },
              ajustes: d.eventos
                .filter((e) => e.tipo === 'ajuste_pedido')
                .map((e) => {
                  const dados = e.dados as { versao: number; texto: string }
                  return { versao: dados.versao, texto: dados.texto, em: instanteNoFio(e.em) }
                }),
              plano: d.planoCaminho
                ? { caminho: d.planoCaminho, prUrl: d.planoPrUrl, artefato: d.artefatoUrl }
                : null,
              publicacao: { modo: modoDePublicacao(destino as Destino | null) },
              anexos: d.arquivos,
              eventos: d.eventos
                .filter(
                  (e) =>
                    e.seq > inicio && e.seq <= cursor && ORIGENS_PARA_A_FABRICA.includes(e.origem),
                )
                .map((e) => ({
                  id: e.idExterno,
                  tipo: e.tipo,
                  origem: e.origem,
                  em: instanteNoFio(e.em),
                  dados: e.dados,
                })),
            },
            partes,
            contrato,
          )
        }),
      },
    }
  } catch (erro) {
    return falhaInterna(erro, 'busca')
  }
}

export async function receberEventoDaFabrica(
  authorization: string | null,
  demandaId: string,
  e: EntradaDaRecepcao,
  contrato: 1 | 2 = 1,
): Promise<Saida<200 | 201 | 401 | 404 | 409 | 413 | 415 | 422 | 500>> {
  try {
    const fonte = await autenticarFonte(authorization)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }

    if (!(e.contentType ?? '').toLowerCase().includes('application/json')) {
      return { status: 415, corpo: { erro: 'Envie o corpo como application/json.' } }
    }
    const grande = { status: 413, corpo: { erro: 'Corpo maior que 64 KB.' } } as const
    if (e.contentLength !== null && Number(e.contentLength) > LIMITE_DO_CORPO_DO_EVENTO) {
      return grande
    }
    const texto = await e.corpo()
    if (Buffer.byteLength(texto, 'utf8') > LIMITE_DO_CORPO_DO_EVENTO) return grande

    const invalido = { status: 422, corpo: { erro: 'Corpo inválido.' } } as const
    let json: unknown
    try {
      json = JSON.parse(texto)
    } catch {
      return invalido
    }
    const lido = (contrato === 2 ? eventoDaFabricaV2Schema : eventoDaFabricaSchema).safeParse(json)
    if (!lido.success) return invalido
    if (!UUID.test(demandaId)) return { status: 404, corpo: NAO_ENCONTRADA }

    const { id, em, tipo, dados } = lido.data
    const motor = await db.demanda.findUnique({ where: { id: demandaId }, select: { motor: true } })
    if (motor?.motor === 'v2') {
      return { status: 409, corpo: { erro: 'Esta demanda é do motor novo da Fábrica.' } }
    }
    let r
    try {
      r = await registrarEvento({
        demandaId,
        idExterno: id,
        evento: { tipo, dados, ator: 'fabrica' } as Parameters<typeof registrarEvento>[0]['evento'],
        origem: 'fabrica',
        em: new Date(em),
        fonteId: fonte.id,
        contrato,
      })
    } catch (erro) {
      if (erro instanceof ErroDeDominio && erro.message === NAO_ENCONTRADA.erro) {
        return { status: 404, corpo: NAO_ENCONTRADA }
      }
      throw erro
    }
    switch (r.resultado) {
      case 'aplicado':
        await db.fonteDaFabrica.update({
          where: { id: fonte.id },
          data: { ultimoUsoEm: new Date() },
        })
        return { status: 201, corpo: { resultado: 'aplicado' } }
      case 'repetido':
        return { status: 200, corpo: { resultado: 'repetido' } }
      case 'conflito':
        return {
          status: 409,
          corpo: { erro: 'Evento com o mesmo id e conteúdo diferente.' },
        }
      case 'recusado':
        return { status: 422, corpo: { erro: r.motivo } }
    }
  } catch (erro) {
    return falhaInterna(erro, 'evento')
  }
}

export async function receberArquivoDaFabrica(
  authorization: string | null,
  demandaId: string,
  query: URLSearchParams,
  headers: Headers,
  corpo: ReadableStream<Uint8Array> | null,
): Promise<Saida<200 | 201 | 401 | 404 | 409 | 411 | 413 | 415 | 422 | 500 | 503>> {
  try {
    const fonte = await autenticarFonte(authorization)
    if (fonte === null) return { status: 401, corpo: NAO_AUTORIZADO }

    const id = query.get('id') ?? ''
    const tipo = query.get('tipo')
    const nome = query.get('nome') ?? ''
    const tela = query.get('tela')
    const parametrosOk =
      UUID.test(id) &&
      (tipo === 'desenho' || tipo === 'captura') &&
      NOME_DE_ARQUIVO.test(nome) &&
      (tipo === 'captura' ? tela === 'desktop' || tela === 'celular' : true) &&
      (tela === null || tela === 'desktop' || tela === 'celular')
    if (!parametrosOk || tipo === null) {
      return { status: 422, corpo: { erro: 'Parâmetros inválidos.' } }
    }
    if (!UUID.test(demandaId)) return { status: 404, corpo: NAO_ENCONTRADA }

    const comprimento = headers.get('content-length')
    if (comprimento === null || !/^\d{1,15}$/.test(comprimento)) {
      return { status: 411, corpo: { erro: 'Informe o Content-Length.' } }
    }
    if (corpo === null) return { status: 422, corpo: { erro: 'Corpo inválido.' } }
    const conteudo = (headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()

    let r
    try {
      r = await guardarArquivo({
        demandaId,
        arquivoId: id,
        tipo,
        nome,
        conteudo,
        tamanhoDeclarado: Number(comprimento),
        corpo,
        tela: tipo === 'captura' ? (tela as 'desktop' | 'celular') : null,
        enviadoPor: 'fabrica',
        fonteId: fonte.id,
      })
    } catch (erro) {
      if (erro instanceof ErroDeDominio && erro.message === NAO_ENCONTRADA.erro) {
        return { status: 404, corpo: NAO_ENCONTRADA }
      }
      throw erro
    }
    if (r.status !== 200 && r.status !== 201) return { status: r.status, corpo: r.corpo }
    const gravado = await db.arquivoDaDemanda.findUniqueOrThrow({
      where: { id },
      select: { tamanho: true },
    })
    return { status: r.status, corpo: { id, tamanho: gravado.tamanho } }
  } catch (erro) {
    if (erro instanceof ArmazenamentoNaoConfigurado) {
      return { status: 503, corpo: { erro: ARMAZENAMENTO_NAO_CONFIGURADO } }
    }
    return falhaInterna(erro, 'arquivo')
  }
}
