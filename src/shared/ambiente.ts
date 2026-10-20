/**
 * Exceção ÚNICA e explícita para testar a versão de produção (`next start`) em rede local, por HTTP.
 *
 * Em produção a central usa cookie `Secure`, HSTS e `upgrade-insecure-requests`, que quebram o
 * acesso por `http://192.168.x.x:3000` (o navegador descarta o cookie e tenta HTTPS nos recursos).
 * Aqui a exceção só vale quando TODAS as condições são verdadeiras:
 *   - `APP_URL` está definido e começa com `http://` (não `https://`);
 *   - o host do `APP_URL` é laço local, endereço de rede privada (10/8, 172.16/12, 192.168/16,
 *     169.254/16) ou nome `.local`.
 * Qualquer `APP_URL` com HTTPS, ausente ou com host público mantém TODAS as proteções de produção.
 * Sem `server-only`: o proxy (borda) e os testes importam daqui.
 */
export function hostEhRedeLocal(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function produzirSobHttpLocal(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV !== 'production') return false;
  const url = (env.APP_URL ?? '').trim();
  if (!/^http:\/\//i.test(url)) return false;
  try {
    return hostEhRedeLocal(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Cookie de sessão `Secure`: sempre em produção, exceto no acesso local por HTTP descrito acima. */
export function cookieSeguro(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'production' && !produzirSobHttpLocal(env);
}
