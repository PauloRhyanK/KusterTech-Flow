import { describe, expect, test } from 'vitest'
import {
  ErroDeEndereco,
  ipPublico,
  resolverComSeguranca,
  validarEnderecoDoSistema,
} from './endereco'

describe('ipPublico', () => {
  test.each(['8.8.8.8', '2606:4700::1', '187.45.1.10'])('%s é público', (ip) => {
    expect(ipPublico(ip)).toBe(true)
  })
  test.each([
    '10.1.2.3',
    '172.20.0.1',
    '192.168.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.100.1.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'lixo',
  ])('%s não é público', (ip) => {
    expect(ipPublico(ip)).toBe(false)
  })
})

describe('validarEnderecoDoSistema', () => {
  const v = (url: string, permitirLocal = false) => validarEnderecoDoSistema(url, { permitirLocal })
  test('https público ok; a barra do fim sai', () => {
    const r = v('https://alfa.exemplo.com/v1/')
    expect(r.ok && r.url).toBe('https://alfa.exemplo.com/v1')
  })
  test('recusas com o motivo exato', () => {
    expect(v('http://alfa.exemplo.com/v1')).toEqual({ ok: false, motivo: 'Use um endereço https.' })
    expect(v('https://u:s@alfa.exemplo.com')).toEqual({
      ok: false,
      motivo: 'O endereço não pode ter usuário, senha, consulta ou fragmento.',
    })
    expect(v('https://alfa.exemplo.com/?a=1')).toMatchObject({ ok: false })
    expect(v('https://alfa.exemplo.com/#x')).toMatchObject({ ok: false })
    expect(v('https://127.0.0.1')).toEqual({
      ok: false,
      motivo: 'O endereço do sistema não é público.',
    })
    expect(v('https://localhost')).toEqual({
      ok: false,
      motivo: 'O endereço do sistema não é público.',
    })
    expect(v('nada')).toEqual({ ok: false, motivo: 'Endereço inválido.' })
  })
  test('com permitirLocal, http e IP local passam', () => {
    expect(v('http://127.0.0.1:3232', true)).toEqual({ ok: true, url: 'http://127.0.0.1:3232' })
  })
})

describe('resolverComSeguranca', () => {
  test('todos os IPs precisam ser públicos (Review Focus 2)', async () => {
    const dns = async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]
    await expect(
      resolverComSeguranca('alfa.exemplo.com', { permitirLocal: false }, dns),
    ).rejects.toThrow(ErroDeEndereco)
  })
  test('público devolve o primeiro; permitirLocal aceita local', async () => {
    const dns = async () => [{ address: '8.8.4.4', family: 4 }]
    await expect(
      resolverComSeguranca('alfa.exemplo.com', { permitirLocal: false }, dns),
    ).resolves.toEqual({
      address: '8.8.4.4',
      family: 4,
    })
    const local = async () => [{ address: '127.0.0.1', family: 4 }]
    await expect(resolverComSeguranca('x', { permitirLocal: true }, local)).resolves.toMatchObject({
      address: '127.0.0.1',
    })
  })
})
