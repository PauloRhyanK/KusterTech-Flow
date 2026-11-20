'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ErroDeAutorizacao } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { ErroDeDominio } from '@/lib/erros'
import { log } from '@/lib/log'
import { exigirModulo } from '@/lib/modulos-rota'
import { ArmazenamentoNaoConfigurado } from '@/modules/demandas/arquivos'
import { NIVEIS } from '@/modules/demandas/contrato'
import { criarDemanda } from '@/modules/demandas/service'
import { resumirErroParaLog } from '@/modules/github/model'

export interface EstadoDaNovaDemanda {
  erro?: string
}

const MENSAGEM_SEM_PERMISSAO = 'Sem permissão para criar demandas.'
const MENSAGEM_GENERICA =
  'Não foi possível completar a operação agora. Tente novamente em instantes.'
const DADOS_INVALIDOS = 'Dados inválidos.'
const MAXIMO_DE_ANEXOS = 3

const schema = z.object({
  projetoId: z.uuid({ error: 'Escolha o projeto.' }),
  repositorioId: z.uuid({ error: 'Repositório inválido.' }).nullable(),
  titulo: z
    .string({ error: DADOS_INVALIDOS })
    .trim()
    .min(1, 'Informe o que você quer.')
    .max(120, 'O título pode ter até 120 caracteres.'),
  descricao: z
    .string({ error: DADOS_INVALIDOS })
    .max(4000, 'Os detalhes podem ter até 4000 caracteres.'),
  nivel: z.enum(NIVEIS, { error: 'Escolha quanto você quer acompanhar.' }),
  temTela: z.enum(['sim', 'nao'], { error: 'Diga se a demanda tem tela.' }),
})

export async function criarDemandaAction(
  _estado: EstadoDaNovaDemanda,
  form: FormData,
): Promise<EstadoDaNovaDemanda> {
  exigirModulo('demandas')
  const sessao = await obterSessao()
  if (!sessao) redirect('/entrar')

  const repositorio = form.get('repositorioId')
  const parse = schema.safeParse({
    projetoId: form.get('projetoId'),
    repositorioId: typeof repositorio === 'string' && repositorio !== '' ? repositorio : null,
    titulo: form.get('titulo'),
    descricao: form.get('descricao') ?? '',
    nivel: form.get('nivel'),
    temTela: form.get('temTela'),
  })
  if (!parse.success) return { erro: parse.error.issues[0]?.message ?? DADOS_INVALIDOS }

  // Campo de arquivo vazio chega como um arquivo sem nome e sem bytes.
  const anexos = form.getAll('anexos').filter((a): a is File => a instanceof File && a.size > 0)
  if (anexos.length > MAXIMO_DE_ANEXOS) return { erro: 'Envie até 3 anexos.' }

  let id: string
  try {
    ;({ id } = await criarDemanda(sessao.sujeito, {
      projetoId: parse.data.projetoId,
      repositorioId: parse.data.repositorioId,
      titulo: parse.data.titulo,
      descricao: parse.data.descricao,
      nivel: parse.data.nivel,
      temTela: parse.data.temTela === 'sim',
      anexos,
    }))
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacao) return { erro: MENSAGEM_SEM_PERMISSAO }
    if (erro instanceof ErroDeDominio) return { erro: erro.message }
    if (erro instanceof ArmazenamentoNaoConfigurado) return { erro: erro.message }
    log.error({ erro: resumirErroParaLog(erro) }, 'Erro inesperado ao criar a demanda.')
    return { erro: MENSAGEM_GENERICA }
  }
  revalidatePath('/demandas')
  redirect(`/demandas/${id}`)
}
