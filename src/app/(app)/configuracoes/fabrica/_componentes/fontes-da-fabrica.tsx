'use client'

import { FontesComToken, type FonteNaLista, type TextosDeFontes } from '@/lib/ui/fontes-com-token'
import { criarFonteDaFabricaAction, revogarFonteDaFabricaAction } from '../actions'

export type FonteDaFabricaNaLista = FonteNaLista

export interface FontesDaFabricaProps {
  fontes: readonly FonteDaFabricaNaLista[]
}

const TEXTOS: TextosDeFontes = {
  titulo: 'Tokens de envio',
  ariaDaLista: 'Tokens da Fábrica',
  vazioTitulo: 'Nenhum token criado.',
  vazioDescricao: 'Crie um token para a máquina de agentes enviar o estado da Fábrica à Central.',
  avisoDoToken:
    'Copie agora; o token não será mostrado de novo. Na máquina de agentes, guarde-o no arquivo indicado por FABRICA_CENTRAL_TOKEN_FILE.',
  idDoCampoNome: 'fonte-fabrica-nome',
}

export function FontesDaFabrica({ fontes }: FontesDaFabricaProps) {
  return (
    <FontesComToken
      fontes={fontes}
      criarAction={criarFonteDaFabricaAction}
      revogarAction={revogarFonteDaFabricaAction}
      textos={TEXTOS}
    />
  )
}
