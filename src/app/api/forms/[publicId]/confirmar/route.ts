import { NextResponse } from 'next/server';
import { comFormularios } from '@/shared/db';
import { confirmarPeloDestino, siteDeFormulario } from '@/modules/contacts/recepcao';
import { ipDaRequisicao, lerCorpoLimitado, permitir } from '@/shared/limites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Confirmação servidor a servidor pelo destino original do formulário.
 * Cabeçalhos: Authorization: Bearer <segredo>, X-Johny-Timestamp (epoch s),
 * X-Johny-Nonce, X-Johny-Signature = HMAC-SHA256(segredo, "ts.nonce.corpo").
 */
export async function POST(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await ctx.params;
  if (!permitir(`confirm:${publicId}:${ipDaRequisicao(req)}`, 60)) return NextResponse.json({ ok: false, erro: 'excesso de requisições' }, { status: 429 });
  const corpo = await lerCorpoLimitado(req, 32 * 1024);
  if (corpo === null) return NextResponse.json({ ok: false, erro: 'corpo grande demais' }, { status: 413 });
  const auth = req.headers.get('authorization') ?? '';
  const segredo = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  try {
    const r = await comFormularios(async (db) => {
      const site = await siteDeFormulario(db, publicId);
      if (!site) return { ok: false as const, motivo: 'site desconhecido', codigo: 404 as const };
      return confirmarPeloDestino(db, site, segredo, { timestamp: req.headers.get('x-johny-timestamp'), nonce: req.headers.get('x-johny-nonce'), assinatura: req.headers.get('x-johny-signature') }, corpo, new Date());
    });
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.motivo }, { status: r.codigo });
    return NextResponse.json({ ok: true, created: r.criado });
  } catch (e) {
    console.error('[forms/confirmar] falha:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, erro: 'indisponível' }, { status: 503 });
  }
}
