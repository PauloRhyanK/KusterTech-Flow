import { z } from 'zod'
import { normalizarNome } from '@/modules/clientes/model'
import type { TipoRecurso } from '@/modules/infra/model'

const TIPOS_DE_MAQUINA = [
  'SERVIDOR',
  'CONTAINER',
  'BANCO',
  'STORAGE',
  'OUTRO',
] as const satisfies readonly TipoRecurso[]

const textoOpcional = z.string().nullish()

export const arquivoDeCadastroSchema = z
  .object({
    clientes: z
      .array(z.object({ nome: z.string().min(1), observacoes: textoOpcional }).strict())
      .default([]),
    projetos: z
      .array(
        z
          .object({
            nome: z.string().min(1),
            descricao: textoOpcional,
            clientes: z.array(z.string().min(1)).default([]),
            repositorios: z.array(z.string().min(1)).default([]),
          })
          .strict(),
      )
      .default([]),
    maquinas: z
      .array(
        z
          .object({
            nome: z.string().min(1),
            tipo: z.enum(TIPOS_DE_MAQUINA),
            identificadorExterno: textoOpcional,
            provedor: textoOpcional,
            endereco: textoOpcional,
            especificacao: textoOpcional,
            custoMensal: z.number().nonnegative().nullish(),
            hospedadaEm: textoOpcional,
            projetos: z.array(z.string().min(1)).default([]),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()

export type ArquivoDeCadastro = z.infer<typeof arquivoDeCadastroSchema>

export interface EstadoAtual {
  clientes: { id: string; nomeNormalizado: string }[]
  projetos: { id: string; nomeNormalizado: string; clientes: string[]; repositorios: string[] }[]
  maquinas: { id: string; nomeNormalizado: string; projetos: string[] }[]
  repositoriosCatalogados: { id: string; nomeCompleto: string; projetoId: string | null }[]
}

export type Acao =
  | { tipo: 'criar-cliente' | 'atualizar-cliente'; nome: string }
  | { tipo: 'criar-projeto' | 'atualizar-projeto'; nome: string }
  | { tipo: 'associar-cliente'; projeto: string; cliente: string }
  | { tipo: 'vincular-repositorio'; projeto: string; repositorio: string }
  | { tipo: 'criar-maquina' | 'atualizar-maquina'; nome: string }
  | { tipo: 'associar-maquina'; maquina: string; projeto: string }

export interface PlanoDeImportacao {
  acoes: Acao[]
  repositoriosPendentes: string[]
  erros: string[]
}

function chaveDeRepositorio(nomeCompleto: string): string {
  return nomeCompleto.trim().toLowerCase()
}

function apontarRepetidos(rotulo: string, nomes: string[], erros: string[]): void {
  const vistos = new Set<string>()
  for (const nome of nomes) {
    const chave = normalizarNome(nome)
    if (vistos.has(chave)) {
      erros.push(`${rotulo} repetido no arquivo: "${nome}".`)
    }
    vistos.add(chave)
  }
}

// Hospedeiras antes das máquinas que elas hospedam; ciclo vira erro.
function ordenarMaquinas(
  maquinas: ArquivoDeCadastro['maquinas'],
  erros: string[],
): ArquivoDeCadastro['maquinas'] {
  const porNome = new Map(maquinas.map((m) => [normalizarNome(m.nome), m]))
  const ordenadas: ArquivoDeCadastro['maquinas'] = []
  const estado = new Map<string, 'visitando' | 'pronta'>()

  const visitar = (maquina: ArquivoDeCadastro['maquinas'][number]): void => {
    const chave = normalizarNome(maquina.nome)
    const situacao = estado.get(chave)
    if (situacao === 'pronta') {
      return
    }
    if (situacao === 'visitando') {
      erros.push(`Máquinas hospedadas em ciclo: "${maquina.nome}".`)
      return
    }
    estado.set(chave, 'visitando')
    const hospedeira = maquina.hospedadaEm ? porNome.get(normalizarNome(maquina.hospedadaEm)) : null
    if (hospedeira && hospedeira !== maquina) {
      visitar(hospedeira)
    }
    estado.set(chave, 'pronta')
    ordenadas.push(maquina)
  }

  maquinas.forEach(visitar)
  return ordenadas
}

export function planejarImportacao(
  arquivo: ArquivoDeCadastro,
  atual: EstadoAtual,
): PlanoDeImportacao {
  const erros: string[] = []
  const acoes: Acao[] = []
  const repositoriosPendentes: string[] = []

  apontarRepetidos(
    'Cliente',
    arquivo.clientes.map((c) => c.nome),
    erros,
  )
  apontarRepetidos(
    'Projeto',
    arquivo.projetos.map((p) => p.nome),
    erros,
  )
  apontarRepetidos(
    'Máquina',
    arquivo.maquinas.map((m) => m.nome),
    erros,
  )

  const clientesDoBanco = new Map(atual.clientes.map((c) => [c.nomeNormalizado, c.id]))
  const projetosDoBanco = new Map(atual.projetos.map((p) => [p.nomeNormalizado, p]))
  const maquinasDoBanco = new Map(atual.maquinas.map((m) => [m.nomeNormalizado, m]))
  const catalogo = new Map(
    atual.repositoriosCatalogados.map((r) => [chaveDeRepositorio(r.nomeCompleto), r]),
  )

  const clientesDoArquivo = new Set(arquivo.clientes.map((c) => normalizarNome(c.nome)))
  const projetosDoArquivo = new Set(arquivo.projetos.map((p) => normalizarNome(p.nome)))
  const maquinasDoArquivo = new Set(arquivo.maquinas.map((m) => normalizarNome(m.nome)))

  for (const cliente of arquivo.clientes) {
    acoes.push({
      tipo: clientesDoBanco.has(normalizarNome(cliente.nome))
        ? 'atualizar-cliente'
        : 'criar-cliente',
      nome: cliente.nome,
    })
  }

  for (const projeto of arquivo.projetos) {
    acoes.push({
      tipo: projetosDoBanco.has(normalizarNome(projeto.nome))
        ? 'atualizar-projeto'
        : 'criar-projeto',
      nome: projeto.nome,
    })
  }

  const donosDeRepositorio = new Map<string, string>()
  for (const projeto of arquivo.projetos) {
    const existente = projetosDoBanco.get(normalizarNome(projeto.nome))

    const clientesVistos = new Set<string>()
    for (const cliente of projeto.clientes) {
      const chave = normalizarNome(cliente)
      if (clientesVistos.has(chave)) {
        continue
      }
      clientesVistos.add(chave)
      const idDoCliente = clientesDoBanco.get(chave)
      if (!clientesDoArquivo.has(chave) && idDoCliente === undefined) {
        erros.push(`Projeto "${projeto.nome}" cita o cliente "${cliente}", que não existe.`)
        continue
      }
      if (existente && idDoCliente !== undefined && existente.clientes.includes(idDoCliente)) {
        continue
      }
      acoes.push({ tipo: 'associar-cliente', projeto: projeto.nome, cliente })
    }

    const repositoriosVistos = new Set<string>()
    for (const repositorio of projeto.repositorios) {
      const chave = chaveDeRepositorio(repositorio)
      if (repositoriosVistos.has(chave)) {
        continue
      }
      repositoriosVistos.add(chave)

      const outroProjeto = donosDeRepositorio.get(chave)
      if (outroProjeto !== undefined) {
        erros.push(
          `Repositório "${repositorio}" aparece nos projetos "${outroProjeto}" e "${projeto.nome}".`,
        )
        continue
      }
      donosDeRepositorio.set(chave, projeto.nome)

      const catalogado = catalogo.get(chave)
      if (!catalogado) {
        repositoriosPendentes.push(repositorio)
        continue
      }
      if (catalogado.projetoId !== null) {
        if (existente && catalogado.projetoId === existente.id) {
          continue
        }
        erros.push(`Repositório "${repositorio}" já está vinculado a outro projeto.`)
        continue
      }
      acoes.push({ tipo: 'vincular-repositorio', projeto: projeto.nome, repositorio })
    }
  }

  const ordenadas = ordenarMaquinas(arquivo.maquinas, erros)
  for (const maquina of ordenadas) {
    if (maquina.hospedadaEm) {
      const chave = normalizarNome(maquina.hospedadaEm)
      if (chave === normalizarNome(maquina.nome)) {
        erros.push(`Máquina "${maquina.nome}" não pode hospedar a si mesma.`)
      } else if (!maquinasDoArquivo.has(chave) && !maquinasDoBanco.has(chave)) {
        erros.push(
          `Máquina "${maquina.nome}" é hospedada em "${maquina.hospedadaEm}", que não existe.`,
        )
      }
    }
    acoes.push({
      tipo: maquinasDoBanco.has(normalizarNome(maquina.nome))
        ? 'atualizar-maquina'
        : 'criar-maquina',
      nome: maquina.nome,
    })
  }

  for (const maquina of ordenadas) {
    const existente = maquinasDoBanco.get(normalizarNome(maquina.nome))
    const projetosVistos = new Set<string>()
    for (const projeto of maquina.projetos) {
      const chave = normalizarNome(projeto)
      if (projetosVistos.has(chave)) {
        continue
      }
      projetosVistos.add(chave)
      const doBanco = projetosDoBanco.get(chave)
      if (!projetosDoArquivo.has(chave) && !doBanco) {
        erros.push(`Máquina "${maquina.nome}" cita o projeto "${projeto}", que não existe.`)
        continue
      }
      if (existente && doBanco && existente.projetos.includes(doBanco.id)) {
        continue
      }
      acoes.push({ tipo: 'associar-maquina', maquina: maquina.nome, projeto })
    }
  }

  return { acoes, repositoriosPendentes, erros }
}
