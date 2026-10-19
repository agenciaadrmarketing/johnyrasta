import 'server-only';
import { redirect } from 'next/navigation';
import { usuarioDaSessao, type UsuarioDaSessao } from '@/modules/accounts/session';

export async function exigirSessao(): Promise<UsuarioDaSessao> {
  const usuario = await usuarioDaSessao();
  if (!usuario) redirect('/entrar');
  return usuario;
}

/**
 * Checagem de origem para mutações. Server Actions do Next já comparam
 * Origin com Host; isto cobre as rotas de API com POST e deixa a regra
 * explícita: mutação sem Origin da própria aplicação é rejeitada.
 */
export function origemPermitida(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    const o = new URL(origin);
    const esperado = process.env.APP_URL ? new URL(process.env.APP_URL).host : host;
    return o.host === esperado || o.host === host;
  } catch {
    return false;
  }
}
