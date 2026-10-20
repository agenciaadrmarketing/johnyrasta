/**
 * Restaura um `.dump` (pg_dump -Fc) num banco ALVO separado e confere o resultado.
 *
 *   npm run db:restaurar -- --para johnyweb_restaurado
 *   npm run db:restaurar -- --para johnyweb_restaurado --arquivo backups/johnyweb-2026-10-20T01-23.dump
 *   npm run db:restaurar -- --para johnyweb_restaurado --forcar          (apaga e recria um alvo com conteúdo)
 *   npm run db:restaurar -- --para johnyweb_restaurado --sem-verificacao
 *
 * Sem --arquivo, usa o .dump mais recente de BACKUP_DIR (padrão ./backups).
 *
 * Regras:
 *  - O alvo NUNCA é o banco de DATABASE_URL_ADMIN (origem/produção) nem um
 *    banco de sistema. Promover o restaurado é decisão do operador: trocar as
 *    URLs da aplicação, não sobrescrever a origem.
 *  - Alvo com conteúdo só com --forcar (apaga e recria).
 *  - Os papéis app_web/app_worker/app_ingest/app_forms são objetos do CLUSTER:
 *    as políticas e concessões do dump os referenciam. Se faltarem, são criados
 *    NOLOGIN antes de restaurar; a senha vem depois, com `npm run db:setup`.
 *  - pg_restore roda com --no-owner (dono = papel administrador que conecta),
 *    SEM --no-privileges (as concessões aos papéis fazem parte do contrato),
 *    --exit-on-error e --single-transaction (ou tudo, ou nada).
 *  - Depois: contagem por tabela, schema_migrations, políticas, RLS, concessões.
 */
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { loadEnv } from './env';
import { PAPEIS_DA_APLICACAO, bancoDaUrl, conexaoParaFerramentas, executarPg, segundos, urlParaBanco } from './backup';
import { relatorio, verificarRestauracao, type Verificacao } from './verificar-restauracao';

export type OpcoesDeRestauracao = {
  urlAdmin: string;
  arquivo: string;
  para: string;
  forcar?: boolean;
  /** Padrão: verifica. */
  verificar?: boolean;
  quiet?: boolean;
};

export type ResultadoDaRestauracao = {
  alvo: string;
  alvoCriado: boolean;
  alvoRecriado: boolean;
  papeisCriados: string[];
  cabecalho: CabecalhoDoDump;
  duracaoMs: number;
  verificacao: Verificacao | null;
};

export type CabecalhoDoDump = { banco: string | null; versaoServidor: string | null; versaoPgDump: string | null; entradas: number };

const NOME_DE_BANCO = /^[a-z_][a-z0-9_]{0,62}$/;
const RESERVADOS = new Set(['postgres', 'template0', 'template1']);
export const FLAGS_PG_RESTORE = ['--no-owner', '--exit-on-error', '--single-transaction', '--no-password'] as const;

/** Lê o sumário (TOC) do arquivo: valida o formato e informa de onde ele veio. */
export async function lerCabecalhoDoDump(arquivo: string): Promise<CabecalhoDoDump> {
  const r = await executarPg('pg_restore', ['--list', arquivo], process.env);
  if (r.codigo !== 0) throw new Error(`"${arquivo}" não é um arquivo válido do pg_dump em formato custom:\n${r.stderr.trim()}`);
  const pegar = (rotulo: string) => {
    const m = new RegExp(`^;\\s*${rotulo}:\\s*(.+)$`, 'm').exec(r.stdout);
    return m ? m[1]!.trim() : null;
  };
  const entradas = r.stdout.split('\n').filter((l) => /^\d+;/.test(l)).length;
  return { banco: pegar('dbname'), versaoServidor: pegar('Dumped from database version'), versaoPgDump: pegar('Dumped by pg_dump version'), entradas };
}

/** Objetos de usuário no banco (tabelas, views, sequências, funções, schemas além de public). 0 = vazio. */
async function conteudoDoBanco(url: string): Promise<number> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query<{ n: string }>(
      `select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f'))
            + (select count(*) from pg_namespace where nspname not in ('public', 'pg_catalog', 'information_schema') and nspname not like 'pg_%')
            + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog', 'information_schema')) as n`,
    );
    return Number(r.rows[0]!.n);
  } finally {
    await c.end();
  }
}

function ultimasLinhas(texto: string, n: number): string {
  const linhas = texto.trim().split('\n');
  return linhas.slice(-n).join('\n');
}

export async function restaurarBackup(o: OpcoesDeRestauracao): Promise<ResultadoDaRestauracao> {
  const inicio = Date.now();
  const log = (m: string) => {
    if (!o.quiet) console.log(m);
  };
  const origem = bancoDaUrl(o.urlAdmin);
  const para = o.para;
  if (!NOME_DE_BANCO.test(para)) throw new Error(`Nome de banco inválido: "${para}". Use minúsculas, dígitos e sublinhado, começando por letra.`);
  if (para === origem) throw new Error(`Recusado: "${para}" é o banco de origem (DATABASE_URL_ADMIN). A restauração sempre vai para um banco separado; para promovê-lo, troque as URLs da aplicação.`);
  if (RESERVADOS.has(para)) throw new Error(`Recusado: "${para}" é um banco de sistema do PostgreSQL.`);
  await access(o.arquivo, constants.R_OK).catch(() => {
    throw new Error(`Arquivo não encontrado ou sem permissão de leitura: ${o.arquivo}`);
  });

  const cabecalho = await lerCabecalhoDoDump(o.arquivo);
  log(`· arquivo: ${o.arquivo} · banco de origem no dump: ${cabecalho.banco ?? '?'} · PostgreSQL ${cabecalho.versaoServidor ?? '?'} · pg_dump ${cabecalho.versaoPgDump ?? '?'} · ${cabecalho.entradas} entradas`);

  const raiz = new Client({ connectionString: urlParaBanco(o.urlAdmin, 'postgres') });
  await raiz.connect();
  let alvoCriado = false;
  let alvoRecriado = false;
  const papeisCriados: string[] = [];
  try {
    for (const papel of PAPEIS_DA_APLICACAO) {
      const r = await raiz.query('select 1 from pg_roles where rolname = $1', [papel]);
      if (r.rowCount === 0) {
        await raiz.query(`create role "${papel}" nologin`);
        papeisCriados.push(papel);
      }
    }
    log(
      papeisCriados.length
        ? `· papéis criados no cluster SEM login (defina as senhas com npm run db:setup): ${papeisCriados.join(', ')}`
        : `· papéis presentes no cluster: ${PAPEIS_DA_APLICACAO.join(', ')}`,
    );
    const existe = (await raiz.query('select 1 from pg_database where datname = $1', [para])).rowCount === 1;
    if (existe) {
      const conteudo = await conteudoDoBanco(urlParaBanco(o.urlAdmin, para));
      if (conteudo > 0 && !o.forcar) throw new Error(`Recusado: o banco "${para}" já tem ${conteudo} objeto(s). Use --forcar para apagá-lo e recriá-lo, ou escolha outro nome.`);
      if (conteudo > 0) {
        await raiz.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [para]);
        await raiz.query(`drop database "${para}"`);
        await raiz.query(`create database "${para}"`);
        alvoRecriado = true;
        log(`· alvo "${para}" tinha ${conteudo} objeto(s): apagado e recriado (--forcar)`);
      } else {
        log(`· alvo "${para}" já existia, vazio`);
      }
    } else {
      await raiz.query(`create database "${para}"`);
      alvoCriado = true;
      log(`· alvo "${para}" criado`);
    }
  } finally {
    await raiz.end();
  }

  const { args, env } = conexaoParaFerramentas(o.urlAdmin);
  const t0 = Date.now();
  const r = await executarPg('pg_restore', [...FLAGS_PG_RESTORE, ...args, '--dbname', para, o.arquivo], env);
  if (r.codigo !== 0) {
    throw new Error(`pg_restore falhou (código ${r.codigo}). Transação única desfeita: o alvo "${para}" ficou vazio.\n${ultimasLinhas(r.stderr, 30)}`);
  }
  log(`· pg_restore ${FLAGS_PG_RESTORE.join(' ')} concluído em ${segundos(Date.now() - t0)} s`);

  let verificacao: Verificacao | null = null;
  if (o.verificar !== false) {
    verificacao = await verificarRestauracao({ urlOrigem: o.urlAdmin, urlAlvo: urlParaBanco(o.urlAdmin, para) });
    for (const linha of relatorio(verificacao, { origem, alvo: para })) log(linha);
  }
  return { alvo: para, alvoCriado, alvoRecriado, papeisCriados, cabecalho, duracaoMs: Date.now() - inicio, verificacao };
}

/** O .dump mais recente (por data de modificação) de um diretório. */
export async function dumpMaisRecente(dir: string): Promise<string | null> {
  const nomes = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.dump'));
  let melhor: { caminho: string; mtime: number } | null = null;
  for (const n of nomes) {
    const caminho = join(dir, n);
    const s = await stat(caminho);
    if (!melhor || s.mtimeMs > melhor.mtime) melhor = { caminho, mtime: s.mtimeMs };
  }
  return melhor?.caminho ?? null;
}

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  if (i >= 0) return process.argv[i + 1] ?? null;
  const comIgual = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return comIgual ? comIgual.slice(nome.length + 3) : null;
}

if (process.argv[1]?.endsWith('restaurar.ts')) {
  loadEnv();
  const urlAdmin = process.env.DATABASE_URL_ADMIN;
  const para = argumento('para');
  if (!urlAdmin || !para) {
    console.error('Uso: npm run db:restaurar -- --para <banco alvo> [--arquivo <caminho.dump>] [--forcar] [--sem-verificacao]  (exige DATABASE_URL_ADMIN)');
    process.exit(1);
  }
  (async () => {
    const dir = resolve(process.env.BACKUP_DIR ?? 'backups');
    const arquivo = argumento('arquivo') ?? (await dumpMaisRecente(dir));
    if (!arquivo) throw new Error(`Nenhum .dump em ${dir}. Rode npm run db:backup ou informe --arquivo.`);
    console.log(`Restauração para "${para}"`);
    const r = await restaurarBackup({ urlAdmin, arquivo, para, forcar: process.argv.includes('--forcar'), verificar: !process.argv.includes('--sem-verificacao') });
    const v = r.verificacao;
    if (!v) console.log(`Concluído em ${segundos(r.duracaoMs)} s sem verificação (--sem-verificacao).`);
    else if (v.estruturaOk && v.contagensIguais) console.log(`Resultado: restauração fiel ao backup e igual à origem atual (${segundos(r.duracaoMs)} s).`);
    else if (v.estruturaOk) console.log(`Resultado: estrutura íntegra (migrações, políticas, concessões). Só as contagens diferem — veja o aviso acima (${segundos(r.duracaoMs)} s).`);
    else console.log('Resultado: DIVERGÊNCIA estrutural. Não promova este banco; investigue o arquivo e a versão do pg_restore.');
    console.log(`Para inspecionar: psql -d ${para} · para descartar: drop database ${para};`);
    process.exit(v && !v.estruturaOk ? 1 : 0);
  })().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
