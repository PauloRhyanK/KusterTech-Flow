import type { ReactNode } from 'react'
import Link from 'next/link'
import { formatarData, formatarDataHora } from '@/lib/data'
import { CLASSE_DO_LINK } from '@/lib/ui/titulo-de-secao'
import type { FiltrosDosTickets, MidiaDoTicket } from '@/modules/tickets/model'
import type { TicketDetalhado } from '@/modules/tickets/queries'
import { TrilhoAteOAr } from '../../demandas/_componentes/trilho-ate-o-ar'
import { HistoricoDoTicket } from './historico-do-ticket'
import { ChipDoResultado, ROTULO_DO_CANAL } from './lista-de-tickets'

const ROTULO_DO_TIPO = { imagem: 'Imagem', audio: 'Áudio', video: 'Vídeo', arquivo: 'Arquivo' }

function Secao({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-3 border-t border-border pt-3">
      <h3
        id={id}
        className="mb-1.5 text-[11px] font-[600] uppercase tracking-[0.08em] text-text-secondary"
      >
        {titulo}
      </h3>
      {children}
    </section>
  )
}

function Midia({ midia }: { midia: MidiaDoTicket }) {
  const nome = `${ROTULO_DO_TIPO[midia.tipo]} ${midia.posicao + 1}`
  if (midia.situacao === 'indisponivel') {
    return (
      <p className="text-xs text-text-secondary">
        {nome}: <span>indisponível</span>
      </p>
    )
  }
  if (midia.situacao === 'apagada') {
    return (
      <p className="text-xs text-text-secondary">
        {nome}:{' '}
        <span>{`apagada em ${midia.apagadaEm ? formatarData(midia.apagadaEm) : '—'} (retenção de 90 dias)`}</span>
      </p>
    )
  }
  const url = midia.url ?? ''
  if (midia.tipo === 'imagem') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Abrir ${nome.toLowerCase()} em tamanho maior`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado servido pela rota com sessão */}
        <img
          src={url}
          alt={nome}
          className="h-[120px] w-auto max-w-[200px] rounded-compacto border border-border object-cover"
        />
      </a>
    )
  }
  if (midia.tipo === 'audio') {
    return <audio controls src={url} className="w-full" />
  }
  if (midia.tipo === 'video') {
    return <video controls src={url} className="max-h-[200px] rounded-compacto" />
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={CLASSE_DO_LINK}>
      {nome}
    </a>
  )
}

/** O resumo é o começo do texto (140 caracteres): quando cortou, termina em reticências. */
function tituloDoTicket(t: TicketDetalhado): string {
  const cortado = !!t.texto && t.texto.length > t.resumo.length && t.texto.startsWith(t.resumo)
  return cortado ? `${t.resumo.trimEnd()}…` : t.resumo
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <>
      <dt className="text-text-secondary">{rotulo}</dt>
      <dd className="min-w-0 break-words text-text-primary">{valor}</dd>
    </>
  )
}

/** O ticket aberto: o que foi enviado, as mídias, de onde veio, o que virou e o histórico. */
export function DetalheDoTicket({
  ticket,
  emPagina,
}: {
  ticket: TicketDetalhado | null
  filtros: FiltrosDosTickets
  emPagina: boolean
}) {
  if (!ticket) {
    return (
      <div className="rounded-padrao border border-border bg-surface p-6 text-sm text-text-secondary">
        Escolha um ticket
      </div>
    )
  }
  const orientado = ticket.resultado === 'orientado'
  const d = ticket.demanda
  return (
    <article
      aria-label="Detalhe do ticket"
      className="rounded-padrao border border-border bg-surface p-3.5"
    >
      <div className="flex items-baseline justify-between gap-3 text-xs text-text-secondary">
        <span>{`Ticket #${ticket.ticket ?? ticket.id.slice(0, 8)} · recebido ${formatarDataHora(ticket.em)}`}</span>
        {!emPagina && (
          <Link href={`/tickets/${ticket.id}`} className={CLASSE_DO_LINK}>
            Abrir em página
          </Link>
        )}
      </div>
      {!orientado && (
        <h2 className="mt-1 line-clamp-2 text-[15px] font-[600] text-text-primary">
          {tituloDoTicket(ticket)}
        </h2>
      )}
      <ul aria-label="Resumo do ticket" className="mb-1 mt-1.5 flex flex-wrap gap-1.5">
        {[
          ticket.sistema.nome,
          ROTULO_DO_CANAL[ticket.canal],
          `${ticket.autor.nome} · ${ticket.autor.papel}`,
        ].map((t, i) => (
          <li
            key={i}
            className="whitespace-nowrap rounded-compacto border border-border px-1.5 py-px text-[11px] text-text-secondary"
          >
            {t}
          </li>
        ))}
        <li className="flex">
          <ChipDoResultado resultado={ticket.resultado} />
        </li>
      </ul>

      <Secao id="t-enviado" titulo="O que foi enviado">
        {ticket.texto ? (
          <p className="whitespace-pre-wrap rounded-compacto border border-border bg-surface-subtle p-2.5 text-sm text-text-primary">
            {ticket.texto}
          </p>
        ) : (
          <p className="text-sm text-text-secondary">
            {ticket.transcricao ? '(só áudio)' : '(sem texto)'}
          </p>
        )}
      </Secao>

      <Secao id="t-midias" titulo={`Mídias · ${ticket.midias.length}`}>
        {ticket.midias.length === 0 ? (
          <p className="text-xs text-text-secondary">Sem mídias</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {ticket.midias.map((m) => (
              <Midia key={m.posicao} midia={m} />
            ))}
          </div>
        )}
        {ticket.transcricao && (
          <p className="mt-1.5 text-xs text-text-secondary">
            <b className="font-medium text-text-primary">Transcrição:</b> {ticket.transcricao}
          </p>
        )}
      </Secao>

      <Secao id="t-origem" titulo="De onde veio">
        <dl className="grid grid-cols-[110px_1fr] gap-x-2.5 gap-y-1 text-xs">
          <Dado rotulo="App" valor={ticket.sistema.nome} />
          <Dado rotulo="Projeto" valor={ticket.projeto.nome} />
          {ticket.projeto.clientes.length > 0 && (
            <Dado rotulo="Clientes" valor={ticket.projeto.clientes.join(', ')} />
          )}
          <Dado rotulo="Canal" valor={ROTULO_DO_CANAL[ticket.canal]} />
          {ticket.tela && <Dado rotulo="Tela" valor={ticket.tela} />}
          {ticket.versao && <Dado rotulo="Versão" valor={ticket.versao} />}
          {ticket.plataforma && <Dado rotulo="Plataforma" valor={ticket.plataforma} />}
          {ticket.aparelho && <Dado rotulo="Aparelho" valor={ticket.aparelho} />}
          <Dado rotulo="Quem enviou" valor={`${ticket.autor.nome} · ${ticket.autor.papel}`} />
          {ticket.tipoSugerido && <Dado rotulo="Tipo sugerido" valor={ticket.tipoSugerido} />}
          <Dado rotulo="Id no app" valor={ticket.idExterno} />
          <Dado rotulo="Relatado em" valor={formatarDataHora(ticket.em)} />
          <Dado rotulo="Buscado em" valor={formatarDataHora(ticket.buscadoEm)} />
        </dl>
      </Secao>

      <Secao id="t-virou" titulo="Virou">
        {orientado && (
          <p className="text-sm text-text-primary">
            {ticket.tela ? `Orientado na hora na tela ${ticket.tela}` : 'Orientado na hora'}
          </p>
        )}
        {!orientado && !d && <p className="text-sm text-text-secondary">Sem demanda</p>}
        {d && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 rounded-compacto border border-border bg-surface-subtle px-2.5 py-2">
              <div className="min-w-0">
                <Link
                  href={`/demandas/${d.id}`}
                  className="break-words text-sm font-medium text-text-link hover:underline"
                >
                  {d.titulo}
                </Link>
                <p className="text-xs text-text-secondary">{d.repositorio}</p>
              </div>
              <TrilhoAteOAr pontos={d.trilho} />
            </div>
            {d.frase && <p className="text-xs text-text-secondary">{d.frase}</p>}
            {d.outrosTickets > 0 && (
              <p className="text-xs text-text-secondary">
                {`+${d.outrosTickets} ${d.outrosTickets === 1 ? 'ticket' : 'tickets'} nesta demanda`}
              </p>
            )}
          </div>
        )}
      </Secao>

      <Secao id="t-historico" titulo="Histórico">
        <HistoricoDoTicket itens={ticket.historico} />
      </Secao>
    </article>
  )
}
