'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { exigirModulo } from '@/lib/modulos-rota'
import { confirmarCartao } from '@/modules/decidir/confirmacao'
import {
  abrirItem,
  ajustarCartao,
  deixarParaAmanha,
  enviarMensagem,
  guardarItem,
  pularItem,
  responderRapido,
  trazerDeVolta,
} from '@/modules/decidir/service'
import { ArmazenamentoNaoConfigurado } from '@/modules/demandas/arquivos'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoDoDecidir {
  erro?: string
}

const MENSAGEM_SEM_PERMISSAO = 'Sem permissão para esta ação.'
const MENSAGEM_GENERICA =
  'Não foi possível completar a operação agora. Tente novamente em instantes.'
const DADOS_INVALIDOS = 'Dados inválidos.'

const id = z.uuid({ error: DADOS_INVALIDOS })
// O formato fino da chave é do service (item resolvido ou inexistente); aqui só o tamanho.
const chave = z.string({ error: DADOS_INVALIDOS }).min(1, DADOS_INVALIDOS).max(400, DADOS_INVALIDOS)

function traduzirErro(erro: unknown, contexto: string): EstadoDoDecidir {
  if (erro instanceof ErroDeAutorizacao) return { erro: MENSAGEM_SEM_PERMISSAO }
  if (erro instanceof ErroDeDominio) return { erro: erro.message }
  if (erro instanceof ArmazenamentoNaoConfigurado) return { erro: erro.message }
  log.error({ erro: resumirErroParaLog(erro) }, `Erro inesperado ao ${contexto}.`)
  return { erro: MENSAGEM_GENERICA }
}

async function exigirSessao() {
  exigirModulo('decidir')
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')
  return sessao
}

// A pilha e o contador do menu mudam com qualquer escrita daqui.
function revalidar() {
  revalidatePath('/decidir')
  revalidatePath('/', 'layout')
}

async function executar<T extends object>(
  contexto: string,
  validar: () => boolean,
  acao: (sujeito: Awaited<ReturnType<typeof exigirSessao>>['sujeito']) => Promise<T>,
): Promise<T | EstadoDoDecidir> {
  const sessao = await exigirSessao()
  if (!validar()) return { erro: DADOS_INVALIDOS }
  try {
    const r = await acao(sessao.sujeito)
    revalidar()
    return r
  } catch (erro) {
    return traduzirErro(erro, contexto)
  }
}

export async function abrirItemAcao(c: string): Promise<EstadoDoDecidir & { conversaId?: string }> {
  return executar(
    'abrir o item',
    () => chave.safeParse(c).success,
    (s) => abrirItem(s, c, new Date()),
  )
}

export async function enviarMensagemAcao(form: FormData): Promise<EstadoDoDecidir> {
  const conversaId = form.get('conversaId')
  const mensagemId = form.get('id')
  const texto = form.get('texto') ?? ''
  const imagens = form
    .getAll('imagens')
    .filter((v): v is File => v instanceof File && (v.size > 0 || v.name !== ''))
  return executar(
    'enviar a mensagem',
    () =>
      id.safeParse(conversaId).success &&
      id.safeParse(mensagemId).success &&
      typeof texto === 'string',
    async (s) => {
      await enviarMensagem(
        s,
        {
          conversaId: conversaId as string,
          id: mensagemId as string,
          texto: texto as string,
          imagens,
        },
        new Date(),
      )
      return {}
    },
  )
}

export async function responderRapidoAcao(
  conversaId: string,
  mensagemId: string,
  respostaRapida: string,
): Promise<EstadoDoDecidir & { faltam?: string[]; cartaoId?: string }> {
  return executar(
    'responder',
    () =>
      id.safeParse(conversaId).success &&
      id.safeParse(mensagemId).success &&
      chave.safeParse(respostaRapida).success,
    (s) => responderRapido(s, { conversaId, id: mensagemId, chave: respostaRapida }, new Date()),
  )
}

export async function ajustarCartaoAcao(
  conversaId: string,
  campos: unknown,
): Promise<EstadoDoDecidir & { cartaoId?: string }> {
  return executar(
    'ajustar o cartão',
    () => id.safeParse(conversaId).success,
    (s) => ajustarCartao(s, { conversaId, campos }, new Date()),
  )
}

/** Recebe o id do cartão que a pessoa viu: um cartão trocado depois é recusado pelo service. */
export async function confirmarCartaoAcao(
  cartaoId: string,
): Promise<EstadoDoDecidir & { proximaChave?: string | null }> {
  return executar(
    'confirmar o cartão',
    () => id.safeParse(cartaoId).success,
    async (s) => {
      const r = await confirmarCartao(s, cartaoId, new Date())
      // Recusa (cartão trocado, item resolvido, GitHub): o item fica e o erro aparece no cartão.
      return r.resultado === 'confirmado' ? { proximaChave: r.proximaChave } : { erro: r.erro }
    },
  )
}

function marca(contexto: string, fazer: typeof pularItem) {
  return (c: string) =>
    executar(
      contexto,
      () => chave.safeParse(c).success,
      async (s) => {
        await fazer(s, c, new Date())
        return {}
      },
    )
}

export async function pularAcao(c: string): Promise<EstadoDoDecidir> {
  return marca('pular o item', pularItem)(c)
}

export async function amanhaAcao(c: string): Promise<EstadoDoDecidir> {
  return marca('deixar para amanhã', deixarParaAmanha)(c)
}

export async function guardarAcao(c: string): Promise<EstadoDoDecidir> {
  return marca('guardar o item', guardarItem)(c)
}

export async function trazerDeVoltaAcao(c: string): Promise<EstadoDoDecidir> {
  return marca('trazer de volta', (s, k) => trazerDeVolta(s, k))(c)
}
