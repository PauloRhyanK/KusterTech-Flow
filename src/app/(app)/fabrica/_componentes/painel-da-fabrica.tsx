import Link from 'next/link'
import type { ReactNode } from 'react'
import { formatarDataHora } from '@/lib/data'
import { BadgeDeEstado, type TomDeEstado } from '@/lib/ui/badge-de-estado'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import { SemPermissao } from '@/lib/ui/sem-permissao'
import type { RetratoV2 } from '@/modules/fabrica/contrato'
import {
  contasEsgotadas,
  minutosDeAtraso,
  retratoDesatualizado,
  rotuloDoExecutor,
} from '@/modules/fabrica/model'
import type { RetratoRecebido } from '@/modules/fabrica/queries'

export interface PainelDaFabricaProps {
  secao: 'planos' | 'avisos'
  permitido: boolean
  retrato: RetratoRecebido | null
  agora: Date
}

type Plano = RetratoV2['planos'][number]
type Execucao = RetratoV2['execucoes'][number]
type EstadoDoPlano = Plano['estado']
type EstadoDaRaia = Plano['fases'][number]['raias'][number]['estado']

const TOM_DO_PLANO: Record<EstadoDoPlano, TomDeEstado> = {
  aguardando: 'neutro',
  admitindo: 'informacao',
  ativo: 'execucao',
  pausado: 'atencao',
  concluido: 'neutro',
  removido: 'neutro',
}

const TOM_DA_RAIA: Record<EstadoDaRaia, TomDeEstado> = {
  planejada: 'neutro',
  executando: 'execucao',
  concluida: 'neutro',
  falhou: 'erro',
}

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
})

const PREFIXO_DO_GITHUB = 'https://github.com/'

function Indicador({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[13px] text-text-secondary">{rotulo}</dt>
      <dd className="text-[20px] font-[650] text-text-primary">{valor}</dd>
    </div>
  )
}

function Secao({
  titulo,
  rotuloAcessivel,
  children,
}: {
  titulo: string
  rotuloAcessivel: string
  children: ReactNode
}) {
  return (
    <section
      aria-label={rotuloAcessivel}
      className="space-y-3 rounded-padrao border border-border bg-surface p-4"
    >
      <h2 className="text-[15px] font-[600] text-text-primary">{titulo}</h2>
      {children}
    </section>
  )
}

function Idade({ recebidoEm, agora }: { recebidoEm: Date; agora: Date }) {
  const minutos = minutosDeAtraso(recebidoEm, agora)
  const ha = minutos === 0 ? 'há menos de 1 min' : `há ${minutos} min`
  return (
    <p className="text-sm text-text-secondary">
      Dados recebidos em {formatarDataHora(recebidoEm)} ({ha})
    </p>
  )
}

function Decisao({ titulo, url }: { titulo: string; url: string }) {
  if (!url.startsWith(PREFIXO_DO_GITHUB)) {
    return <span className="text-sm text-text-primary">{titulo}</span>
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-text-link hover:underline"
    >
      {titulo}
    </a>
  )
}

function LinhaDaRaia({
  raia,
  execucao,
}: {
  raia: Plano['fases'][number]['raias'][number]
  execucao: Execucao | undefined
}) {
  const executor = execucao ? rotuloDoExecutor(execucao) : null
  const troca = execucao?.substituiu
  return (
    <li className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-text-primary">{raia.id}</span>
      <BadgeDeEstado tom={TOM_DA_RAIA[raia.estado]}>{raia.estado}</BadgeDeEstado>
      {executor && <span className="text-text-secondary">{executor}</span>}
      {troca && (
        <span
          title={`Trocou de ${rotuloDoExecutor(troca) ?? troca.agente}: ${troca.motivo}`}
          className="inline-flex"
        >
          <BadgeDeEstado tom="atencao">trocou</BadgeDeEstado>
        </span>
      )}
    </li>
  )
}

function CartaoDoPlano({ plano, execucoes }: { plano: Plano; execucoes: readonly Execucao[] }) {
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-medium text-text-primary">{plano.feature}</p>
        <BadgeDeEstado tom={TOM_DO_PLANO[plano.estado]}>{plano.estado}</BadgeDeEstado>
      </div>
      <p className="text-[13px] text-text-secondary">
        {plano.repo} · {plano.id} · entrou em {formatarDataHora(new Date(plano.entrouEm))}
      </p>
      <p className="text-sm text-text-primary">
        {plano.faseAtual ? `Fase atual: ${plano.faseAtual}` : 'Sem fase atual'}
      </p>
      {plano.fases.map((fase) => (
        <div key={fase.id} className="space-y-1 pl-3">
          <p className="text-[13px] font-medium text-text-secondary">{fase.id}</p>
          <ul className="space-y-1">
            {fase.raias.map((raia) => (
              <LinhaDaRaia
                key={raia.id}
                raia={raia}
                execucao={execucoes.findLast((e) => e.planoId === plano.id && e.raia === raia.id)}
              />
            ))}
          </ul>
        </div>
      ))}
      {plano.pausado && <p className="text-sm text-atencao">Pausado: {plano.pausado}</p>}
      <p className="text-[13px] text-text-secondary">
        {plano.orquestradorAtivo ? 'Orquestrador ativo' : 'Orquestrador parado'}
      </p>
      {plano.decisoes.length > 0 && (
        <div className="space-y-1">
          <p className="text-[13px] font-medium text-text-primary">Decisões abertas</p>
          <ul className="space-y-1 pl-3">
            {plano.decisoes.map((d) => (
              <li key={d.url}>
                <Decisao titulo={d.titulo} url={d.url} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

function Conteudo({
  recebido,
  agora,
  secao,
}: {
  recebido: RetratoRecebido
  agora: Date
  secao: PainelDaFabricaProps['secao']
}) {
  const { retrato, recebidoEm, geradoEm } = recebido
  const { vagas, drenagem, warren, planos, avisos } = retrato
  const desatualizado = retratoDesatualizado(recebidoEm, agora)
  const esgotadas = contasEsgotadas(retrato, agora)

  return (
    <div className="space-y-4">
      {desatualizado && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-padrao border border-atencao/30 bg-tonal-atencao p-4 text-sm"
        >
          <BadgeDeEstado tom="atencao">Desatualizado</BadgeDeEstado>
          <p className="text-text-primary">
            A máquina parou de enviar. Os dados abaixo são de há{' '}
            {minutosDeAtraso(recebidoEm, agora)} min.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <Idade recebidoEm={recebidoEm} agora={agora} />
        <p className="text-[13px] text-text-secondary">
          Gerado pela máquina em {formatarDataHora(geradoEm)}
        </p>
      </div>

      {secao === 'planos' && (
        <>
          {esgotadas.length > 0 && (
            <ul aria-label="Contas esgotadas" className="space-y-1">
              {esgotadas.map((c) => (
                <li key={c.rotulo} className="text-sm text-atencao">
                  Conta esgotada até {HORA.format(c.ate)} · {c.rotulo}
                </li>
              ))}
            </ul>
          )}
          <Secao titulo="Vagas e memória" rotuloAcessivel="Vagas e memória">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Indicador rotulo="Efetivas" valor={vagas.efetivas} />
              <Indicador rotulo="Ocupadas" valor={vagas.ocupadas} />
              <Indicador rotulo="Configuradas" valor={vagas.configuradas} />
            </dl>
            <p className="text-sm text-text-primary">
              Memória disponível:{' '}
              {vagas.memDisponivelMb === null ? 'sem medição' : `${vagas.memDisponivelMb} MB`} ·
              mínimo por vaga {vagas.ramMinimaMb} MB
            </p>
            {vagas.oomEm && (
              <p className="text-sm text-text-secondary">
                Falta de memória em {formatarDataHora(new Date(vagas.oomEm))}
              </p>
            )}
            {drenagem && (
              <p className="text-sm text-text-secondary">
                Drenagem desde {formatarDataHora(new Date(drenagem))}
              </p>
            )}
            <p className="text-sm text-text-secondary">
              Warren: {warren.preparo ?? 'sem preparo informado'}
              {warren.em && ` (em ${formatarDataHora(new Date(warren.em))})`}
            </p>
          </Secao>

          <Secao titulo="Planos na fila" rotuloAcessivel="Planos da Fábrica">
            {planos.length === 0 ? (
              <p className="text-sm text-text-secondary">Nenhum plano na fila.</p>
            ) : (
              <ul aria-label="Planos da Fábrica" className="divide-y divide-border">
                {planos.map((plano) => (
                  <CartaoDoPlano key={plano.id} plano={plano} execucoes={retrato.execucoes} />
                ))}
              </ul>
            )}
          </Secao>
        </>
      )}

      {secao === 'avisos' && (retrato.arbitragens?.length ?? 0) > 0 && (
        <Secao titulo="Resolvido sem você" rotuloAcessivel="Resolvido sem você">
          <p className="text-[13px] text-text-secondary">
            Perguntas técnicas que a Fábrica resolveu sozinha. Só para você olhar: não pedem
            resposta.
          </p>
          <ul className="space-y-2.5">
            {retrato.arbitragens!.map((a) => (
              <li
                key={`${a.em}-${a.repo}-${a.assunto}`}
                className="space-y-2 rounded-compacto border border-border bg-surface-subtle px-3.5 py-3 text-sm"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[12.5px] text-text-secondary">
                  <span className="break-words">
                    {a.repo} · {a.feature}
                  </span>
                  <span>{formatarDataHora(new Date(a.em))}</span>
                </div>
                <p className="break-words font-[650] text-text-primary">{a.assunto}</p>
                <dl className="grid gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[150px_1fr]">
                  {(
                    [
                      ['O que travou', a.travou],
                      ['O que foi decidido', a.decidido],
                      ['Muda para o produto', a.muda],
                    ] as const
                  ).map(
                    ([rotulo, valor]) =>
                      valor && (
                        <div key={rotulo} className="contents">
                          <dt className="text-text-secondary">{rotulo}</dt>
                          <dd className="break-words text-text-primary">{valor}</dd>
                        </div>
                      ),
                  )}
                </dl>
                {a.prUrl && (
                  <a
                    href={a.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-[13px] font-[600] text-text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    Ver o PR ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {secao === 'avisos' && (
        <Secao titulo="Avisos" rotuloAcessivel="Avisos da Fábrica">
          {avisos.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhum aviso.</p>
          ) : (
            <ul className="divide-y divide-border">
              {avisos.map((aviso) => (
                <li key={`${aviso.em}-${aviso.mensagem}`} className="space-y-0.5 py-2 text-sm">
                  <p className="text-[13px] text-text-secondary">
                    {formatarDataHora(new Date(aviso.em))}
                  </p>
                  <p className="text-text-primary">{aviso.mensagem}</p>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      )}
    </div>
  )
}

export function PainelDaFabrica({ secao, permitido, retrato, agora }: PainelDaFabricaProps) {
  if (!permitido) {
    return <SemPermissao />
  }

  if (retrato === null) {
    return (
      <EstadoVazio
        tipo="nao-configurado"
        titulo="A Fábrica ainda não enviou o estado."
        descricao="Na máquina de agentes, informe FABRICA_CENTRAL_URL e FABRICA_CENTRAL_TOKEN_FILE em coordenador.env, usando um token criado em Configurações. O envio começa no próximo ciclo."
        acao={
          <Link href="/configuracoes/fabrica" className="text-sm text-text-link hover:underline">
            Criar token
          </Link>
        }
      />
    )
  }

  return <Conteudo recebido={retrato} agora={agora} secao={secao} />
}
