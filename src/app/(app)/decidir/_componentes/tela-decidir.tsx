'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { respostasDoItem, type ItemDaPilha } from '@/modules/decidir/model'
import {
  abrirItemAcao,
  ajustarCartaoAcao,
  confirmarCartaoAcao,
  enviarMensagemAcao,
  responderRapidoAcao,
  trazerDeVoltaAcao,
} from '../actions'
import { CabecalhoDoItem } from './cabecalho-do-item'
import {
  CartaoDeFecho,
  FormularioDoCartao,
  type CartaoNaTela,
  type InicialDoCartao,
} from './cartao-de-fecho'
import { Compositor, type EnvioDoCompositor } from './compositor'
import { Conversa, type MensagemNaTela, type RespostaDoFlow } from './conversa'
import { FaixaDoCelular, Guardados, Pilha, textoDaPosicao } from './pilha'
import { Rodape } from './rodape'

/** Intervalo da consulta da conversa enquanto a aba está visível. */
export const INTERVALO_DA_CONSULTA_MS = 2000

// Mesma chave de `RESPONDER_COM_MENSAGEM` do service (que não entra no pacote do navegador).
const RESPONDER_COM_MENSAGEM: RespostaDoFlow = {
  chave: 'responder_com_mensagem',
  rotulo: 'Responder com a minha mensagem',
}
const DESTINOS = ['urgente', 'lote_da_noite', 'fila_de_agentes']

function respostasDoFlow(item: ItemDaPilha): readonly RespostaDoFlow[] {
  return item.tipo === 'decisao_da_fabrica' ? [RESPONDER_COM_MENSAGEM] : respostasDoItem(item)
}

/** O cartão a montar quando a resposta rápida ainda precisa de um campo (`faltam`). */
function inicialDaResposta(item: ItemDaPilha, chave: string): InicialDoCartao {
  if (DESTINOS.includes(chave)) {
    return {
      acao: 'destino',
      destino: chave,
      nivel: item.ref.tipo === 'demanda' ? item.ref.nivel : null,
    }
  }
  if (chave === RESPONDER_COM_MENSAGEM.chave) return { acao: 'responder' }
  return { acao: chave as InicialDoCartao['acao'] }
}

function inicialDoCartao(c: CartaoNaTela['conteudo']): InicialDoCartao {
  const campos = c as unknown as Record<string, unknown>
  const texto = (k: string) => (typeof campos[k] === 'string' ? (campos[k] as string) : null)
  return {
    acao: c.acao,
    destino: texto('destino'),
    nivel: texto('nivel'),
    tipoDeDemanda: texto('tipoDeDemanda'),
    escopo: texto('escopo'),
    resposta: texto('resposta'),
    texto: texto('texto'),
  }
}

/** Seta não troca de item quando a pessoa está escrevendo. */
function escrevendo(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false
  return (
    alvo.isContentEditable ||
    alvo instanceof HTMLTextAreaElement ||
    alvo instanceof HTMLInputElement ||
    alvo instanceof HTMLSelectElement
  )
}

interface RespostaDaConsulta {
  mensagens: (Omit<MensagemNaTela, 'em'> & { em: string })[]
  cartao: CartaoNaTela | null
  aguardaAgenteDesde: string | null
  atendenteBuscouEm: string | null
  encerrada: boolean
}

const data = (s: string | null) => (s === null ? null : new Date(s))

export interface PropsDaTela {
  itens: ItemDaPilha[]
  guardados: ItemDaPilha[]
  /** Chave do item → id da conversa aberta dele. */
  conversas: Record<string, string>
  inicial: string | null
  podeAgir: boolean
}

export function TelaDecidir({ itens, guardados, conversas, inicial, podeAgir }: PropsDaTela) {
  const router = useRouter()
  const [chave, setChave] = useState<string | null>(inicial ?? itens[0]?.chave ?? null)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, iniciar] = useTransition()

  // Depois de uma escrita a pilha volta do servidor; se o item saiu, mostra o primeiro.
  const achado = itens.findIndex((i) => i.chave === chave)
  const atual = achado >= 0 ? achado : 0
  const item = itens[atual]

  const irPara = useCallback(
    (indice: number) => {
      const alvo = itens[Math.max(0, Math.min(itens.length - 1, indice))]
      if (!alvo) return
      setErro(null)
      setChave(alvo.chave)
      window.history.replaceState(null, '', `/decidir?item=${encodeURIComponent(alvo.chave)}`)
    },
    [itens],
  )

  useEffect(() => {
    const teclar = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (e.altKey || e.ctrlKey || e.metaKey || escrevendo(e.target)) return
      e.preventDefault()
      irPara(atual + (e.key === 'ArrowDown' ? 1 : -1))
    }
    window.addEventListener('keydown', teclar)
    return () => window.removeEventListener('keydown', teclar)
  }, [atual, irPara])

  /** O item saiu da vista (confirmado, pulado, adiado): vai ao próximo e relê a pilha. */
  const aposSair = (proxima: string | null) => {
    const seguinte = proxima ?? itens[atual + 1]?.chave ?? itens[atual - 1]?.chave ?? null
    setErro(null)
    setChave(seguinte)
    router.refresh()
  }

  const trazerDeVolta = (c: string) =>
    iniciar(async () => {
      const r = await trazerDeVoltaAcao(c)
      if (r.erro) setErro(r.erro)
      else router.refresh()
    })

  const avisoDeErro = erro && (
    <p role="alert" className="text-sm font-[550] text-erro">
      {erro}
    </p>
  )

  if (!item) {
    return (
      <div className="space-y-6">
        <h1 className="text-[24px] font-[650] leading-[1.25] text-text-primary">Decidir</h1>
        {avisoDeErro}
        <EstadoVazio
          tipo="nenhum-registro"
          titulo="Nada esperando por você."
          descricao="Quando uma demanda ou a Fábrica precisar de uma resposta sua, ela aparece aqui."
          acao={
            <Link href="/" className={buttonVariants({ variant: 'outline' })}>
              Voltar ao Início
            </Link>
          }
        />
        <Guardados guardados={guardados} onTrazerDeVolta={trazerDeVolta} pendente={pendente} />
      </div>
    )
  }

  const posicao = textoDaPosicao(atual + 1, itens.length)
  return (
    <div className="space-y-4 md:space-y-5">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[24px] font-[650] leading-[1.25] tracking-[-0.01em] text-text-primary">
          Decidir
        </h1>
        <span className="text-[13px] text-text-secondary">{posicao}</span>
      </header>
      <FaixaDoCelular
        posicao={atual + 1}
        total={itens.length}
        titulo={item.titulo}
        onAnterior={() => irPara(atual - 1)}
        onProximo={() => irPara(atual + 1)}
      />
      {avisoDeErro}
      <div className="grid min-w-0 gap-5 md:grid-cols-[220px_minmax(0,1fr)] md:items-start md:gap-6">
        <Pilha
          itens={itens}
          atual={atual}
          guardados={guardados}
          onEscolher={irPara}
          onTrazerDeVolta={trazerDeVolta}
          pendente={pendente}
        />
        {item.ref.tipo === 'publicacao' ? (
          <AvisoDaPublicacao
            key={item.chave}
            item={item}
            repositorioId={item.ref.repositorioId}
            podeAgir={podeAgir}
            aposSair={aposSair}
          />
        ) : (
          <ItemAberto
            key={item.chave}
            item={item}
            conversaInicial={conversas[item.chave] ?? null}
            podeAgir={podeAgir}
            aposSair={aposSair}
          />
        )}
      </div>
      <div className="md:hidden">
        <Guardados guardados={guardados} onTrazerDeVolta={trazerDeVolta} pendente={pendente} />
      </div>
    </div>
  )
}

interface Ajuste {
  inicial: InicialDoCartao
  foco?: string
}

/**
 * O aviso da fila de publicação: não há conversa nem cartão, porque o que resolve está na tela
 * Publicação (retomar a fila, conferir o servidor). Ele sai da pilha sozinho quando a fila volta
 * a andar; "Pular" e "Deixar para amanhã" tiram da vista como nos outros itens.
 */
function AvisoDaPublicacao({
  item,
  repositorioId,
  podeAgir,
  aposSair,
}: {
  item: ItemDaPilha
  repositorioId: string
  podeAgir: boolean
  aposSair: (proxima: string | null) => void
}) {
  const [erro, setErro] = useState<string | null>(null)
  return (
    <article className="min-w-0 overflow-hidden rounded-amplo border border-border bg-surface">
      <CabecalhoDoItem item={item} />
      <div className="space-y-3 bg-background p-4 md:p-6">
        <p className="text-sm text-text-secondary">
          Este aviso fica aqui até a fila voltar a andar. O que resolve está na tela Publicação.
        </p>
        <Link href={`/publicacao#${repositorioId}`} className={buttonVariants({ size: 'lg' })}>
          Abrir a Publicação
        </Link>
        {erro && (
          <p role="alert" className="break-words text-sm font-[550] text-erro">
            {erro}
          </p>
        )}
      </div>
      {podeAgir && (
        <div className="border-t border-border bg-surface p-4 md:px-6">
          <Rodape
            chave={item.chave}
            aoTerminar={(r) => (r.erro ? setErro(r.erro) : aposSair(null))}
          />
        </div>
      )}
    </article>
  )
}

/** Um item aberto: a conversa, a consulta a cada 2 s, o cartão e o compositor. */
function ItemAberto({
  item,
  conversaInicial,
  podeAgir,
  aposSair,
}: {
  item: ItemDaPilha
  conversaInicial: string | null
  podeAgir: boolean
  aposSair: (proxima: string | null) => void
}) {
  const router = useRouter()
  const [conversaId, setConversaId] = useState<string | null>(conversaInicial)
  const [mensagens, setMensagens] = useState<MensagemNaTela[]>([])
  const [cartao, setCartao] = useState<CartaoNaTela | null>(null)
  const [aguarda, setAguarda] = useState<Date | null>(null)
  const [buscou, setBuscou] = useState<Date | null>(null)
  const [encerrada, setEncerrada] = useState(false)
  // Sessão vencida ou sem permissão: consultar de novo não muda a resposta.
  const [semAcesso, setSemAcesso] = useState(false)
  const [agora, setAgora] = useState(() => new Date())
  const [erro, setErro] = useState<string | null>(null)
  const [erroDoCartao, setErroDoCartao] = useState<string | null>(null)
  const [ajuste, setAjuste] = useState<Ajuste | null>(null)
  const [erroDoAjuste, setErroDoAjuste] = useState<string | null>(null)
  const [pendente, setPendente] = useState(false)
  const cursor = useRef('0')
  const emCurso = useRef(false)
  const abriu = useRef(false)

  const abrir = useCallback(() => {
    if (abriu.current || !podeAgir) return
    abriu.current = true
    void abrirItemAcao(item.chave).then((r) => {
      if (r.erro) setErro(r.erro)
      else if (r.conversaId) setConversaId(r.conversaId)
    })
  }, [item.chave, podeAgir])

  // Item sem conversa: abre (o Flow monta a primeira mensagem e, quando dá, o cartão).
  useEffect(() => {
    if (conversaId === null) abrir()
  }, [conversaId, abrir])

  const consultar = useCallback(async () => {
    if (conversaId === null || emCurso.current) return
    emCurso.current = true
    try {
      const res = await fetch(`/decidir/conversas/${conversaId}?depois=${cursor.current}`, {
        cache: 'no-store',
      })
      if (res.status === 404) {
        setEncerrada(true)
        router.refresh()
        return
      }
      if (res.status === 401 || res.status === 403) {
        setSemAcesso(true)
        return
      }
      if (!res.ok) return
      const dados = (await res.json()) as RespostaDaConsulta
      const primeira = cursor.current === '0'
      const novas = dados.mensagens.map((m) => ({ ...m, em: new Date(m.em) }))
      if (novas.length > 0) {
        cursor.current = novas.at(-1)!.seq
        setMensagens((atuais) => {
          const vistas = new Set(atuais.map((m) => m.id))
          return [...atuais, ...novas.filter((m) => !vistas.has(m.id))]
        })
      } else if (primeira) {
        // Conversa só com as marcas (pulada antes de abrir): completa a abertura.
        abrir()
      }
      setCartao(dados.cartao)
      setAguarda(data(dados.aguardaAgenteDesde))
      setBuscou(data(dados.atendenteBuscouEm))
      setAgora(new Date())
      if (dados.encerrada) {
        setEncerrada(true)
        router.refresh()
      }
    } catch {
      // Rede fora: a próxima consulta tenta de novo.
    } finally {
      emCurso.current = false
    }
  }, [conversaId, abrir, router])

  // Consulta a cada 2 s só com a aba visível; para ao esconder, ao trocar de item, ao encerrar e
  // quando o servidor recusa a sessão (401) ou a permissão (403).
  useEffect(() => {
    if (conversaId === null || encerrada || semAcesso) return
    let timer: ReturnType<typeof setInterval> | null = null
    const iniciar = () => {
      if (timer !== null || document.visibilityState !== 'visible') return
      void consultar()
      timer = setInterval(() => void consultar(), INTERVALO_DA_CONSULTA_MS)
    }
    const parar = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const aoMudar = () => (document.visibilityState === 'visible' ? iniciar() : parar())
    iniciar()
    document.addEventListener('visibilitychange', aoMudar)
    return () => {
      parar()
      document.removeEventListener('visibilitychange', aoMudar)
    }
  }, [conversaId, encerrada, semAcesso, consultar])

  // O relógio da espera só anda enquanto o agente deve uma resposta.
  useEffect(() => {
    if (aguarda === null) return
    const t = setInterval(() => setAgora(new Date()), 1000)
    return () => clearInterval(t)
  }, [aguarda])

  const enviar = async (e: EnvioDoCompositor): Promise<{ erro?: string }> => {
    if (conversaId === null) return { erro: 'A conversa ainda está abrindo.' }
    const form = new FormData()
    form.set('conversaId', conversaId)
    form.set('id', e.id)
    form.set('texto', e.texto)
    for (const f of e.imagens) form.append('imagens', f)
    const r = await enviarMensagemAcao(form)
    if (!r.erro) void consultar()
    return r
  }

  const responderRapido = async (chave: string) => {
    if (conversaId === null || pendente) return
    setPendente(true)
    setErro(null)
    try {
      const r = await responderRapidoAcao(conversaId, crypto.randomUUID(), chave)
      if (r.erro) setErro(r.erro)
      else if (r.faltam && r.faltam.length > 0) {
        setErroDoAjuste(null)
        setAjuste({ inicial: inicialDaResposta(item, chave), foco: r.faltam[0] })
      } else setAjuste(null)
      void consultar()
    } finally {
      setPendente(false)
    }
  }

  const textoRapido = async (texto: string) => {
    const r = await enviar({ id: crypto.randomUUID(), texto, imagens: [] })
    if (r.erro) setErro(r.erro)
  }

  const confirmar = async () => {
    if (cartao === null || pendente) return
    setPendente(true)
    setErroDoCartao(null)
    try {
      const r = await confirmarCartaoAcao(cartao.id)
      if (r.erro) {
        setErroDoCartao(r.erro)
        void consultar()
        return
      }
      aposSair(r.proximaChave ?? null)
    } finally {
      setPendente(false)
    }
  }

  const salvarAjuste = async (campos: Record<string, unknown>) => {
    if (conversaId === null) return
    const r = await ajustarCartaoAcao(conversaId, campos)
    if (r.erro) {
      setErroDoAjuste(r.erro)
      return
    }
    setAjuste(null)
    setErroDoCartao(null)
    void consultar()
  }

  const fechado = encerrada || !podeAgir
  return (
    <article className="min-w-0 overflow-hidden rounded-amplo border border-border bg-surface">
      <CabecalhoDoItem item={item} />
      <div className="space-y-4 bg-background p-4 md:p-6">
        {conversaId === null && !erro && (
          <p role="status" className="text-sm text-text-secondary">
            {podeAgir ? 'Abrindo a conversa…' : 'Ainda não há conversa neste item.'}
          </p>
        )}
        <Conversa
          mensagens={mensagens}
          aguardaAgenteDesde={aguarda}
          atendenteBuscouEm={buscou}
          agora={agora}
          respostasDoFlow={respostasDoFlow(item)}
          onRespostaRapida={(c) => void responderRapido(c)}
          onTextoRapido={(t) => void textoRapido(t)}
          desabilitado={fechado || pendente || conversaId === null}
        />
        {encerrada && (
          <p role="status" className="text-sm text-text-secondary">
            Esta conversa foi encerrada.
          </p>
        )}
        {erro && (
          <p role="alert" className="break-words text-sm font-[550] text-erro">
            {erro}
          </p>
        )}
        {ajuste ? (
          <FormularioDoCartao
            key={JSON.stringify(ajuste.inicial)}
            tipoDoItem={item.tipo}
            espera={item.ref.tipo === 'demanda' ? item.ref.espera : null}
            desfecho={item.ref.tipo === 'demanda' ? item.ref.desfecho : null}
            inicial={ajuste.inicial}
            foco={ajuste.foco}
            erro={erroDoAjuste}
            onSalvar={salvarAjuste}
            onCancelar={() => setAjuste(null)}
          />
        ) : (
          cartao && (
            <CartaoDeFecho
              cartao={cartao}
              erro={erroDoCartao}
              pendente={pendente}
              podeAgir={!fechado}
              onConfirmar={() => void confirmar()}
              onAjustar={() => {
                setErroDoAjuste(null)
                setAjuste({ inicial: inicialDoCartao(cartao.conteudo) })
              }}
            />
          )
        )}
      </div>
      {!fechado && (
        <div className="space-y-2.5 border-t border-border bg-surface p-4 md:px-6">
          <Compositor onEnviar={enviar} desabilitado={conversaId === null} />
          <Rodape
            chave={item.chave}
            desabilitado={pendente || cartao?.estado === 'CONFIRMANDO'}
            aoTerminar={(r) => (r.erro ? setErro(r.erro) : aposSair(null))}
          />
        </div>
      )}
    </article>
  )
}
