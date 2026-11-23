import { describe, expect, it } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { formatarDataHora } from '@/lib/data'
import { normalizarRetrato, type RetratoV1 } from '@/modules/fabrica/contrato'
import type { RetratoRecebido } from '@/modules/fabrica/queries'
import {
  ACAO_DE_LEITURA,
  LIMITE_DE_ESPERA,
  ORDEM_DOS_TIPOS,
  ROTULO_DO_TIPO,
  agruparHomologacoes,
  esperasComDecidir,
  esperasDaFabrica,
  esperasDasDemandas,
  esperasDaOficina,
  esperasDaPublicacao,
  formatarIdade,
  indicadoresDeProjetos,
  montarEsperaVoce,
  naturezasElegiveis,
  pendenciaDeAutorizacao,
  pendenciaDeDivergencia,
  pendenciaDeIntegracao,
  type ItemDeEspera,
  type LinhaDeDemanda,
  type LinhaDeHomologacao,
  type TipoDeEspera,
} from './model'

const ADMIN: Sujeito = { usuarioId: 'u-admin', papeis: [{ papel: 'ADMIN', clienteId: null }] }
const TESTADOR_A: Sujeito = {
  usuarioId: 'u-testador',
  papeis: [{ papel: 'TESTADOR', clienteId: 'A' }],
}
const APROVADOR_GLOBAL: Sujeito = {
  usuarioId: 'u-aprovador',
  papeis: [{ papel: 'APROVADOR', clienteId: null }],
}

const AGORA = new Date('2026-11-19T12:00:00Z')
const minutosAntes = (m: number) => new Date(AGORA.getTime() - m * 60_000)

function item(tipo: TipoDeEspera, id: string, desde: Date | null): ItemDeEspera {
  return {
    id,
    tipo,
    titulo: id,
    contexto: 'ctx',
    href: '/x',
    externo: false,
    rotuloDoLink: 'Abrir',
    tom: 'atencao',
    desde,
  }
}

type Plano = RetratoV1['planos'][number]

function plano(extra: Partial<Plano> = {}): Plano {
  return {
    id: 'p1',
    repo: 'kustertech-exemplo/portal',
    feature: 'telas-crm',
    estado: 'ativo',
    entrouEm: '2026-11-19T10:00:00Z',
    faseAtual: null,
    fases: [],
    pausado: null,
    decisoes: [],
    orquestradorAtivo: true,
    ...extra,
  }
}

function recebido(planos: Plano[], recebidoEm: Date = minutosAntes(1)): RetratoRecebido {
  return {
    versaoOriginal: 1,
    retrato: normalizarRetrato({
      versao: 1,
      geradoEm: '2026-11-19T11:59:00Z',
      vagas: {
        efetivas: 2,
        configuradas: 3,
        ocupadas: 1,
        ramMinimaMb: 2048,
        memDisponivelMb: 5120,
        oomEm: null,
      },
      drenagem: null,
      warren: { preparo: null, em: null },
      planos,
      avisos: [],
    }),
    geradoEm: recebidoEm,
    recebidoEm,
  }
}

const semNome = () => null

function linha(extra: Partial<LinhaDeHomologacao> = {}): LinhaDeHomologacao {
  return {
    itemId: 'it1',
    homologacaoId: 'H1',
    estado: 'PENDENTE_DE_TESTE',
    solicitacao: null,
    temTarefaPendente: false,
    atualizadoEm: new Date('2026-10-10T12:00:00Z'),
    cliente: { id: 'A', nome: 'Cliente A' },
    projeto: { id: 'P', nome: 'Portal' },
    milestone: { id: 'M', titulo: 'Marco 1' },
    issue: { id: 'I1', numero: 1, titulo: 'Item 1 de portal' },
    ...extra,
  }
}

describe('tipos de espera', () => {
  it('ordem, rótulos e ação de leitura de cada tipo', () => {
    expect(ORDEM_DOS_TIPOS).toEqual([
      'decidir',
      'decisao',
      'demanda',
      'plano-pausado',
      'aviso-da-oficina',
      'fabrica-sem-noticias',
      'publicacao',
      'integracao',
      'homologacao',
      'autorizacao-prod',
      'divergencia',
    ])
    expect(ORDEM_DOS_TIPOS.map((t) => ROTULO_DO_TIPO[t])).toEqual([
      'Decidir',
      'Decisão',
      'Demanda',
      'Plano pausado',
      'Oficina',
      'Fábrica',
      'Publicação',
      'Integração',
      'Homologação',
      'Autorização',
      'Divergência',
    ])
    expect(ACAO_DE_LEITURA).toEqual({
      decidir: 'desenvolvimento.ler',
      decisao: 'desenvolvimento.ler',
      demanda: 'desenvolvimento.ler',
      'plano-pausado': 'desenvolvimento.ler',
      'fabrica-sem-noticias': 'desenvolvimento.ler',
      publicacao: 'desenvolvimento.ler',
      'aviso-da-oficina': 'infraestrutura.ler',
      integracao: 'projetos.gerenciar',
      homologacao: 'clientes.ler',
      'autorizacao-prod': 'publicacao.autorizar',
      divergencia: 'publicacao.autorizar',
    })
    expect(LIMITE_DE_ESPERA).toBe(20)
  })
})

describe('tipo demanda', () => {
  const agora = new Date('2026-11-19T15:00:00Z')
  const linha = {
    id: 'd1',
    titulo: 'Tela de funil de vendas',
    projeto: 'Projeto A',
    espera: 'aprovar_desenho' as const,
    esperaMotivo: null,
    esperaDesde: new Date('2026-11-19T14:30:00Z'),
    rotuloDaEtapa: 'Desenho',
  }
  const quieta = { buscouEm: agora, recebidasParadas: 0, recebidaMaisAntigaDesde: null }

  it('ORDEM_DOS_TIPOS tem demanda logo depois de decisao e ROTULO_DO_TIPO.demanda === "Demanda"', () => {
    expect(ORDEM_DOS_TIPOS[ORDEM_DOS_TIPOS.indexOf('decisao') + 1]).toBe('demanda')
    expect(ROTULO_DO_TIPO.demanda).toBe('Demanda')
  })

  it('esperasDasDemandas: aprovar_desenho leva à demanda', () => {
    expect(esperasDasDemandas([linha], quieta, agora)).toEqual([
      expect.objectContaining({
        id: 'demanda:d1',
        tipo: 'demanda',
        titulo: 'Aprovar o desenho de Tela de funil de vendas',
        contexto: 'Projeto A · há 30 min',
        href: '/demandas/d1',
        rotuloDoLink: 'Ver a demanda',
      }),
    ])
  })

  it('esperasDasDemandas: título de cada espera e o motivo no contexto', () => {
    const t = (espera: LinhaDeDemanda['espera']) =>
      esperasDasDemandas([{ ...linha, espera, esperaMotivo: 'porque sim' }], quieta, agora)[0]!
    expect(t('planejar_comigo').titulo).toBe('Planejar Tela de funil de vendas com você')
    expect(t('decidir_destino').titulo).toBe('Decidir o destino de Tela de funil de vendas')
    expect(t('travada').titulo).toBe('Tela de funil de vendas travou')
    expect(t('teste_falhou').titulo).toBe(
      'Tela de funil de vendas: o teste no navegador falhou duas vezes',
    )
    expect(t('concluir_etapa').titulo).toBe('Concluir Desenho de Tela de funil de vendas')
    expect(t('travada').contexto).toBe('Projeto A · porque sim')
  })

  it('esperasDasDemandas: o aviso da Fábrica depende da recebida mais antiga e da última busca', () => {
    const antes = (min: number) => new Date(agora.getTime() - min * 60_000)
    const avisos = (buscouEm: Date | null, recebidaMaisAntigaDesde: Date | null, n = 2) =>
      esperasDasDemandas([], { buscouEm, recebidasParadas: n, recebidaMaisAntigaDesde }, agora)
    // demanda velha + Fábrica parada há 11 min
    expect(avisos(antes(11), antes(30))).toEqual([
      expect.objectContaining({
        titulo: 'A Fábrica não busca demandas há 11 min',
        contexto: '2 demandas esperando a triagem',
        href: '/demandas',
      }),
    ])
    // demanda velha + nunca buscou
    expect(avisos(null, antes(30), 1)).toEqual([
      expect.objectContaining({
        titulo: 'A Fábrica nunca buscou demandas',
        contexto: '1 demanda esperando a triagem',
      }),
    ])
    // demanda recém-criada + Fábrica parada (ou nunca buscou): sem aviso
    expect(avisos(antes(11), antes(1))).toEqual([])
    expect(avisos(null, antes(1))).toEqual([])
    // demanda velha + Fábrica em dia: sem aviso
    expect(avisos(antes(9), antes(30))).toEqual([])
    // sem recebidas: sem aviso
    expect(avisos(antes(11), null, 0)).toEqual([])
  })
})

describe('tipo publicacao', () => {
  it('ORDEM_DOS_TIPOS tem publicacao logo depois de fabrica-sem-noticias e ROTULO_DO_TIPO.publicacao === "Publicação"', () => {
    const i = ORDEM_DOS_TIPOS.indexOf('fabrica-sem-noticias')
    expect(ORDEM_DOS_TIPOS[i + 1]).toBe('publicacao')
    expect(ROTULO_DO_TIPO.publicacao).toBe('Publicação')
  })

  it('esperasDaPublicacao: aviso vira item que leva à tela Publicação; o do PR leva ao PR', () => {
    const desde = new Date('2026-11-19T14:00:00Z')
    const base = {
      repositorioId: 'r1',
      titulo: 'Projeto Beta parou: o agente não conseguiu consertar',
      contexto: 'falhou ao publicar 9d2e41b',
      href: 'https://github.com/kustertech-exemplo/beta/actions/runs/7',
      externo: true,
      tom: 'erro' as const,
      desde,
    }
    expect(
      esperasDaPublicacao([
        { ...base, id: 'parado-r1' },
        {
          ...base,
          id: 'pr-do-conserto-r2',
          titulo: 'Projeto Alfa: PR do conserto espera revisão',
          href: 'https://github.com/kustertech-exemplo/base/pull/212',
          rotuloDoLink: 'Ver o PR',
          tom: 'atencao',
        },
      ]),
    ).toEqual([
      {
        id: 'publicacao:parado-r1',
        tipo: 'publicacao',
        titulo: 'Projeto Beta parou: o agente não conseguiu consertar',
        contexto: 'falhou ao publicar 9d2e41b',
        href: '/publicacao',
        externo: false,
        rotuloDoLink: 'Ver a publicação',
        tom: 'erro',
        desde,
      },
      {
        id: 'publicacao:pr-do-conserto-r2',
        tipo: 'publicacao',
        titulo: 'Projeto Alfa: PR do conserto espera revisão',
        contexto: 'falhou ao publicar 9d2e41b',
        href: 'https://github.com/kustertech-exemplo/base/pull/212',
        externo: true,
        rotuloDoLink: 'Ver o PR',
        tom: 'atencao',
        desde,
      },
    ])
  })
})

describe('montarEsperaVoce', () => {
  it('ordena por tipo e, dentro do tipo, do mais antigo ao mais novo, com sem-data por último', () => {
    const r = montarEsperaVoce([
      { tipo: 'integracao', itens: [item('integracao', 'i1', minutosAntes(90))] },
      {
        tipo: 'decisao',
        itens: [
          item('decisao', 'd-sem-data-b', null),
          item('decisao', 'd-novo', minutosAntes(5)),
          item('decisao', 'd-sem-data-a', null),
          item('decisao', 'd-antigo', minutosAntes(50)),
        ],
      },
      { tipo: 'aviso-da-oficina', itens: [item('aviso-da-oficina', 'o1', minutosAntes(1))] },
    ])
    expect(r.itens.map((i) => i.id)).toEqual([
      'd-antigo',
      'd-novo',
      'd-sem-data-a',
      'd-sem-data-b',
      'o1',
      'i1',
    ])
    expect(r).toMatchObject({ total: 6, ocultos: 0, fontesComFalha: [] })
  })

  it('corta em 20 e informa os ocultos', () => {
    const vinteECinco = Array.from({ length: 25 }, (_, i) =>
      item('decisao', `d${String(i).padStart(2, '0')}`, null),
    )
    const r = montarEsperaVoce([{ tipo: 'decisao', itens: vinteECinco }])
    expect(r.itens).toHaveLength(20)
    expect(r.total).toBe(25)
    expect(r.ocultos).toBe(5)
  })

  it('fonte com falha aparece em fontesComFalha e não zera as outras', () => {
    const r = montarEsperaVoce([
      { tipo: 'integracao', falha: true },
      { tipo: 'decisao', itens: [item('decisao', 'd1', null)] },
      { tipo: 'aviso-da-oficina', falha: true },
    ])
    expect(r.itens.map((i) => i.id)).toEqual(['d1'])
    expect(r.total).toBe(1)
    expect(r.fontesComFalha).toEqual(['aviso-da-oficina', 'integracao'])
  })
})

describe('esperasDaFabrica', () => {
  it('cada decisão do retrato vira um item externo com o link da issue e sem data', () => {
    const r = recebido([
      plano({
        decisoes: [
          { titulo: 'Qual campo identifica o cliente?', url: 'https://github.com/o/r/issues/1' },
          { titulo: 'Aprovar a fase 3', url: 'https://github.com/o/r/pull/2' },
        ],
      }),
    ])
    const itens = esperasDaFabrica(r, AGORA, semNome)
    expect(itens).toHaveLength(2)
    expect(itens[0]).toMatchObject({
      tipo: 'decisao',
      titulo: 'Qual campo identifica o cliente?',
      contexto: 'kustertech-exemplo/portal · telas-crm',
      href: 'https://github.com/o/r/issues/1',
      externo: true,
      rotuloDoLink: 'Responder no GitHub',
      desde: null,
    })
    expect(itens[1]!.href).toBe('https://github.com/o/r/pull/2')
    expect(new Set(itens.map((i) => i.id)).size).toBe(2)
  })

  it('usa o nome do projeto quando o repositório está vinculado, e o repo quando não está', () => {
    const decisoes = [{ titulo: 'Decidir', url: 'https://github.com/o/r/issues/1' }]
    const r = recebido([
      plano({ id: 'a', repo: 'o/vinculado', decisoes }),
      plano({ id: 'b', repo: 'o/solto', decisoes }),
    ])
    const nomes = (repo: string) => (repo === 'o/vinculado' ? 'Projeto Alfa' : null)
    expect(esperasDaFabrica(r, AGORA, nomes).map((i) => i.contexto)).toEqual([
      'Projeto Alfa · telas-crm',
      'o/solto · telas-crm',
    ])
  })

  it('plano com pausado vira item plano-pausado apontando para /fabrica', () => {
    const r = recebido([plano({ estado: 'pausado', pausado: 'Falta memória para a raia 3' })])
    expect(esperasDaFabrica(r, AGORA, semNome)).toEqual([
      expect.objectContaining({
        tipo: 'plano-pausado',
        titulo: 'Falta memória para a raia 3',
        contexto: 'kustertech-exemplo/portal · telas-crm',
        href: '/fabrica',
        externo: false,
      }),
    ])
  })

  it('retrato de 6 min vira "A Fábrica não envia dados há 6 min"; de 4 min não gera item', () => {
    const velho = recebido([], minutosAntes(6))
    expect(esperasDaFabrica(velho, AGORA, semNome)).toEqual([
      expect.objectContaining({
        tipo: 'fabrica-sem-noticias',
        titulo: 'A Fábrica não envia dados há 6 min',
        href: '/fabrica',
        externo: false,
        desde: velho.recebidoEm,
      }),
    ])
    expect(esperasDaFabrica(recebido([], minutosAntes(4)), AGORA, semNome)).toEqual([])
  })

  it('planos concluídos ou removidos não geram decisão nem plano pausado', () => {
    const decisoes = [{ titulo: 'Decidir', url: 'https://github.com/o/r/issues/1' }]
    const r = recebido([
      plano({ id: 'c', estado: 'concluido', pausado: 'Parado', decisoes }),
      plano({ id: 'r', estado: 'removido', pausado: 'Parado', decisoes }),
      plano({ id: 'a', estado: 'aguardando', decisoes }),
    ])
    expect(esperasDaFabrica(r, AGORA, semNome).map((i) => i.id)).toEqual(['decisao:a:0'])
  })

  it('sem retrato não gera item da Fábrica', () => {
    expect(esperasDaFabrica(null, AGORA, semNome)).toEqual([])
  })
})

describe('esperasDaOficina', () => {
  it('aviso da oficina vira item com o link da máquina', () => {
    const desde = minutosAntes(30)
    const itens = esperasDaOficina(
      [
        { tipo: 'disco', mensagem: 'Disco em 91%, acima do limite de 80%.', desde },
        { tipo: 'limpeza', mensagem: 'Nenhuma limpeza registrada.', desde: null },
      ],
      '/maquinas/r1',
    )
    expect(itens).toHaveLength(2)
    expect(itens[0]).toMatchObject({
      tipo: 'aviso-da-oficina',
      titulo: 'Disco em 91%, acima do limite de 80%.',
      href: '/maquinas/r1',
      externo: false,
      rotuloDoLink: 'Ver a máquina',
      desde,
    })
    expect(itens[1]!.desde).toBeNull()
    expect(new Set(itens.map((i) => i.id)).size).toBe(2)
  })
})

describe('formatarIdade', () => {
  it('menos de 1 min, minutos, horas e dias', () => {
    expect(formatarIdade(new Date(AGORA.getTime() - 20_000), AGORA)).toBe('há menos de 1 min')
    expect(formatarIdade(minutosAntes(40), AGORA)).toBe('há 40 min')
    expect(formatarIdade(minutosAntes(125), AGORA)).toBe('há 2 h')
    expect(formatarIdade(minutosAntes(3 * 24 * 60 + 10), AGORA)).toBe('há 3 d')
  })
})

describe('agruparHomologacoes', () => {
  it('naturezasElegiveis: TESTADOR_A em A → [testar, retestar]; em B → []; ADMIN → todas', () => {
    expect(naturezasElegiveis(TESTADOR_A, 'A')).toEqual(['testar', 'retestar'])
    expect(naturezasElegiveis(TESTADOR_A, 'B')).toEqual([])
    expect(naturezasElegiveis(APROVADOR_GLOBAL, 'B')).toEqual(['testar', 'retestar'])
    expect(naturezasElegiveis(ADMIN, 'A')).toEqual([
      'testar',
      'retestar',
      'disponibilizar',
      'triar',
      'confirmar-reteste',
    ])
  })

  it('2 itens PENDENTE_DE_TESTE na mesma homologação → 1 item "2 issues" com href da milestone e desde do mais antigo', () => {
    const antigo = new Date('2026-10-05T08:00:00Z')
    const resultado = agruparHomologacoes(
      [
        linha({ itemId: 'a', atualizadoEm: new Date('2026-10-09T08:00:00Z') }),
        linha({ itemId: 'b', atualizadoEm: antigo, issue: { id: 'I2', numero: 2, titulo: 'I2' } }),
      ],
      TESTADOR_A,
    )
    expect(resultado).toHaveLength(1)
    expect(resultado[0]).toMatchObject({
      tipo: 'homologacao',
      titulo: 'Marco 1',
      contexto: 'Pendente de teste · Cliente A · Portal · 2 issues',
      href: '/clientes/A/projetos/P/entregas/milestones/M?aba=homologacao',
      externo: false,
      tom: 'informacao',
      desde: antigo,
    })
  })

  it('1 item → título "#1 Item 1 de portal" e href da issue no contexto do cliente', () => {
    const [p] = agruparHomologacoes([linha()], TESTADOR_A)
    expect(p).toMatchObject({
      titulo: '#1 Item 1 de portal',
      contexto: 'Pendente de teste · Cliente A · Portal · Marco 1',
      href: '/clientes/A/projetos/P/entregas/issues/I1?milestone=M',
    })
  })

  it('naturezas distintas na mesma homologação geram itens separados, com tons fixos', () => {
    const resultado = agruparHomologacoes(
      [
        linha({ itemId: 'a', estado: 'AGUARDANDO_RETESTE' }),
        linha({ itemId: 'b', estado: 'AGUARDANDO_DISPONIBILIZACAO' }),
      ],
      ADMIN,
    )
    expect(resultado.map((p) => p.tom)).toEqual(['atencao', 'neutro'])
    expect(resultado[0]!.contexto.startsWith('Aguardando reteste · ')).toBe(true)
    expect(new Set(resultado.map((p) => p.id)).size).toBe(2)
  })

  it('CORRECAO_SOLICITADA: sem solicitação → nada; aberta sem tarefa → "Correção a triar" só para ADMIN; APROVADA e outro cliente → nada', () => {
    expect(agruparHomologacoes([linha({ estado: 'CORRECAO_SOLICITADA' })], ADMIN)).toEqual([])
    const aberta = linha({ estado: 'CORRECAO_SOLICITADA', solicitacao: 'ABERTA' })
    const [triar] = agruparHomologacoes([aberta], ADMIN)
    expect(triar?.contexto.startsWith('Correção a triar · ')).toBe(true)
    expect(agruparHomologacoes([aberta], TESTADOR_A)).toEqual([])
    expect(agruparHomologacoes([aberta], APROVADOR_GLOBAL)).toEqual([])
    expect(agruparHomologacoes([linha({ estado: 'APROVADA' })], ADMIN)).toEqual([])
    const doClienteB = linha({ cliente: { id: 'B', nome: 'Cliente B' } })
    expect(agruparHomologacoes([doClienteB], TESTADOR_A)).toEqual([])
  })

  it('solicitação aberta com tarefa pendente não é triar; RESPONDIDA_SEM_TAREFA → "Reteste a confirmar" só para ADMIN', () => {
    const comTarefa = linha({
      estado: 'CORRECAO_SOLICITADA',
      solicitacao: 'ABERTA',
      temTarefaPendente: true,
    })
    expect(agruparHomologacoes([comTarefa], ADMIN)).toEqual([])
    const respondida = linha({
      estado: 'CORRECAO_SOLICITADA',
      solicitacao: 'RESPONDIDA_SEM_TAREFA',
    })
    const [confirmar] = agruparHomologacoes([respondida], ADMIN)
    expect(confirmar?.contexto.startsWith('Reteste a confirmar · ')).toBe(true)
    expect(agruparHomologacoes([respondida], TESTADOR_A)).toEqual([])
  })
})

describe('itens de publicação e integração', () => {
  const projeto = { id: 'P', nome: 'Portal' }

  it('autorização: título, contexto, href e tom por estado da composição', () => {
    const base = {
      composicaoId: 'C1',
      calculadaEm: new Date('2026-10-20T15:00:00Z'),
      projeto,
      repositorio: 'kustertech-exemplo/portal',
      versao: { id: 'V1', rotulo: 'v1.2' },
    }
    expect(pendenciaDeAutorizacao({ ...base, estado: 'IDENTIFICADA' })).toMatchObject({
      id: 'autorizacao-prod:C1',
      tipo: 'autorizacao-prod',
      titulo: 'Autorizar v1.2 em PROD',
      contexto: 'Aguardando autorização · Portal · kustertech-exemplo/portal',
      href: '/projetos/P/publicacoes?versao=V1',
      tom: 'informacao',
      desde: base.calculadaEm,
    })
    expect(pendenciaDeAutorizacao({ ...base, estado: 'INCERTA' })).toMatchObject({
      contexto: 'Verificação humana necessária · Portal · kustertech-exemplo/portal',
      tom: 'atencao',
    })
  })

  it('divergência: título, contexto, href e tom', () => {
    const detectadaEm = new Date('2026-10-21T09:00:00Z')
    expect(
      pendenciaDeDivergencia({
        id: 'D1',
        detectadaEm,
        projeto,
        repositorio: 'kustertech-exemplo/portal',
        rotulo: 'v1.3',
      }),
    ).toMatchObject({
      id: 'divergencia:D1',
      tipo: 'divergencia',
      titulo: 'Deploy em PROD sem autorização registrada: v1.3',
      contexto: 'Portal · kustertech-exemplo/portal',
      href: '/projetos/P/publicacoes#divergencia-D1',
      tom: 'atencao',
      desde: detectadaEm,
    })
  })

  it('integração: indisponível → erro com a sincronização mais antiga; sem dados recentes → atenção sem data; conectada → null', () => {
    const maisAntiga = new Date('2026-10-01T10:00:00Z')
    expect(
      pendenciaDeIntegracao(projeto, [
        { estado: 'conectada', sincronizadoEm: new Date('2026-10-20T10:00:00Z') },
        { estado: 'indisponivel', sincronizadoEm: maisAntiga },
      ]),
    ).toMatchObject({
      id: 'integracao:P',
      tipo: 'integracao',
      titulo: 'GitHub — Portal',
      contexto: `Indisponível · última sincronização ${formatarDataHora(maisAntiga)}`,
      href: '/projetos/P/configuracao#repositorios',
      rotuloDoLink: 'Abrir o projeto',
      tom: 'erro',
      desde: maisAntiga,
    })
    const semDados = pendenciaDeIntegracao(projeto, [
      { estado: 'sem-dados-recentes', sincronizadoEm: null },
    ])
    expect(semDados).toMatchObject({
      contexto: 'Sem dados recentes · nenhuma sincronização concluída',
      tom: 'atencao',
      desde: null,
    })
    expect(
      pendenciaDeIntegracao(projeto, [{ estado: 'conectada', sincronizadoEm: new Date() }]),
    ).toBeNull()
  })
})

describe('invariante 9', () => {
  it('nenhum item usa o tom sucesso', () => {
    const data = new Date('2026-10-20T00:00:00Z')
    const projeto = { id: 'P', nome: 'Portal' }
    const todos: (ItemDeEspera | null)[] = [
      ...esperasDaFabrica(
        recebido(
          [
            plano({
              pausado: 'Pausado',
              decisoes: [{ titulo: 'D', url: 'https://github.com/o/r/issues/1' }],
            }),
          ],
          minutosAntes(30),
        ),
        AGORA,
        semNome,
      ),
      ...esperasDaOficina([{ tipo: 'arquivo', mensagem: 'Backup falhou', desde: data }], '/m'),
      ...esperasDaPublicacao([
        {
          id: 'parado-r',
          repositorioId: 'r',
          titulo: 'Portal parou',
          contexto: 'falhou',
          href: '#r',
          externo: false,
          tom: 'erro',
          desde: data,
        },
      ]),
      ...(['aprovar_desenho', 'travada', 'teste_falhou'] as const).flatMap((espera) =>
        esperasDasDemandas(
          [
            {
              id: 'd',
              titulo: 'T',
              projeto: 'P',
              espera,
              esperaMotivo: null,
              esperaDesde: data,
              rotuloDaEtapa: 'E',
            },
          ],
          { buscouEm: data, recebidasParadas: 0, recebidaMaisAntigaDesde: null },
          data,
        ),
      ),
      ...(['PENDENTE_DE_TESTE', 'AGUARDANDO_RETESTE', 'AGUARDANDO_DISPONIBILIZACAO'] as const).map(
        (estado) => agruparHomologacoes([linha({ estado })], ADMIN)[0] ?? null,
      ),
      ...(['IDENTIFICADA', 'INCERTA'] as const).map((estado) =>
        pendenciaDeAutorizacao({
          composicaoId: 'C',
          estado,
          calculadaEm: data,
          projeto,
          repositorio: 'r',
          versao: { id: 'V', rotulo: 'v' },
        }),
      ),
      pendenciaDeDivergencia({
        id: 'D',
        detectadaEm: data,
        projeto,
        repositorio: 'r',
        rotulo: 'v',
      }),
      ...(['sem-dados-recentes', 'indisponivel'] as const).map((estado) =>
        pendenciaDeIntegracao(projeto, [{ estado, sincronizadoEm: null }]),
      ),
    ]
    const presentes = [
      ...todos.filter((p): p is ItemDeEspera => p !== null),
      ...esperasComDecidir([], 2),
    ]
    expect(presentes).toHaveLength(todos.length + 1)
    expect(new Set(presentes.map((p) => p.tipo)).size).toBe(ORDEM_DOS_TIPOS.length)
    for (const p of presentes) {
      expect(p.tom).not.toBe('sucesso')
    }
  })
})

describe('indicadoresDeProjetos', () => {
  it('perfil escopado: projetos dos seus clientes e, com homologação ativa, homologações em andamento', () => {
    expect(indicadoresDeProjetos({ projetosAtivos: 0, homologacoesEmAndamento: null })).toEqual([
      {
        rotulo: 'Projetos dos seus clientes',
        valor: '0',
        detalhe: 'Nenhum projeto dos seus clientes.',
      },
    ])
    expect(
      indicadoresDeProjetos({ projetosAtivos: 2, homologacoesEmAndamento: 1 }).map((i) => [
        i.rotulo,
        i.valor,
      ]),
    ).toEqual([
      ['Projetos dos seus clientes', '2'],
      ['Homologações em andamento', '1'],
    ])
  })
})

describe('esperasComDecidir', () => {
  const itens = [
    { ...item('decisao', 'decisao:p1:0', null), href: 'https://github.com/o/r/issues/1' },
    { ...item('decisao', 'decisao:p1:1', null), href: 'https://github.com/o/r/issues/2' },
    item('demanda', 'demanda:d1', minutosAntes(5)),
    item('demanda', 'demanda:d2', minutosAntes(5)),
    item('plano-pausado', 'plano-pausado:p1', null),
    item('fabrica-sem-noticias', 'fabrica-sem-buscar-demandas', null),
  ]

  it('tira só as decisões e as demandas que a pilha conta; mantém avisos e o resto', () => {
    const r = esperasComDecidir(itens, 3, {
      demandas: new Set(['d1']),
      decisoes: new Set(['https://github.com/o/r/issues/1']),
    })
    expect(r.map((i) => i.id)).toEqual([
      'decisao:p1:1',
      'demanda:d2',
      'plano-pausado:p1',
      'fabrica-sem-buscar-demandas',
      'decidir',
    ])
    expect(r.at(-1)).toMatchObject({
      tipo: 'decidir',
      titulo: '3 itens esperam sua resposta',
      href: '/decidir',
      rotuloDoLink: 'Abrir Decidir',
      tom: 'atencao',
      externo: false,
    })
  })

  it('um item usa o singular e pilha vazia não acrescenta nada', () => {
    expect(esperasComDecidir([], 1)[0]?.titulo).toBe('1 item espera sua resposta')
    expect(esperasComDecidir([], 0)).toEqual([])
  })

  it('o item do Decidir vem antes de tudo na ordem do Início', () => {
    const r = montarEsperaVoce([
      { tipo: 'plano-pausado', itens: [item('plano-pausado', 'p', null)] },
      { tipo: 'decidir', itens: esperasComDecidir([], 2) },
    ])
    expect(r.itens.map((i) => i.id)).toEqual(['decidir', 'p'])
  })
})
