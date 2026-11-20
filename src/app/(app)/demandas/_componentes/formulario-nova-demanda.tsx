'use client'

import { useActionState, useState } from 'react'
import { criarDemandaAction } from '@/app/(app)/demandas/nova/actions'
import { MensagensDeEstado } from '@/app/(app)/projetos/_componentes/mensagens-de-estado'
import { Button } from '@/components/ui/button'
import { ROTULO_DO_NIVEL } from '@/modules/demandas/apresentacao'
import { NIVEIS } from '@/modules/demandas/contrato'
import type { FormularioDeDemanda } from '@/modules/demandas/queries'

export interface FormularioNovaDemandaProps {
  projetos: FormularioDeDemanda['projetos']
}

const CLASSE_CAMPO =
  'w-full rounded-compacto border border-border bg-surface px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface'
const CLASSE_ROTULO = 'block text-sm font-medium text-text-primary'
const CLASSE_PILULA =
  'cursor-pointer rounded-full border border-border-strong px-3.5 py-1.5 text-sm font-[550] text-text-primary has-[:checked]:border-text-primary has-[:checked]:bg-text-primary has-[:checked]:text-surface has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus-ring'

function Pilulas({
  legenda,
  nome,
  opcoes,
  valor,
  aoMudar,
}: {
  legenda: string
  nome: string
  opcoes: readonly { valor: string; rotulo: string }[]
  valor: string
  aoMudar: (v: string) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className={CLASSE_ROTULO}>{legenda}</legend>
      <div className="flex flex-wrap gap-2">
        {opcoes.map((o) => (
          <label key={o.valor} className={CLASSE_PILULA}>
            <input
              type="radio"
              name={nome}
              value={o.valor}
              checked={valor === o.valor}
              onChange={() => aoMudar(o.valor)}
              className="sr-only"
            />
            {o.rotulo}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function FormularioNovaDemanda({ projetos }: FormularioNovaDemandaProps) {
  const [estado, criar, criando] = useActionState(criarDemandaAction, {})
  const [projetoId, setProjetoId] = useState(projetos[0]?.id ?? '')
  const [nivelEscolhido, setNivelEscolhido] = useState<string | null>(null)
  const [temTela, setTemTela] = useState('sim')

  const projeto = projetos.find((p) => p.id === projetoId)
  // Enquanto a pessoa não escolheu, o nível acompanha o padrão do projeto.
  const nivel = nivelEscolhido ?? projeto?.nivelPadrao ?? 'aprovar_desenho'

  return (
    <form
      action={criar}
      className="max-w-[620px] space-y-5 rounded-padrao border border-border bg-surface p-6"
    >
      <MensagensDeEstado estado={estado} />

      <div className="space-y-1">
        <label htmlFor="nova-demanda-projeto" className={CLASSE_ROTULO}>
          Projeto
        </label>
        <select
          id="nova-demanda-projeto"
          name="projetoId"
          required
          value={projetoId}
          onChange={(e) => {
            setProjetoId(e.target.value)
            setNivelEscolhido(null)
          }}
          className={CLASSE_CAMPO}
        >
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </div>

      {projeto && projeto.repositorios.length > 1 && (
        <div className="space-y-1">
          <label htmlFor="nova-demanda-repositorio" className={CLASSE_ROTULO}>
            Repositório
          </label>
          {/* `key` recomeça no primeiro repositório ao trocar de projeto. */}
          <select
            key={projeto.id}
            id="nova-demanda-repositorio"
            name="repositorioId"
            required
            defaultValue={projeto.repositorios[0]!.id}
            className={CLASSE_CAMPO}
          >
            {projeto.repositorios.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nomeCompleto}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="nova-demanda-titulo" className={CLASSE_ROTULO}>
          O que você quer
        </label>
        <input
          id="nova-demanda-titulo"
          name="titulo"
          type="text"
          required
          maxLength={120}
          placeholder="Título curto"
          className={CLASSE_CAMPO}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="nova-demanda-detalhes" className={CLASSE_ROTULO}>
          Detalhes (opcional)
        </label>
        <textarea
          id="nova-demanda-detalhes"
          name="descricao"
          rows={4}
          maxLength={4000}
          placeholder="Escreva, cole imagem ou anexe um áudio"
          className={CLASSE_CAMPO}
        />
        <label htmlFor="nova-demanda-anexos" className="block pt-1 text-xs text-text-secondary">
          Anexos
        </label>
        <input
          id="nova-demanda-anexos"
          name="anexos"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,audio/*"
          className="block w-full text-sm text-text-secondary"
        />
        <p className="text-xs text-text-secondary">Até 3 arquivos de 10 MB.</p>
      </div>

      <Pilulas
        legenda="Quanto você quer acompanhar"
        nome="nivel"
        opcoes={NIVEIS.map((n) => ({ valor: n, rotulo: ROTULO_DO_NIVEL[n] }))}
        valor={nivel}
        aoMudar={setNivelEscolhido}
      />

      <Pilulas
        legenda="Tem tela?"
        nome="temTela"
        opcoes={[
          { valor: 'sim', rotulo: 'Sim' },
          { valor: 'nao', rotulo: 'Não' },
        ]}
        valor={temTela}
        aoMudar={setTemTela}
      />

      <Button type="submit" aria-busy={criando} disabled={criando}>
        Criar demanda
      </Button>
    </form>
  )
}
