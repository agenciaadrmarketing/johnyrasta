import { describe, expect, it } from 'vitest';
import { FUSOS, fusoValido, iniciaisDoSite, normalizarUrlDoSite, validarCliente, validarSite } from '@/shared/validation/site';

describe('normalização da URL do site', () => {
  it('acrescenta https, remove www. do domínio, descarta query e hash', () => {
    const r = normalizarUrlDoSite(' WWW.Cliente.com.br/pagina?utm=x#topo ');
    expect(r).toEqual({ ok: true, url: 'https://www.cliente.com.br/pagina', domain: 'cliente.com.br' });
  });
  it('outro subdomínio é outro site', () => {
    const r = normalizarUrlDoSite('https://botox.clinica.com.br');
    expect(r.ok && r.domain).toBe('botox.clinica.com.br');
  });
  it('rejeita IP, porta, credenciais, esquema estranho e lixo', () => {
    for (const ruim of ['http://10.0.0.1', 'https://site.com:8443', 'https://u:p@site.com', 'ftp://site.com', 'não é url', '', 'localhost']) {
      expect(normalizarUrlDoSite(ruim).ok, ruim).toBe(false);
    }
  });
});

describe('validação de cadastro', () => {
  it('site válido', () => {
    const v = validarSite({ nome: 'Clínica Sol', url: 'clinicasol.com.br', fuso: 'America/Sao_Paulo', plataforma: 'wordpress', clienteId: '0b8a6c1e-3b2c-4b7e-9a1d-2f3e4c5d6a7b' });
    expect(v.ok).toBe(true);
  });
  it('acumula erros por campo e recusa fuso fora da lista', () => {
    const v = validarSite({ nome: 'x', url: 'ftp://a', fuso: 'Mars/Olympus', plataforma: 'cobol', clienteId: 'nope' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(Object.keys(v.erros).sort()).toEqual(['cliente', 'fuso', 'nome', 'plataforma', 'url']);
  });
  it('cliente: nome curto reprova, notas longas reprovam', () => {
    expect(validarCliente({ nome: 'A', notas: '' }).ok).toBe(false);
    expect(validarCliente({ nome: 'Acme', notas: 'x'.repeat(2001) }).ok).toBe(false);
    expect(validarCliente({ nome: '  Acme  ', notas: '  ' })).toEqual({ ok: true, valor: { nome: 'Acme', notas: null } });
  });
  it('todos os fusos oferecidos são IANA válidos no runtime', () => {
    for (const f of FUSOS) {
      expect(fusoValido(f)).toBe(true);
      expect(() => new Intl.DateTimeFormat('pt-BR', { timeZone: f })).not.toThrow();
    }
  });
  it('iniciais', () => {
    expect(iniciaisDoSite('Clínica Sol')).toBe('CS');
    expect(iniciaisDoSite('acme.com.br')).toBe('AC');
    expect(iniciaisDoSite('x')).toBe('X');
  });
});
