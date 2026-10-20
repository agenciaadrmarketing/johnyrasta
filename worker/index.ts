/**
 * Worker do JohnyWeb — processo separado da aplicação web.
 *
 *   npm run worker
 *
 * Laço: reivindica monitores devidos (fila com lease no Postgres), verifica
 * com o verificador seguro, aplica a máquina de estados, grava, agenda a
 * próxima checagem. Cada tarefa (disponibilidade, PageSpeed, e-mail, heartbeat
 * a cada 30 s, retenção a cada hora) tem o seu laço independente. Nada aqui
 * depende de uma aba aberta nem de visitas à central.
 *
 * Papel do banco: app_worker (DATABASE_URL_WORKER). Sem acesso a usuários,
 * sessões ou contatos.
 *
 * Variáveis:
 *   WORKER_ID                     identificador desta instância
 *   MONITOR_CONCORRENCIA          checagens simultâneas (padrão 5)
 *   MONITOR_EXCECOES_DE_REDE      IPs privados permitidos, separados por vírgula (NUNCA em produção aberta)
 *   EMAIL_PROVIDER                resend | postmark | webhook | log | ausente (e-mail desativado)
 *   EMAIL_API_KEY, EMAIL_FROM, EMAIL_WEBHOOK_URL, APP_URL   conforme o provedor (veja .env.example)
 */
import { Pool } from 'pg';
import { hostname } from 'node:os';
import { loadEnv } from '../scripts/env';
import { iniciarAgendador, type Tarefa } from './agendador';
import { rodada, retencao, alertaDeColetaParada } from './rodada';
import { agendarDiarios, alertaDeFilaParada, rodadaPageSpeed } from './pagespeed';
import { criarEnviador } from './email';
import { estadoDoOutbox, rodadaOutbox } from './outbox';
import { aplicarRetencao } from '@/modules/contacts/retencao';
import { lerConfigDeEmail } from '@/modules/notifications/provedor';

loadEnv();

const url = process.env.DATABASE_URL_WORKER;
if (!url) {
  console.error('[worker] Defina DATABASE_URL_WORKER (papel app_worker). Veja .env.example.');
  process.exit(1);
}

const WORKER_ID = process.env.WORKER_ID ?? `${hostname()}-${process.pid}`;
const VERSAO = `v2-fase6`;
const TICK_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const RETENCAO_MS = 60 * 60 * 1000;
const CONCORRENCIA = Number(process.env.MONITOR_CONCORRENCIA ?? 5);
const EXCECOES = (process.env.MONITOR_EXCECOES_DE_REDE ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const CHAVE_PAGESPEED = process.env.PAGESPEED_API_KEY || null;
const CONCORRENCIA_PAGESPEED = Number(process.env.PAGESPEED_CONCORRENCIA ?? 2);
const AGENDA_MS = 5 * 60 * 1000;
const EMAIL = lerConfigDeEmail(process.env);
const enviarEmail = criarEnviador(EMAIL);
const URL_DA_CENTRAL = (process.env.APP_URL ?? '').trim().replace(/\/+$/, '') || null;

// Os laços rodam ao mesmo tempo: disponibilidade + PageSpeed + e-mail + heartbeat/retenção.
const pool = new Pool({ connectionString: url, max: CONCORRENCIA + CONCORRENCIA_PAGESPEED + 4 });

async function heartbeat(detalhes: Record<string, unknown>): Promise<void> {
  await pool.query(
    `insert into worker_heartbeats (worker_id, seen_at, version, details)
     values ($1, now(), $2, $3)
     on conflict (worker_id) do update set seen_at = now(), version = excluded.version, details = excluded.details`,
    [WORKER_ID, VERSAO, JSON.stringify(detalhes)],
  );
}

async function estadoDaFila() {
  const r = await pool.query<{ devidos: number; atrasados: number; mais_antigo_s: number | null }>(
    `select count(*) filter (where next_check_at <= now())::int as devidos,
            count(*) filter (where next_check_at < now() - make_interval(secs => interval_seconds * 3))::int as atrasados,
            extract(epoch from now() - min(next_check_at))::int as mais_antigo_s
       from monitors where enabled`,
  );
  return r.rows[0]!;
}

let ultimaAgenda = 0;
let acumuladoPs = { reivindicados: 0, medidos: 0, retentativas: 0, falhas: 0, descartados: 0 };
let acumulado = { reivindicados: 0, gravados: 0, descartados: 0, erros: 0 };
let acumuladoEmail = { enfileiradas: 0, enviadas: 0, reagendadas: 0, falhas: 0, descartadas: 0 };

async function loop() {
  console.log(`[worker] ${WORKER_ID} iniciado. Concorrência ${CONCORRENCIA}. Exceções de rede: ${EXCECOES.length ? EXCECOES.join(', ') : 'nenhuma'}.`);
  if (EXCECOES.length) console.warn('[worker] ATENÇÃO: há IPs privados liberados. Não use isto numa instalação aberta.');
  console.log(CHAVE_PAGESPEED ? `[worker] PageSpeed configurado: concorrência ${CONCORRENCIA_PAGESPEED}, agenda diária.` : '[worker] PageSpeed NÃO configurado (PAGESPEED_API_KEY ausente): nenhuma medição será agendada.');
  if (EMAIL.ativo) {
    console.log(`[worker] e-mail: ${EMAIL.descricao}${URL_DA_CENTRAL ? ` · links para ${URL_DA_CENTRAL}` : ' · APP_URL ausente: as mensagens levam só o caminho na central'}.`);
    if (EMAIL.provedor === 'log') console.warn('[worker] e-mail em modo log: as entregas são marcadas como enviadas mas NADA chega a uma caixa de entrada. Só para desenvolvimento.');
  } else {
    console.log(`[worker] e-mail desativado: alertas só na central (${EMAIL.motivo}).`);
  }

  // Cada tarefa tem o seu laço (worker/agendador.ts): o PageSpeed lento não atrasa
  // disponibilidade nem heartbeat.
  const tarefas: Tarefa[] = [
    {
      nome: 'disponibilidade',
      intervaloMs: TICK_MS,
      executar: async () => {
        const r = await rodada(pool, { workerId: WORKER_ID, concorrencia: CONCORRENCIA, verificador: { excecoesDeRede: EXCECOES } });
        acumulado = { reivindicados: acumulado.reivindicados + r.reivindicados, gravados: acumulado.gravados + r.gravados, descartados: acumulado.descartados + r.descartados, erros: acumulado.erros + r.erros };
        if (r.reivindicados) console.log(`[worker] rodada: ${r.gravados} gravadas, ${r.descartados} descartadas (lease perdido), ${r.erros} erros`);
      },
    },
    {
      nome: 'heartbeat',
      intervaloMs: HEARTBEAT_MS,
      executar: async () => {
        const fila = await estadoDaFila();
        const outbox = await estadoDoOutbox(pool);
        await heartbeat({
          fase: 6,
          fila,
          acumulado,
          concorrencia: CONCORRENCIA,
          pagespeed: { configurado: !!CHAVE_PAGESPEED, acumulado: acumuladoPs },
          email: { provedor: EMAIL.ativo ? EMAIL.provedor : null, pendentes: outbox.pendentes, falhas24h: outbox.falhas24h, acumulado: acumuladoEmail },
        });
      },
    },
    {
      nome: 'retencao',
      intervaloMs: RETENCAO_MS,
      executar: async () => {
        const n = await retencao(pool);
        if (n.checks || n.events || n.runs) console.log(`[worker] retenção: ${n.checks} checagens, ${n.events} eventos, ${n.runs} medições apagados`);
        // Retenção de contatos por site (política 'dias'): anonimiza, nunca apaga a linha.
        const ret = await aplicarRetencao(pool);
        if (ret.anonimizados || ret.erros) console.log(`[worker] retenção de contatos: ${ret.anonimizados} anonimizados, ${ret.erros} erros (${ret.candidatos} candidatos)`);
        const parados = await alertaDeColetaParada(pool);
        if (parados) console.log(`[worker] coleta interrompida em ${parados} site(s)`);
      },
    },
  ];
  if (CHAVE_PAGESPEED) {
    tarefas.push({
      nome: 'pagespeed',
      intervaloMs: TICK_MS,
      executar: async () => {
        if (Date.now() - ultimaAgenda > AGENDA_MS) {
          const n = await agendarDiarios(pool);
          if (n) console.log(`[worker] pagespeed: ${n} medições agendadas para hoje`);
          await alertaDeFilaParada(pool);
          ultimaAgenda = Date.now();
        }
        const ps = await rodadaPageSpeed(pool, { chave: CHAVE_PAGESPEED, concorrencia: CONCORRENCIA_PAGESPEED, workerId: WORKER_ID });
        if (ps.reivindicados) console.log(`[worker] pagespeed: ${ps.medidos} medidas, ${ps.retentativas} retentativas, ${ps.falhas} falhas`);
        acumuladoPs = { reivindicados: acumuladoPs.reivindicados + ps.reivindicados, medidos: acumuladoPs.medidos + ps.medidos, retentativas: acumuladoPs.retentativas + ps.retentativas, falhas: acumuladoPs.falhas + ps.falhas, descartados: acumuladoPs.descartados + ps.descartados };
      },
    });
  }
  if (enviarEmail) {
    tarefas.push({
      nome: 'email',
      intervaloMs: TICK_MS,
      executar: async () => {
        const ob = await rodadaOutbox(pool, { enviar: enviarEmail, provedor: EMAIL.ativo ? EMAIL.provedor : 'nenhum', urlDaCentral: URL_DA_CENTRAL });
        if (ob.enfileiradas || ob.reivindicadas) console.log(`[worker] e-mail: ${ob.enfileiradas} enfileiradas, ${ob.enviadas} enviadas, ${ob.reagendadas} reagendadas, ${ob.falhas} falhas, ${ob.descartadas} descartadas`);
        acumuladoEmail = { enfileiradas: acumuladoEmail.enfileiradas + ob.enfileiradas, enviadas: acumuladoEmail.enviadas + ob.enviadas, reagendadas: acumuladoEmail.reagendadas + ob.reagendadas, falhas: acumuladoEmail.falhas + ob.falhas, descartadas: acumuladoEmail.descartadas + ob.descartadas };
      },
    });
  }

  const agendador = iniciarAgendador(tarefas, { aoErro: (nome, e) => console.error(`[worker] ${nome} falhou:`, e instanceof Error ? e.message : e) });
  await new Promise<void>((resolve) => { parar = resolve; });
  // Encerramento gracioso: espera as execuções em andamento antes de fechar o pool.
  await agendador.parar();
  await pool.end();
  console.log('[worker] encerrado.');
}

let parar: () => void = () => {};
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    parar();
  });
}

loop().catch((e) => {
  console.error('[worker] falha fatal:', e);
  process.exit(1);
});
