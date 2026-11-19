import { notFound } from 'next/navigation'

// A lista global saiu: o desenvolvimento agora é uma aba de cada projeto.
// Sem esta página, /desenvolvimento cairia na tela 404 genérica, fora do shell.
export default function PaginaDesenvolvimentoRemovida(): never {
  notFound()
}
