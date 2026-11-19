import type { TipoRecurso as TipoRecursoPrisma } from '@prisma/client'
import { ErroDeDominio } from '@/lib/erros'
import type { TomDeEstado } from '@/lib/ui/badge-de-estado'

export type TipoRecurso = 'SERVIDOR' | 'CONTAINER' | 'BANCO' | 'STORAGE' | 'OUTRO'

type Paridade<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _paridadeTipo: Paridade<TipoRecurso, TipoRecursoPrisma> = true
void _paridadeTipo

const LIMITE_NOME = 120
const CUSTO_MAXIMO = 99999999.99

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

export function validarTextoOpcional(
  valor: string | null | undefined,
  rotulo: string,
  maximo: number,
): string | null {
  const aparado = valor?.trim() ?? ''
  if (aparado === '') {
    return null
  }
  if (aparado.length > maximo) {
    throw new ErroDeDominio(`${rotulo} deve ter até ${maximo} caracteres.`)
  }
  return aparado
}

export function validarCustoMensal(valor: string | number | null | undefined): string | null {
  const texto = typeof valor === 'number' ? String(valor) : (valor?.trim() ?? '')
  if (texto === '') {
    return null
  }
  if (!/^\d+([.,]\d{1,2})?$/.test(texto)) {
    throw new ErroDeDominio('Custo mensal inválido.')
  }
  const numero = Number(texto.replace(',', '.'))
  if (numero > CUSTO_MAXIMO) {
    throw new ErroDeDominio('Custo mensal inválido.')
  }
  return numero.toFixed(2)
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

export function situacaoDoRecurso(e: {
  arquivado: boolean
}): { chave: 'arquivado' | 'ativo'; texto: string; tom: TomDeEstado } | null {
  // Ativo não tem selo: não há fonte que comprove o estado da máquina.
  return e.arquivado ? { chave: 'arquivado', texto: 'Arquivado', tom: 'neutro' } : null
}
