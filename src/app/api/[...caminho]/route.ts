import { respostaDeApiNaoEncontrada } from '@/lib/api-nao-encontrada'

// Qualquer caminho sob /api sem rota própria responde 404 em JSON, não a página HTML.
export const GET = respostaDeApiNaoEncontrada
export const POST = respostaDeApiNaoEncontrada
export const PUT = respostaDeApiNaoEncontrada
export const PATCH = respostaDeApiNaoEncontrada
export const DELETE = respostaDeApiNaoEncontrada
