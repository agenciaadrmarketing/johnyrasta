import { NextResponse } from 'next/server';
import { usuarioDaSessao } from '@/modules/accounts/session';
import { buscarSite } from '@/modules/portfolio/consultas';
import { botoes, periodoDeDias, porHora, resumoDeEventos } from '@/modules/analytics/consultas';
import { linhasCsv } from '@/shared/validation/csv';

export const dynamic = 'force-dynamic';

/** CSV agregado de eventos: botões e horas, com as MESMAS funções da tela. */
export async function GET(req: Request) {
  const u = await usuarioDaSessao();
  if (!u) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  const url = new URL(req.url);
  const site = await buscarSite(u.accountId, u.userId, url.searchParams.get('site') ?? '');
  if (!site) return NextResponse.json({ erro: 'não encontrado' }, { status: 404 });
  const dias = [7, 30, 90].includes(Number(url.searchParams.get('dias'))) ? Number(url.searchParams.get('dias')) : 30;
  const p = periodoDeDias(dias);
  const [r, b, h] = [await resumoDeEventos(u.accountId, site.id, p), await botoes(u.accountId, site.id, p), await porHora(u.accountId, site.id, site.timezone, p)];
  const linhas: unknown[][] = [
    ['resumo', 'visualizacoes', r.visualizacoes, '', '', '', ''],
    ['resumo', 'sessoes', r.sessoes, '', '', '', ''],
    ['resumo', 'cliques', r.cliques, '', '', '', ''],
    ['resumo', 'contatos_recebidos', r.contatos, '', '', '', ''],
    ['resumo', 'novos_leads', r.novosLeads, '', '', '', ''],
    ...b.map((l) => ['botao', l.buttonId, l.cliques, l.path, l.pos ?? '', l.contatosAtribuidos, l.sessoesConvertidas]),
    ...h.map((x) => ['hora', `${x.hora}h`, x.cliques, '', '', x.contatos, x.novosLeads]),
  ];
  const csv = linhasCsv(['tipo', 'chave', 'cliques_ou_valor', 'pagina', 'posicao', 'contatos', 'extra'], linhas);
  return new NextResponse(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="eventos-${site.domain}-${dias}d.csv"`, 'cache-control': 'no-store' } });
}
