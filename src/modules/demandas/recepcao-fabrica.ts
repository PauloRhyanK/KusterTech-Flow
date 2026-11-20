import { Buffer } from 'node:buffer'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { autenticarFonte, type EntradaDaRecepcao } from '@/modules/fabrica/recepcao'
import { resumirErroParaLog } from '@/modules/github/model'
import { LIMITE_DA_PAGINA, LIMITE_DO_CORPO_DO_EVENTO, eventoDaFabricaSchema } from './contrato'
import {
  compararNaFila,
  etapasAplicaveis,
  modoDePublicacao,
  type Destino,
  type EtapaDefinida,
} from './model'
import { guardarArquivo, paraOFio, registrarEvento } from './service'

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

export async function buscarDemandasParaAFabrica(
  authorization: string | null,
  desde: string | null,
  agora: Date,
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
    const mudadas = await db.eventoDaDemanda.groupBy({
      by: ['demandaId'],
      where: { seq: { gt: inicio } },
      _min: { seq: true },
      _max: { seq: true },
      orderBy: { _min: { seq: 'asc' } },
      take: LIMITE_DA_PAGINA + 1,
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
      where: { id: { in: ids } },
      include: {
        repositorio: { select: { nomeCompleto: true } },
        projeto: { select: { nome: true } },
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
        cursor: String(cursor),
        mais,
        demandas: ordenadas.map(({ d, destino }) => {
          const etapas = etapasAplicaveis(d.etapas as unknown as EtapaDefinida[], d.temTela)
          const atual = etapas.find((e) => e.chave === d.etapaAtual)
          return {
            id: d.id,
            repositorio: d.repositorio.nomeCompleto,
            projeto: d.projeto.nome,
            titulo: d.titulo,
            descricao: d.descricao,
            tipo: d.tipo ? paraOFio.tipo(d.tipo) : null,
            destino,
            nivel: paraOFio.nivel(d.nivel),
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
          }
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
    const lido = eventoDaFabricaSchema.safeParse(json)
    if (!lido.success) return invalido
    if (!UUID.test(demandaId)) return { status: 404, corpo: NAO_ENCONTRADA }

    const { id, em, tipo, dados } = lido.data
    let r
    try {
      r = await registrarEvento({
        demandaId,
        idExterno: id,
        evento: { tipo, dados, ator: 'fabrica' } as Parameters<typeof registrarEvento>[0]['evento'],
        origem: 'fabrica',
        em: new Date(em),
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
): Promise<Saida<200 | 201 | 401 | 404 | 409 | 411 | 413 | 415 | 422 | 500>> {
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
    return falhaInterna(erro, 'arquivo')
  }
}
