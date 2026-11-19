import { exigirPermissao, type Sujeito } from '@/lib/auth/autorizar'
import { db } from '@/lib/db'
import { criarCliente, editarCliente } from '@/modules/clientes/service'
import { normalizarNome } from '@/modules/clientes/model'
import { vincularRepositorio } from '@/modules/github/service'
import { associarProjetoAoRecurso, cadastrarRecurso, editarRecurso } from '@/modules/infra/service'
import { associarCliente, criarProjeto, editarProjeto } from '@/modules/projetos/service'
import {
  planejarImportacao,
  type ArquivoDeCadastro,
  type EstadoAtual,
  type PlanoDeImportacao,
} from './model'

async function lerEstadoAtual(): Promise<EstadoAtual> {
  const [clientes, projetos, maquinas, repositorios] = await Promise.all([
    db.cliente.findMany({ select: { id: true, nomeNormalizado: true } }),
    db.projeto.findMany({
      select: {
        id: true,
        nomeNormalizado: true,
        clientes: { select: { clienteId: true } },
        repositorios: {
          where: { removidoDaInstalacaoEm: null },
          select: { nomeCompleto: true },
        },
      },
    }),
    db.recurso.findMany({
      select: { id: true, nomeNormalizado: true, projetos: { select: { projetoId: true } } },
    }),
    db.repositorioGitHub.findMany({
      where: { removidoDaInstalacaoEm: null },
      select: { id: true, nomeCompleto: true, projetoId: true },
    }),
  ])

  return {
    clientes,
    projetos: projetos.map((p) => ({
      id: p.id,
      nomeNormalizado: p.nomeNormalizado,
      clientes: p.clientes.map((c) => c.clienteId),
      repositorios: p.repositorios.map((r) => r.nomeCompleto),
    })),
    maquinas: maquinas.map((m) => ({
      id: m.id,
      nomeNormalizado: m.nomeNormalizado,
      projetos: m.projetos.map((p) => p.projetoId),
    })),
    repositoriosCatalogados: repositorios,
  }
}

function porNome<T extends { nome: string }>(itens: T[]): Map<string, T> {
  return new Map(itens.map((i) => [normalizarNome(i.nome), i]))
}

export async function importarCadastro(
  sujeito: Sujeito,
  arquivo: ArquivoDeCadastro,
  opcoes: { simular: boolean },
): Promise<PlanoDeImportacao> {
  exigirPermissao(sujeito, 'clientes.gerenciar')
  exigirPermissao(sujeito, 'projetos.gerenciar')
  exigirPermissao(sujeito, 'infraestrutura.gerenciar')

  const atual = await lerEstadoAtual()
  const plano = planejarImportacao(arquivo, atual)
  if (opcoes.simular || plano.erros.length > 0) {
    return plano
  }

  const clientes = porNome(arquivo.clientes)
  const projetos = porNome(arquivo.projetos)
  const maquinas = porNome(arquivo.maquinas)
  const idsDeClientes = new Map(atual.clientes.map((c) => [c.nomeNormalizado, c.id]))
  const idsDeProjetos = new Map(atual.projetos.map((p) => [p.nomeNormalizado, p.id]))
  const idsDeMaquinas = new Map(atual.maquinas.map((m) => [m.nomeNormalizado, m.id]))
  const idsDeRepositorios = new Map(
    atual.repositoriosCatalogados.map((r) => [r.nomeCompleto.trim().toLowerCase(), r.id]),
  )

  const idDe = (ids: Map<string, string>, nome: string): string => {
    const id = ids.get(normalizarNome(nome))
    if (!id) {
      throw new Error(`Item "${nome}" não encontrado durante a importação.`)
    }
    return id
  }

  for (const acao of plano.acoes) {
    switch (acao.tipo) {
      case 'criar-cliente':
      case 'atualizar-cliente': {
        const item = clientes.get(normalizarNome(acao.nome))!
        const dados = { nome: item.nome, observacoes: item.observacoes ?? null }
        if (acao.tipo === 'criar-cliente') {
          const { id } = await criarCliente(sujeito, dados)
          idsDeClientes.set(normalizarNome(item.nome), id)
        } else {
          await editarCliente(sujeito, idDe(idsDeClientes, item.nome), dados)
        }
        break
      }
      case 'criar-projeto':
      case 'atualizar-projeto': {
        const item = projetos.get(normalizarNome(acao.nome))!
        const dados = { nome: item.nome, descricao: item.descricao ?? null }
        if (acao.tipo === 'criar-projeto') {
          const { id } = await criarProjeto(sujeito, dados)
          idsDeProjetos.set(normalizarNome(item.nome), id)
        } else {
          await editarProjeto(sujeito, idDe(idsDeProjetos, item.nome), dados)
        }
        break
      }
      case 'associar-cliente':
        await associarCliente(
          sujeito,
          idDe(idsDeProjetos, acao.projeto),
          idDe(idsDeClientes, acao.cliente),
        )
        break
      case 'vincular-repositorio': {
        const repositorioId = idsDeRepositorios.get(acao.repositorio.trim().toLowerCase())
        if (!repositorioId) {
          throw new Error(`Repositório "${acao.repositorio}" não encontrado durante a importação.`)
        }
        await vincularRepositorio(sujeito, idDe(idsDeProjetos, acao.projeto), repositorioId)
        break
      }
      case 'criar-maquina':
      case 'atualizar-maquina': {
        const item = maquinas.get(normalizarNome(acao.nome))!
        const dados = {
          nome: item.nome,
          identificadorExterno: item.identificadorExterno ?? null,
          provedor: item.provedor ?? null,
          endereco: item.endereco ?? null,
          especificacao: item.especificacao ?? null,
          custoMensal: item.custoMensal ?? null,
          hospedadoEmId: item.hospedadaEm ? idDe(idsDeMaquinas, item.hospedadaEm) : null,
        }
        if (acao.tipo === 'criar-maquina') {
          const { id } = await cadastrarRecurso(sujeito, { ...dados, tipo: item.tipo })
          idsDeMaquinas.set(normalizarNome(item.nome), id)
        } else {
          await editarRecurso(sujeito, idDe(idsDeMaquinas, item.nome), dados)
        }
        break
      }
      case 'associar-maquina':
        await associarProjetoAoRecurso(
          sujeito,
          idDe(idsDeMaquinas, acao.maquina),
          idDe(idsDeProjetos, acao.projeto),
        )
        break
    }
  }

  return plano
}
