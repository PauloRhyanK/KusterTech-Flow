import { createHash } from 'node:crypto'
import type {
  EstadoAlerta as EstadoAlertaPrisma,
  OrigemAlerta as OrigemAlertaPrisma,
  SeveridadeAlerta as SeveridadeAlertaPrisma,
  TipoRecurso as TipoRecursoPrisma,
} from '@prisma/client'
import { z } from 'zod'
import { ErroDeDominio } from '@/lib/erros'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'

export type TipoRecurso = 'SERVIDOR' | 'CONTAINER' | 'BANCO' | 'STORAGE' | 'OUTRO'
export type EstadoAlerta = 'ATIVO' | 'RECONHECIDO' | 'RESOLVIDO_NA_ORIGEM'
export type OrigemAlerta = 'WEBHOOK' | 'MANUAL'
export type SeveridadeAlerta = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA'

type Paridade<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _paridadeTipo: Paridade<TipoRecurso, TipoRecursoPrisma> = true
const _paridadeEstado: Paridade<EstadoAlerta, EstadoAlertaPrisma> = true
const _paridadeOrigem: Paridade<OrigemAlerta, OrigemAlertaPrisma> = true
const _paridadeSeveridade: Paridade<SeveridadeAlerta, SeveridadeAlertaPrisma> = true
void [_paridadeTipo, _paridadeEstado, _paridadeOrigem, _paridadeSeveridade]

const LIMITE_NOME = 120
const LIMITE_URL = 500

export function validarNomeDeRecurso(nome: string): string {
  const aparado = nome.trim()
  if (aparado === '') {
    throw new ErroDeDominio('O nome é obrigatório.')
  }
  if (aparado.length > LIMITE_NOME) {
    throw new ErroDeDominio(`O nome não pode ter mais de ${LIMITE_NOME} caracteres.`)
  }
  return aparado
}

export function validarUrlDeFerramenta(
  url: string | null | undefined,
  rotulo: 'Beszel' | 'GlitchTip' | 'host Docker',
): string | null {
  const aparada = url?.trim() ?? ''
  if (aparada === '') {
    return null
  }
  const recusa = new ErroDeDominio(
    `O endereço do ${rotulo} precisa começar com http:// ou https:// e não pode conter usuário ou senha.`,
  )
  if (aparada.length > LIMITE_URL) {
    throw recusa
  }
  let analisada: URL
  try {
    analisada = new URL(aparada)
  } catch {
    throw recusa
  }
  if (!['http:', 'https:'].includes(analisada.protocol)) {
    throw recusa
  }
  if (analisada.username !== '' || analisada.password !== '') {
    throw recusa
  }
  return aparada
}

export function validarHospedagem(
  tipo: TipoRecurso,
  hospedeiro: { tipo: TipoRecurso; arquivado: boolean } | null,
): void {
  if (hospedeiro === null) {
    return
  }
  if (tipo === 'SERVIDOR') {
    throw new ErroDeDominio('Um servidor não pode estar hospedado em outro recurso.')
  }
  if (hospedeiro.tipo !== 'SERVIDOR') {
    throw new ErroDeDominio('Só servidores podem hospedar outros recursos.')
  }
  if (hospedeiro.arquivado) {
    throw new ErroDeDominio('Servidor arquivado não recebe novos recursos.')
  }
}

export interface SituacaoAtualDoAlerta {
  estado: EstadoAlerta
  origem: OrigemAlerta
  ultimaOcorrenciaEm: Date
  resolvidoEm: Date | null
}

export type EventoDoAlerta =
  | { tipo: 'ocorrencia'; em: Date }
  | { tipo: 'resolucao-na-origem'; em: Date }
  | { tipo: 'reconhecer' }
  | { tipo: 'registrar-resolucao' }

export type TransicaoDoAlerta =
  | {
      efeito: 'criar' | 'repetir' | 'reabrir' | 'reconhecer' | 'resolver' | 'nenhum' | 'ignorar'
      estado: EstadoAlerta | null
    }
  | { recusa: string }

export function estadoDoAlerta(
  atual: SituacaoAtualDoAlerta | null,
  evento: EventoDoAlerta,
): TransicaoDoAlerta {
  if (atual === null) {
    if (evento.tipo === 'ocorrencia') return { efeito: 'criar', estado: 'ATIVO' }
    if (evento.tipo === 'resolucao-na-origem') return { efeito: 'ignorar', estado: null }
    return { recusa: 'Alerta não encontrado.' }
  }

  const resolvido = atual.estado === 'RESOLVIDO_NA_ORIGEM'

  switch (evento.tipo) {
    case 'ocorrencia':
      if (!resolvido) return { efeito: 'repetir', estado: atual.estado }
      return atual.resolvidoEm !== null && evento.em <= atual.resolvidoEm
        ? { efeito: 'nenhum', estado: atual.estado }
        : { efeito: 'reabrir', estado: 'ATIVO' }
    case 'resolucao-na-origem':
      if (resolvido || evento.em < atual.ultimaOcorrenciaEm) {
        return { efeito: 'nenhum', estado: atual.estado }
      }
      return { efeito: 'resolver', estado: 'RESOLVIDO_NA_ORIGEM' }
    case 'reconhecer':
      if (resolvido) return { recusa: 'Alerta resolvido não precisa de reconhecimento.' }
      if (atual.estado === 'RECONHECIDO') return { recusa: 'Este alerta já foi reconhecido.' }
      return { efeito: 'reconhecer', estado: 'RECONHECIDO' }
    case 'registrar-resolucao':
      if (atual.origem === 'WEBHOOK') {
        return { recusa: 'Alertas recebidos por webhook são resolvidos pela própria fonte.' }
      }
      if (resolvido) return { recusa: 'Este alerta já está resolvido.' }
      return { efeito: 'resolver', estado: 'RESOLVIDO_NA_ORIGEM' }
  }
}

export function apresentarEstadoDoAlerta(estado: EstadoAlerta): {
  texto: string
  tom: TomDeEstado
} {
  const tabela: Record<EstadoAlerta, { texto: string; tom: TomDeEstado }> = {
    ATIVO: { texto: 'Ativo', tom: 'erro' },
    RECONHECIDO: { texto: 'Reconhecido', tom: 'atencao' },
    RESOLVIDO_NA_ORIGEM: { texto: 'Resolvido na origem', tom: 'sucesso' },
  }
  return tabela[estado]
}

export function apresentarSeveridade(severidade: SeveridadeAlerta): {
  texto: string
  tom: TomDeEstado
} {
  const tabela: Record<SeveridadeAlerta, { texto: string; tom: TomDeEstado }> = {
    CRITICA: { texto: 'Crítica', tom: 'erro' },
    ALTA: { texto: 'Alta', tom: 'erro' },
    MEDIA: { texto: 'Média', tom: 'atencao' },
    BAIXA: { texto: 'Baixa', tom: 'informacao' },
  }
  return tabela[severidade]
}

export function rotuloDoTipo(tipo: TipoRecurso): string {
  const tabela: Record<TipoRecurso, string> = {
    SERVIDOR: 'Servidor',
    CONTAINER: 'Container',
    BANCO: 'Banco de dados',
    STORAGE: 'Storage',
    OUTRO: 'Outro',
  }
  return tabela[tipo]
}

export function vezesRecebido(n: number): string {
  return n === 1 ? 'Recebido 1 vez' : `Recebido ${n} vezes`
}

type AlertaParaSaude = readonly { severidade: SeveridadeAlerta }[]

function tomDosAlertas(alertas: AlertaParaSaude): TomDeEstado {
  return alertas.some((a) => a.severidade === 'CRITICA' || a.severidade === 'ALTA')
    ? 'erro'
    : 'atencao'
}

export function situacaoDoRecurso(e: {
  arquivado: boolean
  alertasNaoResolvidos: AlertaParaSaude
}): { chave: 'arquivado' | 'com-alerta' | 'sem-dados'; texto: string; tom: TomDeEstado } {
  if (e.arquivado) {
    return { chave: 'arquivado', texto: 'Arquivado', tom: 'neutro' }
  }
  const n = e.alertasNaoResolvidos.length
  if (n === 0) {
    return { chave: 'sem-dados', texto: 'Sem dados', tom: 'neutro' }
  }
  return {
    chave: 'com-alerta',
    texto: n === 1 ? '1 alerta' : `${n} alertas`,
    tom: tomDosAlertas(e.alertasNaoResolvidos),
  }
}

export function resumoDeSaude(alertasNaoResolvidos: AlertaParaSaude): {
  texto: string
  tom: TomDeEstado
  detalhe: string
} {
  const n = alertasNaoResolvidos.length
  if (n === 0) {
    return {
      texto: 'Sem dados',
      tom: 'neutro',
      detalhe: 'Nenhum alerta não resolvido. Sem fonte de monitoramento para confirmar a saúde.',
    }
  }
  return {
    texto: n === 1 ? '1 alerta não resolvido' : `${n} alertas não resolvidos`,
    tom: tomDosAlertas(alertasNaoResolvidos),
    detalhe: 'O impacto nos projetos não está confirmado.',
  }
}

export function linksDeFerramentas(
  r: { urlBeszel: string | null; urlGlitchTip: string | null; urlHostDocker: string | null },
  repositorios: readonly { nomeCompleto: string; urlHtml: string }[],
): { rotulo: string; href: string }[] {
  const links: { rotulo: string; href: string }[] = []
  if (r.urlBeszel) links.push({ rotulo: 'Beszel', href: r.urlBeszel })
  if (r.urlGlitchTip) links.push({ rotulo: 'GlitchTip', href: r.urlGlitchTip })
  if (r.urlHostDocker) links.push({ rotulo: 'Host Docker', href: r.urlHostDocker })
  const ordenados = [...repositorios].sort((a, b) =>
    a.nomeCompleto < b.nomeCompleto ? -1 : a.nomeCompleto > b.nomeCompleto ? 1 : 0,
  )
  for (const repo of ordenados) {
    links.push({ rotulo: `GitHub · ${repo.nomeCompleto}`, href: repo.urlHtml })
  }
  return links
}

export function chaveDedupeDoWebhook(fonteId: string, chave: string): string {
  return `${fonteId}:${chave}`
}

export function chaveDedupeManual(id: string): string {
  return `manual:${id}`
}

export function hashDoTokenDeAlertas(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface CorpoDeAlerta {
  chave: string
  titulo: string
  severidade: SeveridadeAlerta
  situacao: 'ativo' | 'resolvido'
  recurso: string | null
  ocorridoEm: Date | null
  detalhe: string | null
}

const SEVERIDADES_DO_CORPO: Record<'critica' | 'alta' | 'media' | 'baixa', SeveridadeAlerta> = {
  critica: 'CRITICA',
  alta: 'ALTA',
  media: 'MEDIA',
  baixa: 'BAIXA',
}

// Chaves desconhecidas são descartadas (z.object padrão). A chave nunca é truncada: truncar fundiria alertas distintos.
const esquemaDoCorpo = z.object({
  chave: z.string().trim().min(1).max(200),
  titulo: z
    .string()
    .trim()
    .min(1)
    .transform((t) => t.slice(0, 200)),
  severidade: z
    .enum(['critica', 'alta', 'media', 'baixa'])
    .transform((s) => SEVERIDADES_DO_CORPO[s]),
  situacao: z.enum(['ativo', 'resolvido']).default('ativo'),
  recurso: z.string().trim().min(1).max(120).nullish(),
  ocorridoEm: z.iso
    .datetime({ offset: true })
    .nullish()
    .transform((d) => (d ? new Date(d) : null)),
  detalhe: z
    .string()
    .nullish()
    .transform((d) => (d ? d.slice(0, 2000) : null)),
})

export function lerCorpoDoAlerta(
  corpo: unknown,
): { ok: true; dados: CorpoDeAlerta } | { ok: false; campos: string[] } {
  const resultado = esquemaDoCorpo.safeParse(corpo)
  if (!resultado.success) {
    const campos = [...new Set(resultado.error.issues.map((i) => i.path.join('.')))]
    return { ok: false, campos }
  }
  const d = resultado.data
  return {
    ok: true,
    dados: {
      chave: d.chave,
      titulo: d.titulo,
      severidade: d.severidade,
      situacao: d.situacao,
      recurso: d.recurso ?? null,
      ocorridoEm: d.ocorridoEm,
      detalhe: d.detalhe,
    },
  }
}
