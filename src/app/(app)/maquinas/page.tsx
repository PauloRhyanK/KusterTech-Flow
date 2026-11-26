import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buttonVariants } from '@/components/ui/button'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { log } from '@/lib/log'
import { BadgeDeEstado } from '@/lib/ui/badge-de-estado'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { ListaOperacional } from '@/lib/ui/lista-operacional'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import { seloDeMetricas, temSeloDeMetricas } from '@/modules/beszel/model'
import { obterMaquinasNoBeszel, type ResumoDoBeszel } from '@/modules/beszel/queries'
import { resumirErroParaLog } from '@/modules/github/model'
import { rotuloDoTipo } from '@/modules/infra/model'
import { idadeCurta } from '@/modules/oficina/model'
import { lerFiltrosDoInventario, listarRecursos } from '@/modules/infra/queries'
import { CartoesDasMaquinas } from './_componentes/cartoes-das-maquinas'
import { FiltrosDoInventario } from './_componentes/filtros-do-inventario'

export const metadata: Metadata = {
  title: 'Máquinas',
}

export interface PaginaMaquinasProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const TRILHAS = [{ rotulo: 'Máquinas' }]
const CONTEXTO = 'Inventário de servidores, containers, bancos e storage'

const SELO_DA_SITUACAO: Record<Exclude<ResumoDoBeszel['situacao'], 'ok'>, string> = {
  nao_configurado: 'Métricas não configuradas',
  sem_resposta: 'Beszel sem resposta',
  recusado: 'Beszel recusou o acesso',
}

// O Beszel fora não derruba o inventário: a página segue com o selo de sem resposta.
async function lerBeszel(
  sujeito: Parameters<typeof obterMaquinasNoBeszel>[0],
  agora: Date,
): Promise<ResumoDoBeszel> {
  try {
    return await obterMaquinasNoBeszel(sujeito, agora)
  } catch (erro) {
    log.error({ erro: resumirErroParaLog(erro), fonte: 'beszel' }, 'leitura do Beszel falhou')
    return { situacao: 'sem_resposta', lidaEm: null, maquinas: [] }
  }
}

export default async function PaginaMaquinas({ searchParams }: PaginaMaquinasProps) {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }

  if (!autorizar(sessao.sujeito, 'infraestrutura.ler')) {
    return (
      <div className="space-y-6">
        <CabecalhoDePagina trilhas={TRILHAS} titulo="Máquinas" contexto={CONTEXTO} />
        <SemPermissao />
      </div>
    )
  }

  const agora = new Date()
  const filtros = lerFiltrosDoInventario(await searchParams)
  const [{ recursos, total, projetos }, beszel] = await Promise.all([
    listarRecursos(sessao.sujeito, filtros),
    lerBeszel(sessao.sujeito, agora),
  ])
  const comBeszel = beszel.situacao === 'ok'
  const nomesNoBeszel = new Set(beszel.maquinas.map((m) => m.nome))
  const comFiltros =
    filtros.tipo !== null || filtros.projetoId !== null || filtros.situacao !== 'todas'

  const acaoCadastrar = autorizar(sessao.sujeito, 'infraestrutura.gerenciar') ? (
    <Link href="/maquinas/nova" className={buttonVariants({ variant: 'default' })}>
      Cadastrar máquina
    </Link>
  ) : null

  const linhas = recursos.map((r) => {
    const partes = [rotuloDoTipo(r.tipo)]
    if (r.hospedadoEm) partes.push(`Hospedado em ${r.hospedadoEm.nome}`)
    partes.push(r.totalDeProjetos === 1 ? '1 projeto' : `${r.totalDeProjetos} projetos`)
    return {
      id: r.id,
      nome: r.nome,
      href: `/maquinas/${r.id}`,
      contexto: partes.join(' · '),
      // Selo de métricas nos servidores e bancos, só com o Beszel respondendo.
      estado: r.situacao ? (
        <BadgeDeEstado tom={r.situacao.tom}>{r.situacao.texto}</BadgeDeEstado>
      ) : comBeszel && temSeloDeMetricas(r.tipo) ? (
        <BadgeDeEstado tom="neutro">
          {seloDeMetricas(r.identificadorExterno, nomesNoBeszel)}
        </BadgeDeEstado>
      ) : undefined,
    }
  })

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={TRILHAS}
        titulo="Máquinas"
        contexto={
          comBeszel
            ? `${beszel.maquinas.length} acompanhadas pelo Beszel · leitura de há ${idadeCurta(beszel.lidaEm ?? agora, agora)}`
            : CONTEXTO
        }
        acoes={acaoCadastrar}
      />

      {beszel.situacao === 'ok' ? (
        <CartoesDasMaquinas resumo={beszel} agora={agora} />
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
          <BadgeDeEstado tom={beszel.situacao === 'nao_configurado' ? 'neutro' : 'atencao'}>
            {SELO_DA_SITUACAO[beszel.situacao]}
          </BadgeDeEstado>
          <p>
            {beszel.situacao === 'nao_configurado'
              ? 'O inventário abaixo é manual.'
              : 'As métricas voltam quando ele responder; o inventário segue abaixo.'}
          </p>
        </div>
      )}

      <h2 className="text-[13px] font-[600] uppercase tracking-[0.06em] text-text-secondary">
        Inventário
      </h2>

      <ListaOperacional
        rotulo="Inventário de recursos"
        linhas={linhas}
        filtros={<FiltrosDoInventario filtros={filtros} projetos={projetos} />}
        vazio={
          comFiltros ? (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhum recurso com estes filtros."
              descricao="Altere os filtros para ver outros recursos."
            />
          ) : (
            <EstadoVazio
              tipo="nenhum-registro"
              titulo="Nenhum recurso cadastrado."
              descricao="Cadastre servidores, containers, bancos e storage para relacioná-los aos projetos."
            />
          )
        }
      />
      {total > recursos.length && (
        <p className="text-sm text-text-secondary">
          Mostrando {recursos.length} de {total} recursos. Use os filtros para refinar.
        </p>
      )}
    </div>
  )
}
