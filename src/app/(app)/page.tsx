import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { autorizar } from '@/lib/auth/autorizar'
import { obterSessao } from '@/lib/auth/sessao'
import { moduloAtivo } from '@/lib/modulos'
import { CabecalhoDePagina } from '@/lib/ui/cabecalho-de-pagina'
import { obterInicio } from '@/modules/inicio/queries'
import { Atividade } from './_inicio/atividade'
import { EsperaVoce } from './_inicio/espera-voce'
import { FabricaAgora } from './_inicio/fabrica-agora'
import { QuadroDaOficina } from './_inicio/quadro-da-oficina'
import { QuadroDoCadastro } from './_inicio/quadro-do-cadastro'
import { SeusProjetos } from './_inicio/seus-projetos'

export const metadata: Metadata = {
  title: 'Início',
}

export default async function PaginaInicio() {
  const sessao = await obterSessao()
  if (!sessao) {
    redirect('/entrar')
  }
  const { sujeito } = sessao

  const agora = new Date()
  const inicio = await obterInicio(sujeito, agora)
  const verFabrica =
    inicio.escopo === 'total' && moduloAtivo('fabrica') && autorizar(sujeito, 'desenvolvimento.ler')

  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        trilhas={[{ rotulo: 'Início' }]}
        titulo="Início"
        contexto={
          inicio.escopo === 'cliente'
            ? 'O que espera você nos seus clientes.'
            : 'O que espera você, o que a Fábrica está fazendo e como está a oficina.'
        }
      />
      {inicio.escopo === 'cliente' ? (
        <div className="space-y-6">
          <EsperaVoce espera={inicio.espera} agora={agora} />
          <SeusProjetos resumo={inicio.seusProjetos} />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            <EsperaVoce espera={inicio.espera} agora={agora} />
            {inicio.atividade !== null && <Atividade atividade={inicio.atividade} agora={agora} />}
            {verFabrica && (
              <FabricaAgora
                fabrica={inicio.fabrica}
                falhou={inicio.espera.fontesComFalha.includes('decisao')}
                agora={agora}
              />
            )}
          </div>
          <div className="min-w-0 space-y-6">
            <QuadroDaOficina oficina={inicio.oficina} agora={agora} />
            {inicio.cadastro && <QuadroDoCadastro cadastro={inicio.cadastro} />}
          </div>
        </div>
      )}
    </div>
  )
}
