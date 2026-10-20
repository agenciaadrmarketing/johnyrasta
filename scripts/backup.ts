/**
 * Backup lógico do banco com `pg_dump` em formato custom (-Fc).
 *
 *   npm run db:backup                         → ./backups/johnyweb-<AAAA-MM-DDTHH-MM>.dump
 *   BACKUP_DIR=/var/backups/johnyweb npm run db:backup
 *
 * Usa DATABASE_URL_ADMIN. O arquivo leva schema (tabelas, funções, políticas
 * RLS, concessões aos papéis app_*) e dados. NÃO leva o que está fora do
 * banco: SESSION_SECRET, senhas dos papéis, chaves de API, variáveis de
 * ambiente. Esses ficam no gestor de segredos da hospedagem.
 *
 * O carimbo do nome é UTC (como tudo o que o banco grava). A senha vai para o
 * pg_dump por PGPASSWORD, nunca por argumento: argumentos aparecem em `ps`.
 * PG_BIN (opcional) aponta para o diretório dos binários quando não estão no PATH.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Client } from 'pg';
import { loadEnv } from './env';

/** Papéis da aplicação. São objetos do CLUSTER, não do banco: um dump não os cria. */
export const PAPEIS_DA_APLICACAO = ['app_web', 'app_worker', 'app_ingest', 'app_forms'] as const;

export type OpcoesDeBackup = {
  /** URL administrativa do banco a copiar. */
  url: string;
  /** Diretório de destino. Padrão: BACKUP_DIR ou ./backups. Criado se não existir. */
  dir?: string;
  /** Prefixo do nome do arquivo. Padrão: johnyweb. */
  prefixo?: string;
  /** Relógio injetável (testes). */
  agora?: Date;
  quiet?: boolean;
};

export type ResultadoDoBackup = {
  caminho: string;
  bytes: number;
  banco: string;
  duracaoMs: number;
  versaoPgDump: string;
  versaoServidor: string;
};

/** Nome do banco numa URL de conexão. */
export function bancoDaUrl(url: string): string {
  const nome = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!nome) throw new Error('A URL de conexão não informa o banco (caminho vazio).');
  return nome;
}

/** A mesma URL apontando para outro banco do mesmo cluster. */
export function urlParaBanco(url: string, banco: string): string {
  const u = new URL(url);
  u.pathname = `/${banco}`;
  return u.toString();
}

/**
 * Converte a URL em argumentos de conexão (-h/-p/-U) e ambiente (PGPASSWORD,
 * PGSSLMODE) para as ferramentas de linha de comando do PostgreSQL.
 */
export function conexaoParaFerramentas(url: string): { args: string[]; env: NodeJS.ProcessEnv } {
  const u = new URL(url);
  const args: string[] = [];
  const host = decodeURIComponent(u.hostname).replace(/^\[(.*)\]$/, '$1');
  if (host) args.push('-h', host);
  if (u.port) args.push('-p', u.port);
  if (u.username) args.push('-U', decodeURIComponent(u.username));
  const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  const sslmode = u.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return { args, env };
}

export function binarioPg(nome: string): string {
  return process.env.PG_BIN ? join(process.env.PG_BIN, nome) : nome;
}

export type Execucao = { codigo: number; stdout: string; stderr: string };

/** Executa um binário do PostgreSQL. Falha com mensagem clara se ele não existir. */
export function executarPg(nome: string, args: string[], env: NodeJS.ProcessEnv): Promise<Execucao> {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(binarioPg(nome), args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    processo.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    processo.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    processo.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') {
        rejeitar(new Error(`${nome} não encontrado (${binarioPg(nome)}). Instale o cliente do PostgreSQL 16 ou mais novo (pacote postgresql-client) ou aponte PG_BIN para o diretório dos binários.`));
      } else rejeitar(e);
    });
    processo.on('close', (codigo) => resolver({ codigo: codigo ?? -1, stdout, stderr }));
  });
}

/** Primeiro número de uma string de versão ("16.15 (Ubuntu…)" → 16). */
export function versaoMaior(texto: string): number | null {
  const m = /(\d+)(?:\.\d+)?/.exec(texto);
  return m ? Number(m[1]) : null;
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
  return `${(kb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} MB`;
}

export function segundos(ms: number): string {
  return (ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/** `2026-10-20T01-23` — UTC, minuto a minuto, sem dois-pontos (nome de arquivo portável). */
export function carimbo(agora: Date): string {
  return agora.toISOString().slice(0, 16).replace(':', '-');
}

async function versaoDoServidor(url: string): Promise<string> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<{ v: string }>("select current_setting('server_version') as v")).rows[0]!.v;
  } finally {
    await c.end();
  }
}

export async function fazerBackup(o: OpcoesDeBackup): Promise<ResultadoDoBackup> {
  const inicio = Date.now();
  const banco = bancoDaUrl(o.url);
  const dir = resolve(o.dir ?? process.env.BACKUP_DIR ?? 'backups');
  const log = (m: string) => {
    if (!o.quiet) console.log(m);
  };

  const ferramenta = await executarPg('pg_dump', ['--version'], process.env);
  if (ferramenta.codigo !== 0) throw new Error(`pg_dump não respondeu a --version: ${ferramenta.stderr.trim()}`);
  const versaoPgDump = ferramenta.stdout.trim().replace(/^pg_dump \(PostgreSQL\) /, '');
  const versaoServidor = await versaoDoServidor(o.url);
  const maiorFerramenta = versaoMaior(versaoPgDump);
  const maiorServidor = versaoMaior(versaoServidor);
  if (maiorFerramenta !== null && maiorServidor !== null && maiorFerramenta < maiorServidor) {
    throw new Error(`pg_dump ${maiorFerramenta} não consegue copiar um servidor PostgreSQL ${maiorServidor}. Instale um cliente igual ou mais novo que o servidor.`);
  }

  await mkdir(dir, { recursive: true });
  const base = join(dir, `${o.prefixo ?? 'johnyweb'}-${carimbo(o.agora ?? new Date())}`);
  let caminho = `${base}.dump`;
  for (let n = 2; existsSync(caminho); n += 1) caminho = `${base}-${n}.dump`;

  const { args, env } = conexaoParaFerramentas(o.url);
  const r = await executarPg('pg_dump', ['--format=custom', '--no-password', '--file', caminho, ...args, '--dbname', banco], env);
  if (r.codigo !== 0) throw new Error(`pg_dump falhou (código ${r.codigo}):\n${r.stderr.trim()}`);
  const { size } = await stat(caminho);
  const resultado: ResultadoDoBackup = { caminho, bytes: size, banco, duracaoMs: Date.now() - inicio, versaoPgDump, versaoServidor };
  log(`· banco "${banco}" · servidor PostgreSQL ${versaoServidor} · pg_dump ${versaoPgDump}`);
  log(`· arquivo: ${caminho} (${tamanhoLegivel(size)}) em ${segundos(resultado.duracaoMs)} s`);
  return resultado;
}

if (process.argv[1]?.endsWith('backup.ts')) {
  loadEnv();
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) {
    console.error('Defina DATABASE_URL_ADMIN no .env.local (ou no ambiente).');
    process.exit(1);
  }
  console.log('Backup lógico com pg_dump (formato custom, comprimido)');
  fazerBackup({ url })
    .then((r) => {
      console.log('· contém: schema, dados, funções, políticas RLS e concessões aos papéis app_*');
      console.log('· NÃO contém: SESSION_SECRET, senhas dos papéis, chaves de API — ficam no gestor de segredos');
      console.log(`Para testar a restauração: npm run db:restaurar -- --para johnyweb_restaurado --arquivo ${relative(process.cwd(), r.caminho)}`);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
