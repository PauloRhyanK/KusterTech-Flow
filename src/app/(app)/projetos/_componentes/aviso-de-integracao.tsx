import Link from 'next/link'
import { formatarDataHora } from '@/lib/data'
import { EstadoVazio } from '@/lib/ui/estado-vazio'
import type { SituacaoDaIntegracao } from '@/modules/github/service'

export interface AvisoDeIntegracaoProps {
  situacao: SituacaoDaIntegracao
  sincronizadoEm: Date | null
  hrefConfiguracao: string | null
}

export function AvisoDeIntegracao({
  situacao,
  sincronizadoEm,
  hrefConfiguracao,
}: AvisoDeIntegracaoProps) {
  const data = sincronizadoEm ? formatarDataHora(sincronizadoEm) : null

  switch (situacao.estadoDoProjeto) {
    case 'conectada':
      return null
    case 'nao-configurada':
      return (
        <EstadoVazio
          tipo="nao-configurado"
          titulo="O GitHub ainda não está configurado neste projeto."
          descricao="Vincule os repositórios do projeto para ver as issues aqui."
          acao={
            hrefConfiguracao ? (
              <Link href={hrefConfiguracao} className="text-sm text-text-link hover:underline">
                Vincular repositórios
              </Link>
            ) : undefined
          }
        />
      )
    case 'sem-dados-recentes':
      return (
        <EstadoVazio
          tipo="dados-desatualizados"
          titulo="Os dados do GitHub podem estar desatualizados."
          descricao={data ? `Última sincronização: ${data}.` : 'Ainda não houve sincronização.'}
        />
      )
    case 'indisponivel':
      return (
        <EstadoVazio
          tipo="falha-integracao"
          titulo="Integração com o GitHub indisponível."
          descricao={
            data
              ? `Mostrando os últimos dados obtidos em ${data}.`
              : 'Ainda não há dados obtidos do GitHub.'
          }
        />
      )
  }
}
