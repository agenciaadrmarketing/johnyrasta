import 'server-only';
import { cookies, headers } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { cache } from 'react';
import { semConta } from '@/shared/db';
import { cookieSeguro } from '@/shared/ambiente';

/**
 * Sessão opaca, guardada no banco.
 *
 * O cookie leva um token aleatório; o banco guarda o SHA-256 dele. Vazar o
 * banco não entrega sessões válidas, e revogar uma sessão tem efeito imediato
 * — ao contrário de um JWT, que vale até expirar.
 */
const COOKIE = 'johny_sessao';
const DURACAO_SEGUNDOS = 60 * 60 * 24 * 14;

export type Papel = 'owner' | 'operator';

export type UsuarioDaSessao = {
  sessionId: string;
  userId: string;
  accountId: string;
  email: string;
  name: string;
  role: Papel;
  accountName: string;
  isDemo: boolean;
};

export function hashDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function cabecalhosDoCliente() {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  return { userAgent: h.get('user-agent') ?? '', ip };
}

export async function criarSessao(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expira = new Date(Date.now() + DURACAO_SEGUNDOS * 1000);
  const { userAgent, ip } = await cabecalhosDoCliente();
  await semConta((db) =>
    db.one('select app.create_session($1, $2, $3, $4, $5) as id', [userId, hashDoToken(token), expira, userAgent, ip]),
  );
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSeguro(),
    path: '/',
    maxAge: DURACAO_SEGUNDOS,
  });
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await semConta((db) => db.query('select app.revoke_session($1)', [hashDoToken(token)])).catch(() => {});
  }
  jar.delete(COOKIE);
}

export async function tokenAtualHash(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? hashDoToken(token) : null;
}

/**
 * Usuário da requisição, ou null. `cache` deduplica entre os componentes de um
 * mesmo render. Conta, nome e papel vêm do banco a cada requisição: revogar
 * um acesso tem efeito imediato.
 */
export const usuarioDaSessao = cache(async (): Promise<UsuarioDaSessao | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || token.length < 20) return null;
  return semConta((db) =>
    db.one<UsuarioDaSessao>(
      `select session_id as "sessionId", user_id as "userId", account_id as "accountId",
              email, name, role, account_name as "accountName", is_demo as "isDemo"
         from app.find_user_for_session($1)`,
      [hashDoToken(token)],
    ),
  );
});
