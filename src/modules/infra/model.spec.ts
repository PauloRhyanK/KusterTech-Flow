import { describe, expect, test } from 'vitest'
import { ErroDeDominio } from '@/lib/erros'
import {
  chaveDedupeDoWebhook,
  chaveDedupeManual,
  estadoDoAlerta,
  hashDoTokenDeAlertas,
  lerCorpoDoAlerta,
  linksDeFerramentas,
  resumoDeSaude,
  rotuloDoTipo,
  apresentarEstadoDoAlerta,
  apresentarSeveridade,
  situacaoDoRecurso,
  validarHospedagem,
  validarNomeDeRecurso,
  validarUrlDeFerramenta,
  vezesRecebido,
  type SituacaoAtualDoAlerta,
} from './model'

const t1 = new Date('2026-10-27T10:00:00Z')
const t2 = new Date(t1.getTime() + 60 * 60 * 1000)

function situacao(parcial: Partial<SituacaoAtualDoAlerta>): SituacaoAtualDoAlerta {
  return {
    estado: 'ATIVO',
    origem: 'WEBHOOK',
    ultimaOcorrenciaEm: t1,
    resolvidoEm: null,
    ...parcial,
  }
}

describe('estadoDoAlerta', () => {
  test('estadoDoAlerta cobre a tabela inteira', () => {
    // atual null
    expect(estadoDoAlerta(null, { tipo: 'ocorrencia', em: t1 })).toEqual({
      efeito: 'criar',
      estado: 'ATIVO',
    })
    expect(estadoDoAlerta(null, { tipo: 'resolucao-na-origem', em: t1 })).toEqual({
      efeito: 'ignorar',
      estado: null,
    })
    expect(estadoDoAlerta(null, { tipo: 'reconhecer' })).toEqual({
      recusa: 'Alerta não encontrado.',
    })
    expect(estadoDoAlerta(null, { tipo: 'registrar-resolucao' })).toEqual({
      recusa: 'Alerta não encontrado.',
    })

    // ocorrência
    expect(estadoDoAlerta(situacao({ estado: 'ATIVO' }), { tipo: 'ocorrencia', em: t2 })).toEqual({
      efeito: 'repetir',
      estado: 'ATIVO',
    })
    expect(
      estadoDoAlerta(situacao({ estado: 'RECONHECIDO' }), { tipo: 'ocorrencia', em: t2 }),
    ).toEqual({ efeito: 'repetir', estado: 'RECONHECIDO' })
    const resolvido = situacao({ estado: 'RESOLVIDO_NA_ORIGEM', resolvidoEm: t1 })
    expect(estadoDoAlerta(resolvido, { tipo: 'ocorrencia', em: t2 })).toEqual({
      efeito: 'reabrir',
      estado: 'ATIVO',
    })
    expect(estadoDoAlerta(resolvido, { tipo: 'ocorrencia', em: t1 })).toEqual({
      efeito: 'nenhum',
      estado: 'RESOLVIDO_NA_ORIGEM',
    })

    // resolução na origem
    expect(
      estadoDoAlerta(situacao({ estado: 'ATIVO' }), { tipo: 'resolucao-na-origem', em: t1 }),
    ).toEqual({ efeito: 'resolver', estado: 'RESOLVIDO_NA_ORIGEM' })
    expect(
      estadoDoAlerta(situacao({ estado: 'RECONHECIDO', ultimaOcorrenciaEm: t1 }), {
        tipo: 'resolucao-na-origem',
        em: t2,
      }),
    ).toEqual({ efeito: 'resolver', estado: 'RESOLVIDO_NA_ORIGEM' })
    expect(
      estadoDoAlerta(situacao({ estado: 'ATIVO', ultimaOcorrenciaEm: t2 }), {
        tipo: 'resolucao-na-origem',
        em: t1,
      }),
    ).toEqual({ efeito: 'nenhum', estado: 'ATIVO' })
    expect(
      estadoDoAlerta(situacao({ estado: 'RECONHECIDO', ultimaOcorrenciaEm: t2 }), {
        tipo: 'resolucao-na-origem',
        em: t1,
      }),
    ).toEqual({ efeito: 'nenhum', estado: 'RECONHECIDO' })
    expect(estadoDoAlerta(resolvido, { tipo: 'resolucao-na-origem', em: t2 })).toEqual({
      efeito: 'nenhum',
      estado: 'RESOLVIDO_NA_ORIGEM',
    })

    // reconhecer ≠ resolver
    expect(estadoDoAlerta(situacao({ estado: 'ATIVO' }), { tipo: 'reconhecer' })).toEqual({
      efeito: 'reconhecer',
      estado: 'RECONHECIDO',
    })
    expect(estadoDoAlerta(situacao({ estado: 'RECONHECIDO' }), { tipo: 'reconhecer' })).toEqual({
      recusa: 'Este alerta já foi reconhecido.',
    })
    expect(estadoDoAlerta(resolvido, { tipo: 'reconhecer' })).toEqual({
      recusa: 'Alerta resolvido não precisa de reconhecimento.',
    })

    // registrar resolução
    for (const estado of ['ATIVO', 'RECONHECIDO', 'RESOLVIDO_NA_ORIGEM'] as const) {
      expect(
        estadoDoAlerta(situacao({ estado, origem: 'WEBHOOK' }), { tipo: 'registrar-resolucao' }),
      ).toEqual({ recusa: 'Alertas recebidos por webhook são resolvidos pela própria fonte.' })
    }
    for (const estado of ['ATIVO', 'RECONHECIDO'] as const) {
      expect(
        estadoDoAlerta(situacao({ estado, origem: 'MANUAL' }), { tipo: 'registrar-resolucao' }),
      ).toEqual({ efeito: 'resolver', estado: 'RESOLVIDO_NA_ORIGEM' })
    }
    expect(
      estadoDoAlerta(situacao({ estado: 'RESOLVIDO_NA_ORIGEM', origem: 'MANUAL' }), {
        tipo: 'registrar-resolucao',
      }),
    ).toEqual({ recusa: 'Este alerta já está resolvido.' })
  })
})

describe('validações de recurso', () => {
  test('validarNomeDeRecurso apara, recusa vazio e acima de 120', () => {
    expect(validarNomeDeRecurso('  vps-01 ')).toBe('vps-01')
    expect(() => validarNomeDeRecurso('   ')).toThrow('O nome é obrigatório.')
    expect(() => validarNomeDeRecurso('a'.repeat(121))).toThrow(
      'O nome não pode ter mais de 120 caracteres.',
    )
    expect(validarNomeDeRecurso('a'.repeat(120))).toHaveLength(120)
    expect(() => validarNomeDeRecurso('')).toThrow(ErroDeDominio)
  })

  test('validarUrlDeFerramenta: "" → null; "https://beszel.exemplo.test/vps" passa; "javascript:alert(1)", "ftp://x" e "https://u:s@x.test" recusam com a mensagem do rótulo', () => {
    expect(validarUrlDeFerramenta('', 'Beszel')).toBeNull()
    expect(validarUrlDeFerramenta(null, 'GlitchTip')).toBeNull()
    expect(validarUrlDeFerramenta(undefined, 'host Docker')).toBeNull()
    expect(validarUrlDeFerramenta('https://beszel.exemplo.test/vps', 'Beszel')).toBe(
      'https://beszel.exemplo.test/vps',
    )
    const mensagem = (r: string) =>
      `O endereço do ${r} precisa começar com http:// ou https:// e não pode conter usuário ou senha.`
    for (const url of ['javascript:alert(1)', 'ftp://x', 'https://u:s@x.test']) {
      expect(() => validarUrlDeFerramenta(url, 'Beszel')).toThrow(mensagem('Beszel'))
    }
    expect(() => validarUrlDeFerramenta('nao e url', 'GlitchTip')).toThrow(mensagem('GlitchTip'))
    expect(() =>
      validarUrlDeFerramenta('https://x.test/' + 'a'.repeat(500), 'host Docker'),
    ).toThrow(mensagem('host Docker'))
  })

  test('validarHospedagem: CONTAINER em SERVIDOR ok; CONTAINER em CONTAINER, SERVIDOR em SERVIDOR e servidor arquivado recusados com as mensagens exatas', () => {
    expect(() =>
      validarHospedagem('CONTAINER', { tipo: 'SERVIDOR', arquivado: false }),
    ).not.toThrow()
    expect(() => validarHospedagem('CONTAINER', null)).not.toThrow()
    expect(() => validarHospedagem('SERVIDOR', null)).not.toThrow()
    expect(() => validarHospedagem('CONTAINER', { tipo: 'CONTAINER', arquivado: false })).toThrow(
      'Só servidores podem hospedar outros recursos.',
    )
    expect(() => validarHospedagem('SERVIDOR', { tipo: 'SERVIDOR', arquivado: false })).toThrow(
      'Um servidor não pode estar hospedado em outro recurso.',
    )
    expect(() => validarHospedagem('BANCO', { tipo: 'SERVIDOR', arquivado: true })).toThrow(
      'Servidor arquivado não recebe novos recursos.',
    )
  })
})

describe('apresentação', () => {
  test('situacaoDoRecurso e resumoDeSaude: sem alertas → "Sem dados" neutro; [MEDIA] → atencao; [BAIXA, ALTA] → "2 alertas não resolvidos" erro; nenhum caso devolve tom sucesso', () => {
    const casos = [
      situacaoDoRecurso({ arquivado: false, alertasNaoResolvidos: [] }),
      situacaoDoRecurso({ arquivado: true, alertasNaoResolvidos: [] }),
      situacaoDoRecurso({ arquivado: false, alertasNaoResolvidos: [{ severidade: 'MEDIA' }] }),
      situacaoDoRecurso({
        arquivado: false,
        alertasNaoResolvidos: [{ severidade: 'BAIXA' }, { severidade: 'ALTA' }],
      }),
      resumoDeSaude([]),
      resumoDeSaude([{ severidade: 'MEDIA' }]),
      resumoDeSaude([{ severidade: 'BAIXA' }, { severidade: 'ALTA' }]),
    ]
    for (const c of casos) expect(c.tom).not.toBe('sucesso')

    expect(casos[0]).toEqual({ chave: 'sem-dados', texto: 'Sem dados', tom: 'neutro' })
    expect(casos[1]).toEqual({ chave: 'arquivado', texto: 'Arquivado', tom: 'neutro' })
    expect(casos[2]).toEqual({ chave: 'com-alerta', texto: '1 alerta', tom: 'atencao' })
    expect(casos[3]).toEqual({ chave: 'com-alerta', texto: '2 alertas', tom: 'erro' })
    expect(
      situacaoDoRecurso({ arquivado: true, alertasNaoResolvidos: [{ severidade: 'CRITICA' }] }),
    ).toMatchObject({ chave: 'arquivado' })

    expect(resumoDeSaude([])).toEqual({
      texto: 'Sem dados',
      tom: 'neutro',
      detalhe: 'Nenhum alerta não resolvido. Sem fonte de monitoramento para confirmar a saúde.',
    })
    expect(resumoDeSaude([{ severidade: 'MEDIA' }])).toEqual({
      texto: '1 alerta não resolvido',
      tom: 'atencao',
      detalhe: 'O impacto nos projetos não está confirmado.',
    })
    expect(resumoDeSaude([{ severidade: 'BAIXA' }, { severidade: 'ALTA' }])).toEqual({
      texto: '2 alertas não resolvidos',
      tom: 'erro',
      detalhe: 'O impacto nos projetos não está confirmado.',
    })
  })

  test('apresentações de estado, severidade e tipo', () => {
    expect(apresentarEstadoDoAlerta('ATIVO')).toEqual({ texto: 'Ativo', tom: 'erro' })
    expect(apresentarEstadoDoAlerta('RECONHECIDO')).toEqual({
      texto: 'Reconhecido',
      tom: 'atencao',
    })
    expect(apresentarEstadoDoAlerta('RESOLVIDO_NA_ORIGEM')).toEqual({
      texto: 'Resolvido na origem',
      tom: 'sucesso',
    })
    expect(apresentarSeveridade('CRITICA')).toEqual({ texto: 'Crítica', tom: 'erro' })
    expect(apresentarSeveridade('ALTA')).toEqual({ texto: 'Alta', tom: 'erro' })
    expect(apresentarSeveridade('MEDIA')).toEqual({ texto: 'Média', tom: 'atencao' })
    expect(apresentarSeveridade('BAIXA')).toEqual({ texto: 'Baixa', tom: 'informacao' })
    expect(
      (['SERVIDOR', 'CONTAINER', 'BANCO', 'STORAGE', 'OUTRO'] as const).map(rotuloDoTipo),
    ).toEqual(['Servidor', 'Container', 'Banco de dados', 'Storage', 'Outro'])
  })

  test('linksDeFerramentas ordena e omite vazios; hashDoTokenDeAlertas devolve 64 hex e é determinístico; vezesRecebido(1) e (3)', () => {
    expect(
      linksDeFerramentas(
        { urlBeszel: 'https://b.test', urlGlitchTip: null, urlHostDocker: 'https://d.test' },
        [
          {
            nomeCompleto: 'kustertech-exemplo/portal',
            urlHtml: 'https://github.com/kustertech-exemplo/portal',
          },
          {
            nomeCompleto: 'kustertech-exemplo/api',
            urlHtml: 'https://github.com/kustertech-exemplo/api',
          },
        ],
      ),
    ).toEqual([
      { rotulo: 'Beszel', href: 'https://b.test' },
      { rotulo: 'Host Docker', href: 'https://d.test' },
      {
        rotulo: 'GitHub · kustertech-exemplo/api',
        href: 'https://github.com/kustertech-exemplo/api',
      },
      {
        rotulo: 'GitHub · kustertech-exemplo/portal',
        href: 'https://github.com/kustertech-exemplo/portal',
      },
    ])
    expect(
      linksDeFerramentas(
        { urlBeszel: null, urlGlitchTip: 'https://g.test', urlHostDocker: null },
        [],
      ),
    ).toEqual([{ rotulo: 'GlitchTip', href: 'https://g.test' }])

    const h = hashDoTokenDeAlertas('fa_abc')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashDoTokenDeAlertas('fa_abc')).toBe(h)
    expect(hashDoTokenDeAlertas('fa_abd')).not.toBe(h)

    expect(vezesRecebido(1)).toBe('Recebido 1 vez')
    expect(vezesRecebido(3)).toBe('Recebido 3 vezes')
    expect(chaveDedupeDoWebhook('f1', 'cpu')).toBe('f1:cpu')
    expect(chaveDedupeManual('u-1')).toBe('manual:u-1')
  })
})

describe('lerCorpoDoAlerta', () => {
  test('lerCorpoDoAlerta: mínimo {chave,titulo,severidade} → situacao ativo, recurso null; severidade "urgente" → campos ["severidade"]; chave de 201 → campos ["chave"]; título de 300 → 200 caracteres; campo extra "token" ausente do resultado', () => {
    expect(lerCorpoDoAlerta({ chave: 'cpu', titulo: 'CPU alta', severidade: 'alta' })).toEqual({
      ok: true,
      dados: {
        chave: 'cpu',
        titulo: 'CPU alta',
        severidade: 'ALTA',
        situacao: 'ativo',
        recurso: null,
        ocorridoEm: null,
        detalhe: null,
      },
    })
    expect(lerCorpoDoAlerta({ chave: 'cpu', titulo: 'x', severidade: 'urgente' })).toEqual({
      ok: false,
      campos: ['severidade'],
    })
    expect(lerCorpoDoAlerta({ chave: 'c'.repeat(201), titulo: 'x', severidade: 'baixa' })).toEqual({
      ok: false,
      campos: ['chave'],
    })
    const longo = lerCorpoDoAlerta({ chave: 'k', titulo: 't'.repeat(300), severidade: 'critica' })
    expect(longo.ok && longo.dados.titulo).toHaveLength(200)
    const extra = lerCorpoDoAlerta({
      chave: 'k',
      titulo: 't',
      severidade: 'media',
      token: 'segredo',
    })
    expect(extra.ok && 'token' in extra.dados).toBe(false)
    expect(JSON.stringify(extra)).not.toContain('segredo')
  })

  test('campos opcionais: situacao, recurso, ocorridoEm e detalhe', () => {
    const r = lerCorpoDoAlerta({
      chave: ' k ',
      titulo: ' t ',
      severidade: 'baixa',
      situacao: 'resolvido',
      recurso: 'vps-01',
      ocorridoEm: '2026-10-27T10:00:00-03:00',
      detalhe: 'd'.repeat(2500),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.dados.chave).toBe('k')
      expect(r.dados.titulo).toBe('t')
      expect(r.dados.situacao).toBe('resolvido')
      expect(r.dados.recurso).toBe('vps-01')
      expect(r.dados.ocorridoEm?.toISOString()).toBe('2026-10-27T13:00:00.000Z')
      expect(r.dados.detalhe).toHaveLength(2000)
    }
    expect(lerCorpoDoAlerta(null)).toEqual({ ok: false, campos: [''] })
    expect(
      lerCorpoDoAlerta({ chave: '', titulo: '', severidade: 'x', recurso: 'r'.repeat(121) }),
    ).toMatchObject({ ok: false })
  })
})
