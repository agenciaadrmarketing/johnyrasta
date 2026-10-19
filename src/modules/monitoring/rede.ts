/**
 * Política de rede do verificador: o que o servidor PODE acessar.
 *
 * Módulo puro, sem I/O. É consultado antes de resolver DNS (forma da URL),
 * depois de resolver (cada endereço) e de novo em cada redirecionamento.
 *
 * Risco real: SSRF. O worker faz requisições para URLs cadastradas; sem isto,
 * um cadastro apontando para 169.254.169.254 leria credenciais da nuvem.
 */
import { isIP } from 'node:net';

export const PORTAS_PERMITIDAS = new Set([80, 443]);

export type DecisaoDeUrl =
  | { ok: true; url: URL; host: string; porta: number }
  | { ok: false; motivo: string };

/**
 * `excecoes` são IPs privados permitidos explicitamente. Um host literal que
 * esteja na lista também pode usar porta alta — é o que permite testar o
 * verificador contra um servidor local sem abrir a porta 80.
 */
export function avaliarUrl(entrada: string, excecoes: readonly string[] = []): DecisaoDeUrl {
  let u: URL;
  try {
    u = new URL(entrada);
  } catch {
    return { ok: false, motivo: 'URL inválida' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, motivo: `esquema ${u.protocol} não permitido` };
  if (u.username || u.password) return { ok: false, motivo: 'credenciais embutidas na URL' };
  const porta = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const excecaoLocal = excecoes.includes(host);
  // Porta fora de 80/443 só com exceção: host literal na lista, ou (para nome)
  // decidido depois da resolução — ver `portaExigeExcecao`.
  if (!PORTAS_PERMITIDAS.has(porta) && !excecaoLocal && isIP(host)) return { ok: false, motivo: `porta ${porta} não permitida` };
  if (!host) return { ok: false, motivo: 'host vazio' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, motivo: `host ${host} é reservado` };
  }
  const literal = isIP(host);
  if (literal) {
    const d = avaliarEndereco(host, excecoes);
    if (!d.ok) return d;
  }
  return { ok: true, url: u, host, porta };
}

export function portaExigeExcecao(porta: number): boolean {
  return !PORTAS_PERMITIDAS.has(porta);
}

export type DecisaoDeEndereco = { ok: true } | { ok: false; motivo: string };

function v4(ip: string): [number, number, number, number] | null {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? (p as [number, number, number, number]) : null;
}

function bloqueioV4(ip: string): string | null {
  const p = v4(ip);
  if (!p) return 'IPv4 malformado';
  const [a, b] = p;
  if (a === 0) return 'rede 0.0.0.0/8';
  if (a === 10) return 'rede privada 10/8';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local / metadata de nuvem';
  if (a === 172 && b >= 16 && b <= 31) return 'rede privada 172.16/12';
  if (a === 192 && b === 168) return 'rede privada 192.168/16';
  if (a === 100 && b >= 64 && b <= 127) return 'CGNAT 100.64/10';
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return 'faixa especial 192.0.0/24 ou 192.0.2/24';
  if (a === 198 && (b === 18 || b === 19)) return 'faixa de teste 198.18/15';
  if (a === 198 && b === 51 && p[2] === 100) return 'documentação 198.51.100/24';
  if (a === 203 && b === 0 && p[2] === 113) return 'documentação 203.0.113/24';
  if (a >= 224) return 'multicast ou reservado (224/4, 240/4)';
  return null;
}

/** Expande um IPv6 para 8 grupos de 16 bits. Devolve null se malformado. */
export function gruposV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  // IPv4 embutido no fim (::ffff:1.2.3.4, 64:ff9b::1.2.3.4)
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) {
    const p = v4(m[2]!);
    if (!p) return null;
    s = `${m[1]}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const partes = s.split('::');
  if (partes.length > 2) return null;
  const cabeca = partes[0] ? partes[0].split(':') : [];
  const cauda = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  const faltam = 8 - cabeca.length - cauda.length;
  if (faltam < 0 || (partes.length === 1 && faltam !== 0)) return null;
  const todos = [...cabeca, ...new Array(faltam).fill('0'), ...cauda];
  const n = todos.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return n.some(Number.isNaN) ? null : n;
}

function bloqueioV6(ip: string): string | null {
  const g = gruposV6(ip);
  if (!g) return 'IPv6 malformado';
  const todosZero = g.every((x) => x === 0);
  if (todosZero) return 'endereço não especificado ::';
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return 'loopback ::1';
  // IPv4 mapeado (::ffff:a.b.c.d) e NAT64 (64:ff9b::/96): avalia o IPv4 embutido.
  const embutido = (pref: boolean) => (pref ? `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}` : null);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    const m = bloqueioV4(embutido(true)!);
    return m ? `IPv4 mapeado em IPv6: ${m}` : null;
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    const m = bloqueioV4(embutido(true)!);
    return m ? `NAT64: ${m}` : 'NAT64 não permitido';
  }
  if ((g[0]! & 0xfe00) === 0xfc00) return 'IPv6 local único fc00::/7';
  if ((g[0]! & 0xffc0) === 0xfe80) return 'IPv6 link-local fe80::/10';
  if (g[0] === 0x2001 && g[1] === 0x0db8) return 'documentação 2001:db8::/32';
  if (g[0] === 0x2002) return '6to4 2002::/16';
  if ((g[0]! & 0xff00) === 0xff00) return 'multicast ff00::/8';
  return null;
}

/**
 * Um endereço IP resolvido pode ser alvo de conexão?
 *
 * `excecoes` é uma lista EXPLÍCITA de IPs permitidos apesar de privados —
 * existe para testes locais e para o operador que monitora a própria rede.
 * Nunca é padrão.
 */
export function avaliarEndereco(ip: string, excecoes: readonly string[] = []): DecisaoDeEndereco {
  if (excecoes.includes(ip)) return { ok: true };
  const tipo = isIP(ip);
  const motivo = tipo === 4 ? bloqueioV4(ip) : tipo === 6 ? bloqueioV6(ip) : 'não é um IP';
  return motivo ? { ok: false, motivo: `${ip}: ${motivo}` } : { ok: true };
}

/** Todos os endereços precisam passar: um só privado no conjunto bloqueia o host. */
export function avaliarEnderecos(ips: readonly string[], excecoes: readonly string[] = []): DecisaoDeEndereco {
  if (ips.length === 0) return { ok: false, motivo: 'nenhum endereço resolvido' };
  for (const ip of ips) {
    const d = avaliarEndereco(ip, excecoes);
    if (!d.ok) return d;
  }
  return { ok: true };
}
