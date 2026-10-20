import { describe, expect, it } from 'vitest';
import { cookieSeguro, hostEhRedeLocal, produzirSobHttpLocal } from '../../src/shared/ambiente';
import { enderecosDaRede } from '../../scripts/lan';

const prod = (appUrl?: string) => ({ NODE_ENV: 'production', APP_URL: appUrl });

describe('exceção de HTTP local da versão de produção', () => {
  it('só vale para http:// em rede privada/local', () => {
    for (const ok of ['http://192.168.0.15:3000', 'http://10.0.0.7:3000', 'http://172.20.1.2:3000', 'http://localhost:3000', 'http://meu-note.local:3000', 'http://127.0.0.1:3000']) {
      expect(produzirSobHttpLocal(prod(ok)), ok).toBe(true);
      expect(cookieSeguro(prod(ok)), ok).toBe(false);
    }
  });
  it('mantém TODAS as proteções de produção com https, host público, APP_URL ausente ou inválido', () => {
    for (const estrito of ['https://app.johnyweb.com', 'https://192.168.0.15:3000', 'http://app.johnyweb.com', 'http://172.32.0.1:3000', 'http://8.8.8.8', '', 'lixo']) {
      expect(produzirSobHttpLocal(prod(estrito)), estrito).toBe(false);
      expect(cookieSeguro(prod(estrito)), estrito).toBe(true);
    }
    expect(cookieSeguro({ NODE_ENV: 'production' })).toBe(true);
  });
  it('fora de produção não há exceção (cookie nunca Secure em desenvolvimento, como antes)', () => {
    expect(produzirSobHttpLocal({ NODE_ENV: 'development', APP_URL: 'http://192.168.0.15:3000' })).toBe(false);
    expect(cookieSeguro({ NODE_ENV: 'development', APP_URL: 'https://x.com' })).toBe(false);
  });
  it('classifica hosts', () => {
    expect(hostEhRedeLocal('192.168.1.1')).toBe(true);
    expect(hostEhRedeLocal('172.15.0.1')).toBe(false);
    expect(hostEhRedeLocal('exemplo.com.br')).toBe(false);
  });
  it('escolhe o IP de Wi-Fi doméstico primeiro e ignora loopback/públicos', () => {
    const f = (address: string, internal = false) => ({ address, family: 'IPv4' as const, internal, netmask: '', mac: '', cidr: null });
    const r = enderecosDaRede({ docker0: [f('172.17.0.1')], lo: [f('127.0.0.1', true)], wifi: [f('192.168.0.15')], pub: [f('203.0.113.5')], eth: [f('10.0.0.4')] });
    expect(r.map((x) => x.ip)).toEqual(['192.168.0.15', '10.0.0.4', '172.17.0.1']);
  });
});
