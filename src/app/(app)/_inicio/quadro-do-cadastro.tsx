import type { Inicio } from '@/modules/inicio/queries'
import { CLASSE_DO_CARTAO, TituloDeSecao } from './titulo-de-secao'

export interface QuadroDoCadastroProps {
  cadastro: NonNullable<Inicio['cadastro']>
}

export function QuadroDoCadastro({ cadastro }: QuadroDoCadastroProps) {
  const linhas = [
    { rotulo: 'Clientes', valor: cadastro.clientes },
    { rotulo: 'Projetos', valor: cadastro.projetos },
    { rotulo: 'Repositórios vinculados', valor: cadastro.repositorios },
    { rotulo: 'Máquinas', valor: cadastro.maquinas },
  ]
  return (
    <section aria-labelledby="titulo-cadastro">
      <TituloDeSecao id="titulo-cadastro">Cadastro</TituloDeSecao>
      <dl className={`${CLASSE_DO_CARTAO} divide-y divide-border px-4 py-1`}>
        {linhas.map((l) => (
          <div key={l.rotulo} className="flex justify-between gap-3 py-[7px] text-[13px]">
            <dt className="text-text-secondary">{l.rotulo}</dt>
            <dd className="text-text-primary">{l.valor}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
