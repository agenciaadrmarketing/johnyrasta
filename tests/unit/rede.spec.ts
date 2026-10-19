import { describe, expect, it } from 'vitest';
import { avaliarEndereco, avaliarEnderecos, avaliarUrl, gruposV6, portaExigeExcecao } from '@/modules/monitoring/rede';

describe('U04 — política de rede do verificador', () => {
  it('bloqueia loopback, privadas, link-local/metadata, CGNAT, especiais e multicast', () => {
    for (const ip of ['127.0.0.1', '127.9.9.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255']) {
      expect(avaliarEndereco(ip).ok, ip).toBe(false);
    }
  });
  it('permite públicos', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '100.128.0.1', '2606:4700::1111', '2a00:1450:4001::1']) {
      expect(avaliarEndereco(ip).ok, ip).toBe(true);
    }
  });
  it('IPv6: ::1, ::, fc00::/7, fe80::/10, 2001:db8::, 2002::, ff00::', () => {
    for (const ip of ['::1', '::', 'fd12::1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:c0a8:101::1', 'ff02::1']) {
      expect(avaliarEndereco(ip).ok, ip).toBe(false);
    }
  });
  it('IPv4 mapeado em IPv6 e NAT64 avaliam o IPv4 embutido', () => {
    expect(avaliarEndereco('::ffff:127.0.0.1').ok).toBe(false);
    expect(avaliarEndereco('::ffff:7f00:1').ok).toBe(false);
    expect(avaliarEndereco('::ffff:169.254.169.254').ok).toBe(false);
    expect(avaliarEndereco('::ffff:8.8.8.8').ok).toBe(true);
    expect(avaliarEndereco('64:ff9b::10.0.0.1').ok).toBe(false);
    expect(gruposV6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
  });
  it('um endereço privado no conjunto bloqueia o host inteiro', () => {
    expect(avaliarEnderecos(['8.8.8.8', '10.0.0.1']).ok).toBe(false);
    expect(avaliarEnderecos([]).ok).toBe(false);
    expect(avaliarEnderecos(['8.8.8.8']).ok).toBe(true);
  });
  it('exceções explícitas liberam só o IP listado', () => {
    expect(avaliarEndereco('127.0.0.1', ['127.0.0.1']).ok).toBe(true);
    expect(avaliarEndereco('10.0.0.1', ['127.0.0.1']).ok).toBe(false);
  });
  it('URL: só http/https nas portas 80/443, sem credenciais, sem hosts reservados', () => {
    expect(avaliarUrl('https://site.com.br/').ok).toBe(true);
    expect(avaliarUrl('http://site.com.br:80/x').ok).toBe(true);
    // Nome com porta alta: a decisão fica para depois da resolução (só exceções locais passam).
    expect(avaliarUrl('https://site.com:8443/').ok).toBe(true);
    expect(portaExigeExcecao(8443)).toBe(true);
    expect(portaExigeExcecao(443)).toBe(false);
    for (const u of ['ftp://site.com', 'https://1.2.3.4:8443/', 'https://u:p@site.com/', 'http://localhost/', 'http://x.local/', 'http://meta.internal/', 'http://169.254.169.254/latest', 'http://[::1]/', 'gopher://a', 'nada']) {
      expect(avaliarUrl(u).ok, u).toBe(false);
    }
  });
});
