import { NextResponse } from 'next/server';
import { usuarioDaSessao } from '@/modules/accounts/session';
import { buscarSite } from '@/modules/portfolio/consultas';
import { listarContatos, listarSubmissoes } from '@/modules/contacts/consultas';
import { linhasCsv } from '@/shared/validation/csv';

export const dynamic = 'force-dynamic';

/** CSV de contatos: mesma sessão, mesma conta e mesma consulta da tela. */
export async function GET(req: Request) {
  const u = await usuarioDaSessao();
  if (!u) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  const siteId = new URL(req.url).searchParams.get('site') ?? '';
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) return NextResponse.json({ erro: 'não encontrado' }, { status: 404 });
  const [contatos, submissoes] = [await listarContatos(u.accountId, site.id, { limite: 10_000 }), await listarSubmissoes(u.accountId, site.id, { limite: 10_000 })];
  const porContato = new Map<string, number>();
  for (const s of submissoes) if (s.contactId) porContato.set(s.contactId, (porContato.get(s.contactId) ?? 0) + 1);
  const csv = linhasCsv(
    ['nome', 'email', 'telefone', 'primeiro_contato_real_utc', 'ultimo_contato_real_utc', 'envios', 'conflitos_abertos', 'site', 'fuso_do_site'],
    contatos.map((c) => [c.name, c.email, c.phone, c.firstRealAt, c.lastRealAt, c.submissoes, c.conflitos, site.domain, site.timezone]),
  );
  return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="contatos-${site.domain}-${new Date().toISOString().slice(0, 10)}.csv"`, 'cache-control': 'no-store' } });
}
