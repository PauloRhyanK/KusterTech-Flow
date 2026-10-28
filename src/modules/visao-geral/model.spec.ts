import { describe, expect, test } from 'vitest'
import type { Sujeito } from '@/lib/auth/autorizar'
import { formatarDataHora } from '@/lib/data'
import type { ItemChecklist } from '@/modules/projetos/model'
import {
  agruparHomologacoes,
  indicadoresDeInfraestrutura,
  indicadoresDeProjetos,
  LIMITE_EXPANDIDO,
  LIMITE_POR_GRUPO,
  lerGrupoExpandido,
  naturezasElegiveis,
  ORDEM_DE_PRIORIDADE,
  pendenciaDeAlerta,
  pendenciaDeAutorizacao,
  pendenciaDeConfiguracao,
  pendenciaDeDivergencia,
  pendenciaDeIntegracao,
  priorizarPendencias,
  tiposDePendenciaVisiveis,
  TITULOS_DOS_GRUPOS,
  type DadosDoResumoDeInfraestrutura,
  type DadosDoResumoDeProjetos,
  type EntradaDePendencias,
  type LinhaDeHomologacao,
  type Pendencia,
  type TipoDePendencia,
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

function pendencia(tipo: TipoDePendencia, n: number, extra: Partial<Pendencia> = {}): Pendencia {
  return {
    id: `${tipo}:${String(n).padStart(3, '0')}`,
    tipo,
    titulo: `Item ${n}`,
    contexto: 'ctx',
    href: '/x',
    estado: { texto: 'Estado', tom: 'neutro' },
    indicador: null,
    peso: 0,
    desde: new Date(Date.UTC(2026, 9, 1, 0, n)),
    ...extra,
  }
}

function entrada(
  tipo: TipoDePendencia,
  quantidade: number,
  total = quantidade,
): EntradaDePendencias {
  return {
    tipo,
    itens: Array.from({ length: quantidade }, (_, i) => pendencia(tipo, i + 1)),
    total,
  }
}

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

describe('priorizarPendencias', () => {
  test('ordena os grupos homologacao, autorizacao-prod, divergencia, alerta, integracao, configuracao qualquer que seja a entrada; tipo sem itens não gera grupo', () => {
    const embaralhado: EntradaDePendencias[] = [
      entrada('configuracao', 1),
      entrada('alerta', 1),
      entrada('homologacao', 1),
      entrada('integracao', 1),
      entrada('divergencia', 1),
      entrada('autorizacao-prod', 1),
    ]
    expect(priorizarPendencias(embaralhado, null).map((g) => g.tipo)).toEqual([
      'homologacao',
      'autorizacao-prod',
      'divergencia',
      'alerta',
      'integracao',
      'configuracao',
    ])
    expect(ORDEM_DE_PRIORIDADE).toEqual([
      'homologacao',
      'autorizacao-prod',
      'divergencia',
      'alerta',
      'integracao',
      'configuracao',
    ])
    const grupos = priorizarPendencias([entrada('alerta', 0), entrada('divergencia', 1)], null)
    expect(grupos.map((g) => g.tipo)).toEqual(['divergencia'])
    expect(grupos[0]?.titulo).toBe(TITULOS_DOS_GRUPOS.divergencia)
    expect(TITULOS_DOS_GRUPOS).toEqual({
      homologacao: 'Homologações',
      'autorizacao-prod': 'Autorizações de PROD',
      divergencia: 'Divergências de deploy',
      alerta: 'Alertas ativos',
      integracao: 'Integrações',
      configuracao: 'Configuração incompleta',
    })
  })

  test('no grupo alerta, CRITICA de 2026-10-25 vem antes de ALTA de 2026-10-20; empate de peso: desde mais antigo primeiro; empate total: id', () => {
    const alta = pendencia('alerta', 1, { peso: 1, desde: new Date('2026-10-20T00:00:00Z') })
    const critica = pendencia('alerta', 2, { peso: 0, desde: new Date('2026-10-25T00:00:00Z') })
    const altaAntiga = pendencia('alerta', 3, { peso: 1, desde: new Date('2026-10-10T00:00:00Z') })
    const empateB = pendencia('alerta', 5, { peso: 2, desde: new Date('2026-10-01T00:00:00Z') })
    const empateA = pendencia('alerta', 4, { peso: 2, desde: new Date('2026-10-01T00:00:00Z') })
    const [grupo] = priorizarPendencias(
      [{ tipo: 'alerta', itens: [alta, empateB, critica, empateA, altaAntiga], total: 5 }],
      null,
    )
    expect(grupo?.itens.map((i) => i.id)).toEqual([
      critica.id,
      altaAntiga.id,
      alta.id,
      empateA.id,
      empateB.id,
    ])
  })

  test('7 itens → 5 exibidos, total 7, verTodas { rotulo: "Ver todas (7)", href: "/?grupo=homologacao#grupo-homologacao" }; 5 itens → verTodas null', () => {
    const [sete] = priorizarPendencias([entrada('homologacao', 7)], null)
    expect(sete?.itens).toHaveLength(LIMITE_POR_GRUPO)
    expect(sete?.total).toBe(7)
    expect(sete?.verTodas).toEqual({
      rotulo: 'Ver todas (7)',
      href: '/?grupo=homologacao#grupo-homologacao',
    })
    expect(sete?.recolher).toBeNull()
    const [cinco] = priorizarPendencias([entrada('homologacao', 5)], null)
    expect(cinco?.verTodas).toBeNull()
  })

  test('expandido homologacao com 50 itens e total 60 → 50 exibidos, aviso "Mostrando 50 de 60.", recolher { rotulo: "Mostrar menos", href: "/#grupo-homologacao" }; os outros grupos continuam em 5', () => {
    const grupos = priorizarPendencias(
      [entrada('homologacao', LIMITE_EXPANDIDO, 60), entrada('divergencia', 8)],
      'homologacao',
    )
    const homologacao = grupos.find((g) => g.tipo === 'homologacao')
    expect(homologacao?.itens).toHaveLength(50)
    expect(homologacao?.aviso).toBe('Mostrando 50 de 60.')
    expect(homologacao?.recolher).toEqual({
      rotulo: 'Mostrar menos',
      href: '/#grupo-homologacao',
    })
    expect(homologacao?.verTodas).toBeNull()
    const divergencia = grupos.find((g) => g.tipo === 'divergencia')
    expect(divergencia?.itens).toHaveLength(5)
    expect(divergencia?.aviso).toBeNull()
  })

  test('alerta com total 9 → verTodas { rotulo: "Ver os 9 alertas ativos", href: "/infraestrutura/alertas" }; expandido alerta é tratado como null', () => {
    const [grupo] = priorizarPendencias([entrada('alerta', 9)], 'alerta')
    expect(grupo?.itens).toHaveLength(5)
    expect(grupo?.verTodas).toEqual({
      rotulo: 'Ver os 9 alertas ativos',
      href: '/infraestrutura/alertas',
    })
    expect(grupo?.recolher).toBeNull()
    expect(grupo?.aviso).toBeNull()
  })

  test('entrada { falha: true } gera grupo com falha true, total 0 e sem verTodas', () => {
    const [grupo] = priorizarPendencias([{ tipo: 'alerta', falha: true }], null)
    expect(grupo).toMatchObject({
      tipo: 'alerta',
      falha: true,
      total: 0,
      itens: [],
      verTodas: null,
      aviso: null,
      recolher: null,
    })
  })
})

describe('lerGrupoExpandido', () => {
  const todos = ORDEM_DE_PRIORIDADE
  test('grupo=divergencia → divergencia; xyz, lista, ausente ou tipo fora de visiveis → null', () => {
    expect(lerGrupoExpandido({ grupo: 'divergencia' }, todos)).toBe('divergencia')
    expect(lerGrupoExpandido({ grupo: 'xyz' }, todos)).toBeNull()
    expect(lerGrupoExpandido({ grupo: ['alerta', 'divergencia'] }, todos)).toBeNull()
    expect(lerGrupoExpandido({}, todos)).toBeNull()
    expect(lerGrupoExpandido({ grupo: 'alerta' }, ['homologacao'])).toBeNull()
  })
})

describe('tiposDePendenciaVisiveis', () => {
  test('ADMIN → os seis em ORDEM_DE_PRIORIDADE; TESTADOR_A → [homologacao]; APROVADOR_GLOBAL → [homologacao]', () => {
    expect(tiposDePendenciaVisiveis(ADMIN)).toEqual([...ORDEM_DE_PRIORIDADE])
    expect(tiposDePendenciaVisiveis(TESTADOR_A)).toEqual(['homologacao'])
    expect(tiposDePendenciaVisiveis(APROVADOR_GLOBAL)).toEqual(['homologacao'])
  })
})

describe('naturezasElegiveis', () => {
  test('TESTADOR_A em A → [testar, retestar]; em B → []; APROVADOR_GLOBAL em B → [testar, retestar]; ADMIN → todas as naturezas', () => {
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
})

describe('agruparHomologacoes', () => {
  test('2 itens PENDENTE_DE_TESTE na mesma homologação → 1 pendência "2 issues" com href /clientes/A/projetos/P/entregas/milestones/M?aba=homologacao e desde do mais antigo', () => {
    const antigo = new Date('2026-10-05T08:00:00Z')
    const resultado = agruparHomologacoes(
      [
        linha({ itemId: 'a', atualizadoEm: new Date('2026-10-09T08:00:00Z') }),
        linha({
          itemId: 'b',
          atualizadoEm: antigo,
          issue: { id: 'I2', numero: 2, titulo: 'Item 2' },
        }),
      ],
      TESTADOR_A,
    )
    expect(resultado).toHaveLength(1)
    expect(resultado[0]).toMatchObject({
      tipo: 'homologacao',
      titulo: 'Marco 1',
      contexto: 'Cliente A · Portal',
      indicador: '2 issues',
      href: '/clientes/A/projetos/P/entregas/milestones/M?aba=homologacao',
      estado: { texto: 'Pendente de teste', tom: 'informacao' },
      desde: antigo,
    })
  })

  test('1 item → título "#1 Item 1 de portal" e href /clientes/A/projetos/P/entregas/issues/I1?milestone=M (errata 11)', () => {
    const [p] = agruparHomologacoes([linha()], TESTADOR_A)
    expect(p).toMatchObject({
      titulo: '#1 Item 1 de portal',
      contexto: 'Cliente A · Portal · Marco 1',
      indicador: null,
      href: '/clientes/A/projetos/P/entregas/issues/I1?milestone=M',
    })
  })

  test('naturezas distintas na mesma homologação geram pendências separadas, com textos e tons fixos', () => {
    const resultado = agruparHomologacoes(
      [
        linha({ itemId: 'a', estado: 'AGUARDANDO_RETESTE' }),
        linha({ itemId: 'b', estado: 'AGUARDANDO_DISPONIBILIZACAO' }),
      ],
      ADMIN,
    )
    expect(resultado.map((p) => p.estado)).toEqual([
      { texto: 'Aguardando reteste', tom: 'atencao' },
      { texto: 'Aguardando disponibilização', tom: 'neutro' },
    ])
    expect(new Set(resultado.map((p) => p.id)).size).toBe(2)
  })

  test('CORRECAO_SOLICITADA sem solicitação aberta → nada; com solicitação aberta e sem tarefa pendente → "Correção a triar" só para ADMIN; APROVADA → nada; item do cliente B para TESTADOR_A → nada', () => {
    const semSolicitacao = linha({ estado: 'CORRECAO_SOLICITADA' })
    expect(agruparHomologacoes([semSolicitacao], ADMIN)).toEqual([])

    const aberta = linha({ estado: 'CORRECAO_SOLICITADA', solicitacao: 'ABERTA' })
    const [triar] = agruparHomologacoes([aberta], ADMIN)
    expect(triar?.estado).toEqual({ texto: 'Correção a triar', tom: 'atencao' })
    expect(agruparHomologacoes([aberta], TESTADOR_A)).toEqual([])
    expect(agruparHomologacoes([aberta], APROVADOR_GLOBAL)).toEqual([])

    expect(agruparHomologacoes([linha({ estado: 'APROVADA' })], ADMIN)).toEqual([])

    const doClienteB = linha({ cliente: { id: 'B', nome: 'Cliente B' } })
    expect(agruparHomologacoes([doClienteB], TESTADOR_A)).toEqual([])
  })

  test('errata 7: solicitação aberta com TarefaGitHub pendente não é triar; RESPONDIDA_SEM_TAREFA → "Reteste a confirmar" só para ADMIN', () => {
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
    expect(confirmar?.estado).toEqual({ texto: 'Reteste a confirmar', tom: 'atencao' })
    expect(agruparHomologacoes([respondida], TESTADOR_A)).toEqual([])
  })
})

describe('pendências de outros tipos', () => {
  const projeto = { id: 'P', nome: 'Portal' }

  test('autorização: textos, tons e href por estado da composição', () => {
    const base = {
      composicaoId: 'C1',
      calculadaEm: new Date('2026-10-20T15:00:00Z'),
      projeto,
      repositorio: 'kustertech-exemplo/portal',
      versao: { id: 'V1', rotulo: 'v1.2' },
    }
    const identificada = pendenciaDeAutorizacao({ ...base, estado: 'IDENTIFICADA' })
    expect(identificada).toMatchObject({
      id: 'autorizacao-prod:C1',
      tipo: 'autorizacao-prod',
      titulo: 'Autorizar v1.2 em PROD',
      contexto: `Portal · kustertech-exemplo/portal · composição calculada em ${formatarDataHora(base.calculadaEm)}`,
      href: '/projetos/P/publicacoes?versao=V1',
      estado: { texto: 'Aguardando autorização', tom: 'informacao' },
      desde: base.calculadaEm,
    })
    expect(pendenciaDeAutorizacao({ ...base, estado: 'INCERTA' }).estado).toEqual({
      texto: 'Verificação humana necessária',
      tom: 'atencao',
    })
  })

  test('divergência: título, contexto, href e estado', () => {
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
      titulo: 'Deploy em PROD sem autorização registrada: v1.3',
      contexto: `Portal · kustertech-exemplo/portal · detectada em ${formatarDataHora(detectadaEm)}`,
      href: '/projetos/P/publicacoes#divergencia-D1',
      estado: { texto: 'Não reconhecida', tom: 'atencao' },
      desde: detectadaEm,
    })
  })

  test('alerta: severidade define texto, tom e peso; contexto com fallbacks; indicador só com mais de uma ocorrência', () => {
    const primeiraOcorrenciaEm = new Date('2026-10-22T10:00:00Z')
    const base = {
      id: 'AL1',
      titulo: 'CPU alta',
      primeiraOcorrenciaEm,
      ocorrencias: 1,
      recurso: null,
      projeto: null,
    }
    const critica = pendenciaDeAlerta({ ...base, severidade: 'CRITICA' })
    expect(critica).toMatchObject({
      id: 'alerta:AL1',
      titulo: 'CPU alta',
      contexto: `Sem recurso associado · Sem projeto associado · desde ${formatarDataHora(primeiraOcorrenciaEm)}`,
      href: '/infraestrutura/alertas#alerta-AL1',
      estado: { texto: 'Crítica', tom: 'erro' },
      indicador: null,
      peso: 0,
      desde: primeiraOcorrenciaEm,
    })
    const alta = pendenciaDeAlerta({
      ...base,
      severidade: 'ALTA',
      ocorrencias: 3,
      recurso: 'srv-1',
      projeto: 'Portal',
    })
    expect(alta).toMatchObject({
      estado: { texto: 'Alta', tom: 'erro' },
      peso: 1,
      indicador: '3 ocorrências',
    })
    expect(alta.contexto.startsWith('srv-1 · Portal · desde ')).toBe(true)
    expect(pendenciaDeAlerta({ ...base, severidade: 'MEDIA' })).toMatchObject({
      estado: { texto: 'Média', tom: 'atencao' },
      peso: 2,
    })
    expect(pendenciaDeAlerta({ ...base, severidade: 'BAIXA' })).toMatchObject({
      estado: { texto: 'Baixa', tom: 'neutro' },
      peso: 3,
    })
  })

  test('pendenciaDeIntegracao: [conectada, indisponivel] → "Indisponível"/erro; [sem-dados-recentes] → "Sem dados recentes"/atencao; [conectada] → null', () => {
    const maisAntiga = new Date('2026-10-01T10:00:00Z')
    const indisponivel = pendenciaDeIntegracao(projeto, [
      { estado: 'conectada', sincronizadoEm: new Date('2026-10-20T10:00:00Z') },
      { estado: 'indisponivel', sincronizadoEm: maisAntiga },
    ])
    expect(indisponivel).toMatchObject({
      id: 'integracao:P',
      titulo: 'GitHub — Portal',
      contexto: `Última sincronização: ${formatarDataHora(maisAntiga)}`,
      href: '/projetos/P/configuracao#repositorios',
      estado: { texto: 'Indisponível', tom: 'erro' },
      desde: maisAntiga,
    })
    const semDados = pendenciaDeIntegracao(projeto, [
      { estado: 'sem-dados-recentes', sincronizadoEm: null },
    ])
    expect(semDados?.estado).toEqual({ texto: 'Sem dados recentes', tom: 'atencao' })
    expect(semDados?.contexto).toBe('Nenhuma sincronização concluída')
    expect(semDados?.desde).toEqual(new Date(0))
    expect(
      pendenciaDeIntegracao(projeto, [{ estado: 'conectada', sincronizadoEm: new Date() }]),
    ).toBeNull()
  })

  test('pendenciaDeConfiguracao: clientes e github pendentes → "Falta: Clientes, GitHub" e "Não configurado"; clientes concluído e github pendente → "Parcial"; só indisponivel e concluido → null', () => {
    const criadoEm = new Date('2026-09-01T00:00:00Z')
    const item = (
      chave: ItemChecklist['chave'],
      titulo: string,
      estado: ItemChecklist['estado'],
    ): ItemChecklist => ({ chave, titulo, descricao: '', estado })
    const p = { ...projeto, criadoEm }

    const nao = pendenciaDeConfiguracao(p, [
      item('clientes', 'Clientes', 'pendente'),
      item('github', 'GitHub', 'pendente'),
    ])
    expect(nao).toMatchObject({
      id: 'configuracao:P',
      titulo: 'Portal',
      contexto: 'Falta: Clientes, GitHub',
      href: '/projetos/P',
      estado: { texto: 'Não configurado', tom: 'neutro' },
      desde: criadoEm,
    })
    const parcial = pendenciaDeConfiguracao(p, [
      item('clientes', 'Clientes', 'concluido'),
      item('github', 'GitHub', 'pendente'),
    ])
    expect(parcial?.estado).toEqual({ texto: 'Parcial', tom: 'neutro' })
    expect(
      pendenciaDeConfiguracao(p, [
        item('ambientes', 'Ambientes', 'indisponivel'),
        item('clientes', 'Clientes', 'concluido'),
      ]),
    ).toBeNull()
  })
})

describe('invariante 9', () => {
  test('nenhuma pendência de nenhum tipo, em nenhuma variação, tem tom sucesso', () => {
    const data = new Date('2026-10-20T00:00:00Z')
    const projeto = { id: 'P', nome: 'Portal' }
    const todas: (Pendencia | null)[] = [
      ...(['PENDENTE_DE_TESTE', 'AGUARDANDO_RETESTE', 'AGUARDANDO_DISPONIBILIZACAO'] as const).map(
        (estado) => agruparHomologacoes([linha({ estado })], ADMIN)[0] ?? null,
      ),
      agruparHomologacoes(
        [linha({ estado: 'CORRECAO_SOLICITADA', solicitacao: 'ABERTA' })],
        ADMIN,
      )[0] ?? null,
      agruparHomologacoes(
        [linha({ estado: 'CORRECAO_SOLICITADA', solicitacao: 'RESPONDIDA_SEM_TAREFA' })],
        ADMIN,
      )[0] ?? null,
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
      ...(['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'] as const).map((severidade) =>
        pendenciaDeAlerta({
          id: 'A',
          titulo: 't',
          severidade,
          primeiraOcorrenciaEm: data,
          ocorrencias: 2,
          recurso: null,
          projeto: null,
        }),
      ),
      ...(['sem-dados-recentes', 'indisponivel'] as const).map((estado) =>
        pendenciaDeIntegracao(projeto, [{ estado, sincronizadoEm: null }]),
      ),
      pendenciaDeConfiguracao({ ...projeto, criadoEm: data }, [
        { chave: 'clientes', titulo: 'Clientes', descricao: '', estado: 'pendente' },
      ]),
    ]
    const presentes = todas.filter((p): p is Pendencia => p !== null)
    expect(presentes).toHaveLength(todas.length)
    for (const p of presentes) {
      expect(p.estado.tom).not.toBe('sucesso')
    }
  })
})

const PROJETOS_BASE: DadosDoResumoDeProjetos = {
  escopo: 'global',
  projetosAtivos: 4,
  configuracaoIncompleta: 1,
  milestonesAtivas: 2,
  homologacoesEmAndamento: 3,
  github: {
    configurada: true,
    vinculados: 3,
    semDadosRecentes: 0,
    indisponiveis: 1,
    sincronizacaoMaisAntiga: new Date('2026-10-26T11:40:00Z'),
  },
}

const INFRA_BASE: DadosDoResumoDeInfraestrutura = {
  recursosPorTipo: {},
  alertasAtivos: 0,
  alertasCriticos: 0,
  alertasReconhecidos: 0,
  fontesDeAlertas: 1,
  alertasJaRegistrados: 0,
}

function porRotulo(indicadores: readonly { rotulo: string }[], rotulo: string) {
  const achado = indicadores.find((i) => i.rotulo === rotulo)
  if (!achado) throw new Error(`indicador ausente: ${rotulo}`)
  return achado as (typeof indicadores)[number] & {
    valor: string
    detalhe: string
    semDados: boolean
  }
}

describe('indicadores dos resumos', () => {
  test('indicadoresDeProjetos: GitHub não configurado → "Sem dados" e semDados true; 3 vinculados, 1 indisponível → "3 repositórios" e "1 indisponível"; escopo cliente → só dois indicadores', () => {
    const naoConfigurado = indicadoresDeProjetos({
      ...PROJETOS_BASE,
      github: {
        configurada: false,
        vinculados: 0,
        semDadosRecentes: 0,
        indisponiveis: 0,
        sincronizacaoMaisAntiga: null,
      },
    })
    expect(porRotulo(naoConfigurado, 'GitHub')).toMatchObject({
      valor: 'Sem dados',
      detalhe: 'A GitHub App da Central ainda não está configurada.',
      semDados: true,
    })

    const comProblema = indicadoresDeProjetos(PROJETOS_BASE)
    expect(porRotulo(comProblema, 'GitHub')).toMatchObject({
      valor: '3 repositórios',
      detalhe: '1 indisponível',
      semDados: false,
    })
    expect(porRotulo(comProblema, 'Projetos ativos').valor).toBe('4')
    expect(porRotulo(comProblema, 'Configuração incompleta').detalhe).toBe(
      'projetos com itens pendentes no checklist',
    )

    const semProblema = indicadoresDeProjetos({
      ...PROJETOS_BASE,
      github: { ...PROJETOS_BASE.github!, indisponiveis: 0 },
    })
    expect(porRotulo(semProblema, 'GitHub').detalhe).toBe(
      `Sincronização mais antiga: ${formatarDataHora(new Date('2026-10-26T11:40:00Z'))}`,
    )

    const doisProblemas = indicadoresDeProjetos({
      ...PROJETOS_BASE,
      github: { ...PROJETOS_BASE.github!, semDadosRecentes: 1, indisponiveis: 2 },
    })
    expect(porRotulo(doisProblemas, 'GitHub').detalhe).toBe(
      '1 sem dados recentes · 2 indisponíveis',
    )

    const vazio = indicadoresDeProjetos({
      ...PROJETOS_BASE,
      projetosAtivos: 0,
      github: { ...PROJETOS_BASE.github!, vinculados: 0, indisponiveis: 0 },
    })
    expect(porRotulo(vazio, 'Projetos ativos')).toMatchObject({
      valor: '0',
      detalhe: 'Nenhum projeto cadastrado.',
    })
    expect(porRotulo(vazio, 'GitHub')).toMatchObject({
      valor: '0 repositórios',
      detalhe: 'Nenhum repositório vinculado.',
    })

    const cliente = indicadoresDeProjetos({
      escopo: 'cliente',
      projetosAtivos: 1,
      configuracaoIncompleta: null,
      milestonesAtivas: null,
      homologacoesEmAndamento: 1,
      github: null,
    })
    expect(cliente.map((i) => i.rotulo)).toEqual([
      'Projetos dos seus clientes',
      'Homologações em andamento',
    ])
  })

  test('indicadoresDeInfraestrutura: {SERVIDOR: 2, CONTAINER: 1} → "3" e "2 servidores · 1 container"; sem fonte e sem alertas → "Sem dados"; com fonte e 0 ativos → "0" e "Nenhum alerta ativo nas fontes configuradas."; Saúde dos recursos sempre "Sem dados"', () => {
    const base = indicadoresDeInfraestrutura({
      ...INFRA_BASE,
      recursosPorTipo: { SERVIDOR: 2, CONTAINER: 1 },
    })
    expect(porRotulo(base, 'Recursos')).toMatchObject({
      valor: '3',
      detalhe: '2 servidores · 1 container',
    })
    expect(porRotulo(base, 'Alertas ativos')).toMatchObject({
      valor: '0',
      detalhe: 'Nenhum alerta ativo nas fontes configuradas.',
      semDados: false,
    })

    const semFonte = indicadoresDeInfraestrutura({ ...INFRA_BASE, fontesDeAlertas: 0 })
    expect(porRotulo(semFonte, 'Alertas ativos')).toMatchObject({
      valor: 'Sem dados',
      detalhe: 'Nenhuma fonte de alertas configurada.',
      semDados: true,
    })
    expect(porRotulo(semFonte, 'Recursos')).toMatchObject({
      valor: '0',
      detalhe: 'Nenhum recurso cadastrado.',
    })

    const comAlertas = indicadoresDeInfraestrutura({
      ...INFRA_BASE,
      fontesDeAlertas: 0,
      alertasJaRegistrados: 4,
      alertasAtivos: 2,
      alertasCriticos: 1,
      alertasReconhecidos: 1,
    })
    expect(porRotulo(comAlertas, 'Alertas ativos')).toMatchObject({
      valor: '2',
      detalhe: '1 crítico · 1 reconhecido ainda ativo na origem',
      semDados: false,
    })

    const plurais = indicadoresDeInfraestrutura({
      ...INFRA_BASE,
      recursosPorTipo: { BANCO: 2, STORAGE: 3, OUTRO: 1 },
      alertasAtivos: 5,
      alertasCriticos: 2,
      alertasReconhecidos: 3,
    })
    expect(porRotulo(plurais, 'Recursos').detalhe).toBe('2 bancos · 3 storages · 1 outro')
    expect(porRotulo(plurais, 'Alertas ativos').detalhe).toBe(
      '2 críticos · 3 reconhecidos ainda ativos na origem',
    )

    for (const indicadores of [base, semFonte, comAlertas, plurais]) {
      expect(porRotulo(indicadores, 'Saúde dos recursos')).toMatchObject({
        valor: 'Sem dados',
        detalhe: 'A Central ainda não recebe métricas; consulte o Beszel de cada recurso.',
        semDados: true,
      })
    }
  })
})
