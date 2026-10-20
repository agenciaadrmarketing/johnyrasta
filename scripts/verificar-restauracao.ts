/**
 * Confere um banco restaurado contra a origem. Nada aqui altera dado algum.
 *
 *   npx tsx scripts/verificar-restauracao.ts --alvo johnyweb_restaurado
 *   npx tsx scripts/verificar-restauracao.ts --alvo johnyweb_restaurado --origem johnyweb
 *
 * Compara, tabela a tabela, a contagem de linhas; as versões em
 * schema_migrations; as políticas RLS (nome, comando, papéis e expressão);
 * as tabelas com RLS ativa/forçada; as concessões aos papéis app_* em tabelas (inclusive por coluna),
 * sequências, funções e schemas; as funções; o número de índices e restrições.
 *
 * Estrutura divergente (migração, política, concessão, tabela ausente) é
 * falha. Contagem diferente é AVISO: a origem pode ter recebido gravações
 * depois do backup — compare com a hora do arquivo.
 */
import { Client } from 'pg';
import { configDoPg } from '../src/shared/db/tls';
import { loadEnv } from './env';
import { bancoDaUrl, urlParaBanco } from './backup';

export type Verificacao = {
  tabelas: { nome: string; origem: number | null; alvo: number | null }[];
  tabelasAusentes: string[];
  tabelasExtras: string[];
  contagensDiferentes: string[];
  migracoes: { origem: string[]; alvo: string[]; iguais: boolean };
  politicas: { origem: number; alvo: number; ausentes: string[]; extras: string[] };
  rls: { origem: number; alvo: number; ausentes: string[]; extras: string[] };
  concessoes: { origem: number; alvo: number; ausentes: string[]; extras: string[] };
  funcoes: { origem: number; alvo: number; ausentes: string[]; extras: string[] };
  indices: { origem: number; alvo: number };
  restricoes: { origem: number; alvo: number };
  /** Migrações, políticas, RLS, concessões, funções, índices, restrições e conjunto de tabelas iguais. */
  estruturaOk: boolean;
  /** Toda tabela da origem existe no alvo com a mesma contagem. */
  contagensIguais: boolean;
};

const FORA_DO_SISTEMA = `n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'`;

type Inventario = {
  contagens: Map<string, number>;
  migracoes: string[];
  politicas: { nome: string; assinatura: string }[];
  rls: string[];
  concessoes: string[];
  funcoes: string[];
  indices: number;
  restricoes: number;
};

async function inventario(url: string): Promise<Inventario> {
  const c = new Client(configDoPg(url));
  await c.connect();
  try {
    const tabelas = (
      await c.query<{ nome: string }>(
        `select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as nome
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r', 'p') and ${FORA_DO_SISTEMA}
          order by 1`,
      )
    ).rows.map((r) => r.nome);
    const contagens = new Map<string, number>();
    for (const t of tabelas) {
      // `t` vem de quote_ident sobre o catálogo: identificador já escapado.
      contagens.set(t, Number((await c.query<{ n: string }>(`select count(*)::bigint as n from ${t}`)).rows[0]!.n));
    }
    const migracoes = contagens.has('public.schema_migrations')
      ? (await c.query<{ version: string }>('select version from schema_migrations order by 1')).rows.map((r) => r.version)
      : [];
    const politicas = (
      await c.query<{ nome: string; assinatura: string }>(
        `select schemaname || '.' || tablename || '.' || policyname as nome,
                schemaname || '.' || tablename || '.' || policyname || ' [' || cmd || ' → ' || array_to_string(roles, ',') || '] ' || md5(coalesce(qual, '') || '|' || coalesce(with_check, '')) as assinatura
           from pg_policies order by 1`,
      )
    ).rows;
    const rls = (
      await c.query<{ nome: string }>(
        `select n.nspname || '.' || c.relname || case when c.relforcerowsecurity then ' (forçada)' else '' end as nome
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relrowsecurity and c.relkind in ('r', 'p') and ${FORA_DO_SISTEMA}
          order by 1`,
      )
    ).rows.map((r) => r.nome);
    const concessoes = (
      await c.query<{ item: string }>(
        `select n.nspname || '.' || c.relname || ' → ' || a.grantee::regrole::text || ': ' || a.privilege_type as item
           from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
          where ${FORA_DO_SISTEMA} and c.relkind in ('r', 'p', 'v', 'm', 'S') and a.grantee::regrole::text like 'app\\_%'
         union all
         select n.nspname || '.' || c.relname || '.' || at.attname || ' → ' || a.grantee::regrole::text || ': ' || a.privilege_type || ' (coluna)'
           from pg_attribute at join pg_class c on c.oid = at.attrelid join pg_namespace n on n.oid = c.relnamespace, aclexplode(at.attacl) a
          where ${FORA_DO_SISTEMA} and at.attacl is not null and not at.attisdropped and a.grantee::regrole::text like 'app\\_%'
         union all
         select p.oid::regprocedure::text || ' → ' || a.grantee::regrole::text || ': ' || a.privilege_type
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a
          where ${FORA_DO_SISTEMA} and a.grantee::regrole::text like 'app\\_%'
         union all
         select 'schema ' || n.nspname || ' → ' || a.grantee::regrole::text || ': ' || a.privilege_type
           from pg_namespace n, aclexplode(n.nspacl) a
          where ${FORA_DO_SISTEMA} and a.grantee::regrole::text like 'app\\_%'
         order by 1`,
      )
    ).rows.map((r) => r.item);
    const funcoes = (
      await c.query<{ nome: string }>(
        `select p.oid::regprocedure::text as nome from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${FORA_DO_SISTEMA} order by 1`,
      )
    ).rows.map((r) => r.nome);
    const indices = Number((await c.query<{ n: string }>(`select count(*) as n from pg_indexes where schemaname not in ('pg_catalog', 'information_schema')`)).rows[0]!.n);
    const restricoes = Number(
      (await c.query<{ n: string }>(`select count(*) as n from pg_constraint x join pg_namespace n on n.oid = x.connamespace where ${FORA_DO_SISTEMA}`)).rows[0]!.n,
    );
    return { contagens, migracoes, politicas, rls, concessoes, funcoes, indices, restricoes };
  } finally {
    await c.end();
  }
}

function diferenca(origem: readonly string[], alvo: readonly string[]): { ausentes: string[]; extras: string[] } {
  const o = new Set(origem);
  const a = new Set(alvo);
  return { ausentes: origem.filter((x) => !a.has(x)), extras: alvo.filter((x) => !o.has(x)) };
}

export async function verificarRestauracao(o: { urlOrigem: string; urlAlvo: string }): Promise<Verificacao> {
  const origem = await inventario(o.urlOrigem);
  const alvo = await inventario(o.urlAlvo);

  const nomes = [...new Set([...origem.contagens.keys(), ...alvo.contagens.keys()])].sort();
  const tabelas = nomes.map((nome) => ({ nome, origem: origem.contagens.get(nome) ?? null, alvo: alvo.contagens.get(nome) ?? null }));
  const tabelasAusentes = tabelas.filter((t) => t.alvo === null).map((t) => t.nome);
  const tabelasExtras = tabelas.filter((t) => t.origem === null).map((t) => t.nome);
  const contagensDiferentes = tabelas.filter((t) => t.origem !== null && t.alvo !== null && t.origem !== t.alvo).map((t) => t.nome);

  const migracoes = { origem: origem.migracoes, alvo: alvo.migracoes, iguais: origem.migracoes.join('|') === alvo.migracoes.join('|') };
  const dPol = diferenca(origem.politicas.map((p) => p.assinatura), alvo.politicas.map((p) => p.assinatura));
  const nomeDaAssinatura = (a: string) => a.split(' [')[0]!;
  const politicas = { origem: origem.politicas.length, alvo: alvo.politicas.length, ausentes: dPol.ausentes.map(nomeDaAssinatura), extras: dPol.extras.map(nomeDaAssinatura) };
  const rls = { origem: origem.rls.length, alvo: alvo.rls.length, ...diferenca(origem.rls, alvo.rls) };
  const concessoes = { origem: origem.concessoes.length, alvo: alvo.concessoes.length, ...diferenca(origem.concessoes, alvo.concessoes) };
  const funcoes = { origem: origem.funcoes.length, alvo: alvo.funcoes.length, ...diferenca(origem.funcoes, alvo.funcoes) };
  const indices = { origem: origem.indices, alvo: alvo.indices };
  const restricoes = { origem: origem.restricoes, alvo: alvo.restricoes };

  const estruturaOk =
    tabelasAusentes.length === 0 &&
    tabelasExtras.length === 0 &&
    migracoes.iguais &&
    politicas.ausentes.length === 0 &&
    politicas.extras.length === 0 &&
    rls.ausentes.length === 0 &&
    rls.extras.length === 0 &&
    concessoes.ausentes.length === 0 &&
    concessoes.extras.length === 0 &&
    funcoes.ausentes.length === 0 &&
    funcoes.extras.length === 0 &&
    indices.origem === indices.alvo &&
    restricoes.origem === restricoes.alvo;
  const contagensIguais = tabelasAusentes.length === 0 && contagensDiferentes.length === 0;

  return { tabelas, tabelasAusentes, tabelasExtras, contagensDiferentes, migracoes, politicas, rls, concessoes, funcoes, indices, restricoes, estruturaOk, contagensIguais };
}

/** Linhas legíveis para o terminal (e para colar em docs/BACKUP.md). */
export function relatorio(v: Verificacao, nomes: { origem: string; alvo: string }): string[] {
  const l: string[] = [];
  const par = (x: { origem: number; alvo: number }) => `${x.origem} na origem, ${x.alvo} no alvo`;
  const lista = (itens: string[]) => itens.map((i) => `    - ${i}`);
  l.push(`Verificação (origem "${nomes.origem}" × alvo "${nomes.alvo}")`);
  const tabelasOrigem = v.tabelas.filter((t) => t.origem !== null).length;
  const tabelasAlvo = v.tabelas.filter((t) => t.alvo !== null).length;
  l.push(`· tabelas: ${tabelasOrigem} na origem, ${tabelasAlvo} no alvo${v.tabelasAusentes.length ? ` · AUSENTES no alvo: ${v.tabelasAusentes.join(', ')}` : ''}${v.tabelasExtras.length ? ` · só no alvo: ${v.tabelasExtras.join(', ')}` : ''}`);
  const linhasOrigem = v.tabelas.reduce((s, t) => s + (t.origem ?? 0), 0);
  if (v.contagensDiferentes.length === 0 && v.tabelasAusentes.length === 0) {
    l.push(`· contagem de linhas igual nas ${tabelasOrigem} tabelas (${linhasOrigem.toLocaleString('pt-BR')} linhas)`);
  } else {
    l.push(`· AVISO: contagem diferente em ${v.contagensDiferentes.length} tabela(s) — a origem recebeu gravações depois do backup? Compare com a hora do arquivo.`);
    for (const nome of v.contagensDiferentes) {
      const t = v.tabelas.find((x) => x.nome === nome)!;
      l.push(`    - ${nome}: origem ${t.origem}, alvo ${t.alvo}`);
    }
  }
  if (v.migracoes.iguais) {
    const m = v.migracoes.alvo;
    l.push(`· schema_migrations: ${m.length} versões iguais${m.length ? ` (${m[0]} … ${m[m.length - 1]})` : ''}`);
  } else {
    l.push(`· DIVERGÊNCIA em schema_migrations: origem [${v.migracoes.origem.join(', ')}] · alvo [${v.migracoes.alvo.join(', ')}]`);
  }
  const bloco = (rotulo: string, x: { origem: number; alvo: number; ausentes: string[]; extras: string[] }, iguais: string) => {
    if (x.ausentes.length === 0 && x.extras.length === 0) l.push(`· ${rotulo}: ${par(x)}, ${iguais}`);
    else {
      l.push(`· DIVERGÊNCIA em ${rotulo}: ${par(x)}`);
      if (x.ausentes.length) l.push(`    ausentes no alvo:`, ...lista(x.ausentes));
      if (x.extras.length) l.push(`    só no alvo:`, ...lista(x.extras));
    }
  };
  bloco('políticas RLS', v.politicas, 'mesmos nomes, comandos, papéis e expressões');
  bloco('tabelas com RLS', v.rls, 'mesmas tabelas e mesmo "forçada"');
  bloco('concessões a app_*', v.concessoes, 'iguais (tabelas, sequências, funções, schemas)');
  bloco('funções', v.funcoes, 'iguais');
  l.push(`· índices: ${par(v.indices)}${v.indices.origem === v.indices.alvo ? '' : ' — DIVERGÊNCIA'} · restrições: ${par(v.restricoes)}${v.restricoes.origem === v.restricoes.alvo ? '' : ' — DIVERGÊNCIA'}`);
  return l;
}

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  if (i >= 0) return process.argv[i + 1] ?? null;
  const comIgual = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return comIgual ? comIgual.slice(nome.length + 3) : null;
}

if (process.argv[1]?.endsWith('verificar-restauracao.ts')) {
  loadEnv();
  const urlAdmin = process.env.DATABASE_URL_ADMIN;
  const alvo = argumento('alvo');
  if (!urlAdmin || !alvo) {
    console.error('Uso: npx tsx scripts/verificar-restauracao.ts --alvo <banco restaurado> [--origem <banco>]  (exige DATABASE_URL_ADMIN)');
    process.exit(1);
  }
  const origem = argumento('origem') ?? bancoDaUrl(urlAdmin);
  verificarRestauracao({ urlOrigem: urlParaBanco(urlAdmin, origem), urlAlvo: urlParaBanco(urlAdmin, alvo) })
    .then((v) => {
      for (const linha of relatorio(v, { origem, alvo })) console.log(linha);
      console.log(v.estruturaOk ? 'Resultado: estrutura íntegra.' : 'Resultado: DIVERGÊNCIA estrutural. Não promova este banco.');
      process.exit(v.estruturaOk ? 0 : 1);
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
