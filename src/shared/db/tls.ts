/**
 * TLS e configuração de cliente do `pg`, compartilhados pela web, pelo worker e pelos scripts.
 * Sem `server-only`: o worker e os scripts importam daqui.
 */
import { readFileSync } from 'node:fs';

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

/** Certificado raiz do provedor: `DATABASE_SSL_CA` (conteúdo) ou `DATABASE_SSL_CA_FILE` (caminho; melhor para systemd). */
export function caDoAmbiente(env: Record<string, string | undefined> = process.env): string | undefined {
  const arquivo = (env.DATABASE_SSL_CA_FILE ?? '').trim();
  if (arquivo) return readFileSync(arquivo, 'utf8');
  return env.DATABASE_SSL_CA || undefined;
}

/**
 * TLS: obrigatório fora de hosts locais. Com CA a cadeia é verificada; sem ela a conexão é
 * cifrada mas não autenticada (protege contra escuta passiva, não contra intermediário ativo).
 */
export function tlsPara(connectionString: string, env: Record<string, string | undefined> = process.env): false | { rejectUnauthorized: boolean; ca?: string } {
  const ca = caDoAmbiente(env);
  const remoto = ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    // Formato que não é URL: não dá para saber se é local. Falhar FECHADO.
    return remoto;
  }
  return HOSTS_LOCAIS.has(host) ? false : remoto;
}

/**
 * Configuração de conexão do `pg`. O `sslmode` da URL é REMOVIDO: no `pg`, ele sobrepõe a opção
 * `ssl` e imporia verificação estrita sem a CA do provedor (que não está no repositório de
 * certificados do sistema). A política é sempre a de `tlsPara`.
 */
export function configDoPg(connectionString: string, env: Record<string, string | undefined> = process.env): { connectionString: string; ssl: false | { rejectUnauthorized: boolean; ca?: string } } {
  let limpa = connectionString;
  try {
    const u = new URL(connectionString);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('sslrootcert');
    limpa = u.toString();
  } catch {
    // não é URL: segue como veio
  }
  return { connectionString: limpa, ssl: tlsPara(connectionString, env) };
}
