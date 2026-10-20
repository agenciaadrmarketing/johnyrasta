import { NextResponse } from 'next/server';
import { comFormularios } from '@/shared/db';
import { receberSubmissao, siteDeFormulario, type EntradaDeSubmissao } from '@/modules/contacts/recepcao';
import { ipDaRequisicao, lerCorpoLimitado, permitir } from '@/shared/limites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Recebimento de formulário (modo endpoint) ou cópia auxiliar (?mode=auxiliar).
 * Aceita JSON ou application/x-www-form-urlencoded. Sucesso só depois do commit.
 */
export async function POST(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await ctx.params;
  const ip = ipDaRequisicao(req);
  if (!permitir(`forms:${publicId}:${ip}`, 30)) return NextResponse.json({ ok: false, erro: 'excesso de requisições' }, { status: 429, headers: CORS });
  const bruto = await lerCorpoLimitado(req, 32 * 1024);
  if (bruto === null) return NextResponse.json({ ok: false, erro: 'corpo grande demais' }, { status: 413, headers: CORS });
  const tipo = req.headers.get('content-type') ?? '';
  let entrada: EntradaDeSubmissao;
  try {
    if (tipo.includes('application/json')) {
      const j = JSON.parse(bruto || '{}') as Partial<EntradaDeSubmissao> & Record<string, unknown>;
      entrada = { submission_id: String(j.submission_id ?? ''), fields: (j.fields as Record<string, unknown>) ?? j, page_path: (j.page_path as string) ?? null, session_key: (j.session_key as string) ?? null, occurred_at: (j.occurred_at as string) ?? null, test_token: (j.test_token as string) ?? null, destination_status: (j.destination_status as EntradaDeSubmissao['destination_status']) ?? null, honeypot: (j.website as string) ?? null };
    } else {
      const p = new URLSearchParams(bruto);
      const fields: Record<string, unknown> = {};
      for (const [k, v] of p) fields[k] = v;
      entrada = { submission_id: p.get('submission_id') ?? '', fields, page_path: p.get('page_path'), session_key: p.get('session_key'), occurred_at: p.get('occurred_at'), test_token: p.get('test_token'), destination_status: p.get('destination_status') as EntradaDeSubmissao['destination_status'], honeypot: p.get('website') };
    }
  } catch {
    return NextResponse.json({ ok: false, erro: 'corpo inválido' }, { status: 400, headers: CORS });
  }
  const modo = new URL(req.url).searchParams.get('mode') === 'auxiliar' ? 'auxiliar' : 'endpoint';
  try {
    const r = await comFormularios(async (db) => {
      const site = await siteDeFormulario(db, publicId);
      if (!site) return { ok: false as const, motivo: 'site desconhecido', codigo: 404 as const };
      return receberSubmissao(db, site, entrada, modo, new Date());
    });
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.motivo }, { status: r.codigo, headers: CORS });
    return NextResponse.json({ ok: true, status: r.status, duplicated: r.duplicado, attribution: r.attribution }, { status: 200, headers: CORS });
  } catch (e) {
    // Falha de persistência NUNCA vira sucesso.
    console.error('[forms] falha de persistência:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, erro: 'indisponível; tente de novo' }, { status: 503, headers: CORS });
  }
}
