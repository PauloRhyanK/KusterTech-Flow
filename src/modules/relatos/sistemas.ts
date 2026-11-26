// Service dos sistemas conectados (D83): criar, editar, revogar e testar. O token entra cifrado e
// nunca volta (tela, log, erro, `ultimoErro`).
import { randomUUID } from 'node:crypto'
import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { ErroDeDominio } from '@/lib/erros'
import {
  chaveDosSegredos,
  cifrarSegredo,
  decifrarSegredo,
  ErroDeSegredo,
  MENSAGEM_SEM_CHAVE,
} from '@/lib/segredos'
import { type AlvoDoSistema, buscarPagina } from './cliente'
import { permitirLocal, validarEnderecoDoSistema } from './endereco'

export interface DadosDoSistema {
  nome: string
  url: string
  projetoId: string
  repositorioId: string | null
  /** Vazio na edição = manter o atual. */
  token: string
}

export const contextoDoToken = (id: string) => `sistema:${id}`
export const NAO_DECIFROU_O_TOKEN = 'Não foi possível decifrar o token. Salve o token de novo.'

function exigirChave(): Buffer {
  let chave: Buffer | null
  try {
    chave = chaveDosSegredos(process.env)
  } catch (err) {
    if (err instanceof ErroDeSegredo) throw new ErroDeDominio(err.message)
    throw err
  }
  if (!chave) throw new ErroDeDominio(MENSAGEM_SEM_CHAVE)
  return chave
}

function validarToken(token: string): string {
  const t = token.trim()
  if (t.length < 16 || t.length > 500 || /\s/.test(t)) {
    throw new ErroDeDominio('O token precisa ter de 16 a 500 caracteres, sem espaços.')
  }
  return t
}

async function validarBasico(d: DadosDoSistema): Promise<{
  nome: string
  url: string
  projetoId: string
  repositorioId: string
}> {
  const nome = d.nome.trim()
  if (nome.length < 1 || nome.length > 60) {
    throw new ErroDeDominio('O nome precisa ter de 1 a 60 caracteres.')
  }
  const endereco = validarEnderecoDoSistema(d.url, { permitirLocal: permitirLocal() })
  if (!endereco.ok) throw new ErroDeDominio(endereco.motivo)
  const projeto = await db.projeto.findUnique({
    where: { id: d.projetoId },
    select: { arquivadoEm: true, repositorios: { select: { id: true } } },
  })
  if (!projeto || projeto.arquivadoEm) throw new ErroDeDominio('Escolha um projeto ativo.')
  const ids = projeto.repositorios.map((r) => r.id)
  let repositorioId = d.repositorioId || null
  if (repositorioId) {
    if (!ids.includes(repositorioId)) throw new ErroDeDominio('O repositório não é deste projeto.')
  } else if (ids.length === 1) {
    repositorioId = ids[0]!
  } else if (ids.length === 0) {
    throw new ErroDeDominio('O projeto não tem repositório ligado.')
  } else {
    throw new ErroDeDominio('Escolha o repositório das demandas.')
  }
  return { nome, url: endereco.url, projetoId: d.projetoId, repositorioId }
}

export async function criarSistema(sujeito: Sujeito, d: DadosDoSistema): Promise<{ id: string }> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  const chave = exigirChave()
  const token = validarToken(d.token)
  const dados = await validarBasico(d)
  const id = randomUUID()
  await db.sistemaConectado.create({
    data: { id, ...dados, tokenCifrado: cifrarSegredo(token, contextoDoToken(id), chave) },
  })
  return { id }
}

async function sistemaAtivo(id: string) {
  const s = await db.sistemaConectado.findUnique({ where: { id } })
  if (!s) throw new ErroDeDominio('Sistema não encontrado.')
  if (s.estado === 'REVOGADO') throw new ErroDeDominio('Este sistema foi revogado.')
  return s
}

export async function editarSistema(
  sujeito: Sujeito,
  id: string,
  d: DadosDoSistema,
): Promise<void> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  const atual = await sistemaAtivo(id)
  const dados = await validarBasico(d)
  const novoToken = d.token.trim() ? validarToken(d.token) : null
  const chave = novoToken ? exigirChave() : null
  await db.sistemaConectado.update({
    where: { id },
    data: {
      ...dados,
      // Outro endereço é outro sistema: o cursor recomeça.
      ...(dados.url !== atual.url ? { cursor: null } : {}),
      ...(novoToken && chave
        ? {
            tokenCifrado: cifrarSegredo(novoToken, contextoDoToken(id), chave),
            estado: 'ATIVO' as const,
            ultimoErro: null,
          }
        : {}),
    },
  })
}

export async function revogarSistema(
  sujeito: Sujeito,
  id: string,
  agora = new Date(),
): Promise<void> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  await sistemaAtivo(id)
  await db.$transaction([
    db.sistemaConectado.update({
      where: { id },
      data: { estado: 'REVOGADO', revogadoEm: agora, tokenCifrado: null },
    }),
    db.envioDeAndamento.updateMany({
      where: { situacao: 'PENDENTE', relato: { sistemaId: id } },
      data: { situacao: 'DESCARTADO', ultimoErro: 'Sistema revogado.' },
    }),
  ])
}

/** O alvo para o cliente, com o token decifrado. Só no servidor e no worker. */
export function alvoDoSistema(
  s: { id: string; url: string; tokenCifrado: string | null },
  chave: Buffer,
): AlvoDoSistema {
  if (!s.tokenCifrado) throw new ErroDeSegredo(NAO_DECIFROU_O_TOKEN)
  return {
    url: s.url,
    token: decifrarSegredo(s.tokenCifrado, contextoDoToken(s.id), chave),
    permitirLocal: permitirLocal(),
  }
}

/** `GET` com o cursor atual, sem gravar relato nem andar o cursor. Não muda o estado. */
export async function testarConexao(
  sujeito: Sujeito,
  id: string,
  deps: { buscar?: typeof buscarPagina } = {},
): Promise<{ ok: boolean; mensagem: string }> {
  exigirPermissao(sujeito, 'configuracoes.gerenciar')
  const s = await sistemaAtivo(id)
  const chave = exigirChave()
  let alvo: AlvoDoSistema
  try {
    alvo = alvoDoSistema(s, chave)
  } catch {
    return { ok: false, mensagem: NAO_DECIFROU_O_TOKEN }
  }
  const r = await (deps.buscar ?? buscarPagina)(alvo, s.cursor)
  if (r.ok) {
    const n = r.relatos.length
    return {
      ok: true,
      mensagem: r.mais
        ? `Conexão ok: mais de ${n} relatos esperando.`
        : `Conexão ok: ${n} relato(s) esperando.`,
    }
  }
  switch (r.falha.tipo) {
    case 'token_recusado':
      return { ok: false, mensagem: 'O sistema recusou o token.' }
    case 'contrato':
      return {
        ok: false,
        mensagem: `O sistema respondeu fora do contrato: ${semPonto(r.falha.motivo)}.`,
      }
    default:
      return {
        ok: false,
        mensagem: `Não consegui falar com o sistema: ${semPonto(r.falha.motivo)}.`,
      }
  }
}

const semPonto = (t: string) => t.replace(/\.$/, '')
