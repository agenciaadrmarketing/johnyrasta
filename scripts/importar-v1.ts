/**
 * Importa clientes, sites e URLs prioritárias exportados da V1 (JSON).
 * Veja docs/IMPORTAR-V1.md para gerar o arquivo. Por padrão só MOSTRA o plano;
 * nada é gravado sem --aplicar.
 *
 *   npx tsx scripts/importar-v1.ts --arquivo v1.json --conta <uuid>            # simulação
 *   npx tsx scripts/importar-v1.ts --arquivo v1.json --conta <uuid> --aplicar [--monitorar]
 *
 * Usa DATABASE_URL_ADMIN. A V1 nunca é acessada por este script.
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { configDoPg } from '../src/shared/db/tls';
import { loadEnv } from './env';
import { aplicarImportacao, lerExistentes, planejarImportacao, type DadosV1, type ItemDoPlano } from '../src/modules/portfolio/importacao-v1';

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const tem = (nome: string) => process.argv.includes(`--${nome}`);

export function resumir(plano: ItemDoPlano[]): string[] {
  const l: string[] = [];
  for (const it of plano) {
    if (it.tipo === 'cliente') l.push(`cliente  ${it.acao === 'criar' ? 'CRIAR       ' : 'reaproveitar'}  ${it.nome}`);
    else if (it.acao === 'criar') l.push(`site     CRIAR         ${it.nome} (${it.domain}) · ${it.fuso} · ${it.plataforma}${it.urlsPrioritarias.length ? ` · ${it.urlsPrioritarias.length} URL(s) prioritária(s)` : ''}`);
    else l.push(`site     ignorar       ${it.nome} — ${it.motivo}`);
  }
  return l;
}

async function main() {
  loadEnv();
  const arquivo = argumento('arquivo');
  const conta = argumento('conta');
  const url = process.env.DATABASE_URL_ADMIN;
  if (!arquivo || !conta || !url) throw new Error('Uso: importar-v1.ts --arquivo <v1.json> --conta <uuid da conta> [--aplicar] [--monitorar]  (exige DATABASE_URL_ADMIN)');
  const dados = JSON.parse(readFileSync(arquivo, 'utf8')) as DadosV1;
  if (!Array.isArray(dados.clients) || !Array.isArray(dados.sites)) throw new Error('Arquivo inválido: esperado { clients: [], sites: [], monitored_urls?: [] }.');
  const db = new Client(configDoPg(url));
  await db.connect();
  try {
    const existe = await db.query('select 1 from accounts where id = $1', [conta]);
    if (!existe.rowCount) throw new Error(`Conta ${conta} não existe.`);
    if (!tem('aplicar')) {
      for (const linha of resumir(planejarImportacao(dados, await lerExistentes(db, conta)))) console.log(linha);
      console.log('\nSimulação: nada foi gravado. Repita com --aplicar para importar.');
      return;
    }
    const { plano, resultado } = await aplicarImportacao(db, conta, dados, { monitorar: tem('monitorar') });
    for (const linha of resumir(plano)) console.log(linha);
    console.log(`\nImportado: ${resultado.sitesCriados} site(s), ${resultado.clientesCriados} cliente(s) novo(s), ${resultado.clientesReaproveitados} reaproveitado(s), ${resultado.urlsPrioritarias} URL(s) prioritária(s); ${resultado.sitesIgnorados} ignorado(s).`);
  } finally {
    await db.end();
  }
}

if (process.argv[1]?.endsWith('importar-v1.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
