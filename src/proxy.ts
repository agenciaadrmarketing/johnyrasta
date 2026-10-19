import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cabeçalhos de segurança com nonce por requisição (CSP). Vive aqui porque a
 * política precisa de um nonce diferente a cada resposta.
 *
 * `style-src 'unsafe-inline'`: a interface é construída com `style={{}}` e
 * classes do tema — consequência da arquitetura visual, não descuido.
 * Em desenvolvimento não há CSP: `next dev` compila com `eval`.
 */
const SEM_CSP = ['/api/'];

function nonceAleatorio(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function proxy(request: NextRequest) {
  const caminho = request.nextUrl.pathname;
  const nonce = nonceAleatorio();
  const cabecalhos = new Headers(request.headers);
  cabecalhos.set('x-nonce', nonce);
  const resposta = NextResponse.next({ request: { headers: cabecalhos } });

  resposta.headers.set('X-Frame-Options', 'DENY');
  resposta.headers.set('X-Content-Type-Options', 'nosniff');
  resposta.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  resposta.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  if (process.env.NODE_ENV === 'production') {
    resposta.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  if (SEM_CSP.some((p) => caminho.startsWith(p))) return resposta;
  if (process.env.NODE_ENV !== 'production') return resposta;

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: http:`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `worker-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join('; ');
  resposta.headers.set(process.env.CSP_RELATORIO === '1' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', csp);
  return resposta;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.png$).*)'],
};
