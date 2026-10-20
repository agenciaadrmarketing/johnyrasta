import { NextResponse } from 'next/server';
import { comIngestao } from '@/shared/db';
import { ingerirLote, siteDoPublicId } from '@/modules/analytics/ingestao';
import { ipDaRequisicao, lerCorpoLimitado, permitir } from '@/shared/limites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const MAX_BYTES = 64 * 1024;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Ingestão de eventos do coletor. Identificador público + controles de abuso.
 * 204 depois de persistir; 202 nunca. Corpo de erro curto, sem eco de dados.
 */
export async function POST(req: Request) {
  const ip = ipDaRequisicao(req);
  if (!permitir(`collect:ip:${ip}`, 240)) return NextResponse.json({ erro: 'excesso de requisições' }, { status: 429, headers: CORS });
  const bruto = await lerCorpoLimitado(req, MAX_BYTES);
  if (bruto === null) return NextResponse.json({ erro: 'corpo grande demais' }, { status: 413, headers: CORS });
  let corpo: { site?: unknown; events?: unknown };
  try {
    corpo = JSON.parse(bruto || '{}');
  } catch {
    return NextResponse.json({ erro: 'JSON inválido' }, { status: 400, headers: CORS });
  }
  if (typeof corpo.site !== 'string' || !Array.isArray(corpo.events)) return NextResponse.json({ erro: 'esquema inválido' }, { status: 400, headers: CORS });
  if (!permitir(`collect:site:${corpo.site}:${ip}`, 120)) return NextResponse.json({ erro: 'excesso de requisições' }, { status: 429, headers: CORS });
  try {
    const resultado = await comIngestao(async (db) => {
      const site = await siteDoPublicId(db, corpo.site as string);
      if (!site) return null;
      return ingerirLote(db, site, corpo.events as unknown[], new Date());
    });
    if (!resultado) return NextResponse.json({ erro: 'site desconhecido' }, { status: 404, headers: CORS });
    return new NextResponse(null, { status: 204, headers: { ...CORS, 'x-johny-aceitos': String(resultado.aceitos), 'x-johny-duplicados': String(resultado.duplicados), 'x-johny-rejeitados': String(resultado.rejeitados.length) } });
  } catch (e) {
    console.error('[collect] falha de persistência:', e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: 'indisponível' }, { status: 503, headers: CORS });
  }
}
