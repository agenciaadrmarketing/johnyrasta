import { describe, expect, it } from 'vitest';
import { instanteNoFuso, lerDataIso, periodoDoRelatorio, queryDoPeriodo } from '@/modules/reports/periodo';
import { camposSemMensagem, horasMaisAtivas, incidentesNoPeriodo, porEvidencia } from '@/modules/reports/regras';

const agora = new Date('2026-10-20T15:00:00Z'); // 12:00 em São Paulo
const SP = 'America/Sao_Paulo';

const ok = (r: ReturnType<typeof periodoDoRelatorio>) => {
  if (!r.ok) throw new Error(`esperava período válido, veio erro: ${r.erro}`);
  return r.periodo;
};
const erro = (r: ReturnType<typeof periodoDoRelatorio>) => {
  if (r.ok) throw new Error('esperava erro, veio período válido');
  return r.erro;
};

describe('período padrão (janela móvel, igual à das abas e do CSV)', () => {
  it('sem parâmetros = 30 dias terminando agora', () => {
    const p = ok(periodoDoRelatorio({}, SP, agora));
    expect(p.modo).toBe('padrao');
    expect(p.dias).toBe(30);
    expect(p.diasPadrao).toBe(30);
    expect(p.ate.getTime()).toBe(agora.getTime());
    expect(p.de.getTime()).toBe(agora.getTime() - 30 * 86_400_000);
  });
  it('7 e 90 aceitos; 15, 0, negativo e texto recusados com mensagem', () => {
    expect(ok(periodoDoRelatorio({ dias: '7' }, SP, agora)).dias).toBe(7);
    expect(ok(periodoDoRelatorio({ dias: '90' }, SP, agora)).diasPadrao).toBe(90);
    for (const d of ['15', '0', '-7', 'abc', '30.5']) expect(erro(periodoDoRelatorio({ dias: d }, SP, agora))).toMatch(/7, 30 ou 90/);
  });
  it('o rótulo menciona a janela e o fuso entra no formato das horas', () => {
    const p = ok(periodoDoRelatorio({ dias: '7' }, SP, agora));
    expect(p.rotulo).toContain('últimos 7 dias');
    expect(p.rotulo).toContain('20/10/2026, 12:00'); // agora, em SP
  });
});

describe('período personalizado (dias de calendário no fuso do site)', () => {
  it('T01: meia-noite em São Paulo não é meia-noite UTC', () => {
    const p = ok(periodoDoRelatorio({ de: '2026-10-01', ate: '2026-10-07' }, SP, agora));
    expect(p.de.toISOString()).toBe('2026-10-01T03:00:00.000Z'); // 00:00 SP
    expect(p.ate.toISOString()).toBe('2026-10-08T02:59:59.999Z'); // 23:59:59.999 SP
    expect(p.dias).toBe(7);
    expect(p.modo).toBe('personalizado');
    expect(p.diasPadrao).toBeNull();
    expect(p.rotulo).toContain('01/10/2026 a 07/10/2026');
    expect(p.rotulo).toContain(SP);
  });
  it('o mesmo pedido em UTC dá outros instantes', () => {
    const p = ok(periodoDoRelatorio({ de: '2026-10-01', ate: '2026-10-07' }, 'UTC', agora));
    expect(p.de.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(p.ate.toISOString()).toBe('2026-10-07T23:59:59.999Z');
  });
  it('um evento às 02:59Z do dia seguinte pertence ao dia pedido em SP; às 03:00Z já não', () => {
    const p = ok(periodoDoRelatorio({ de: '2026-10-07', ate: '2026-10-07' }, SP, agora));
    const dentro = new Date('2026-10-08T02:59:00Z'); // 23:59 SP de 07/10
    const fora = new Date('2026-10-08T03:00:00Z'); // 00:00 SP de 08/10
    const antes = new Date('2026-10-07T02:59:59Z'); // 23:59:59 SP de 06/10
    expect(dentro >= p.de && dentro <= p.ate).toBe(true);
    expect(fora <= p.ate).toBe(false);
    expect(antes >= p.de).toBe(false);
    expect(p.dias).toBe(1);
  });
  it('fuso com horário de verão (Lisboa): outubro ainda em UTC+1, dezembro em UTC+0', () => {
    expect(instanteNoFuso('Europe/Lisbon', 2026, 10, 1).toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(instanteNoFuso('Europe/Lisbon', 2026, 12, 1).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    const p = ok(periodoDoRelatorio({ de: '2026-10-20', ate: '2026-10-20' }, 'Europe/Lisbon', new Date('2026-10-21T12:00:00Z')));
    expect(p.de.toISOString()).toBe('2026-10-19T23:00:00.000Z');
    expect(p.ate.toISOString()).toBe('2026-10-20T22:59:59.999Z');
  });
  it('fim no futuro é cortado em agora e o rótulo diz isso', () => {
    const p = ok(periodoDoRelatorio({ de: '2026-10-14', ate: '2026-10-20' }, SP, agora));
    expect(p.ate.getTime()).toBe(agora.getTime());
    expect(p.rotulo).toContain('(até 20/10/2026, 12:00)');
    expect(p.dias).toBe(7);
  });
  it('limites: 366 dias passa, 367 não; início depois do fim; início no futuro; uma data só', () => {
    expect(ok(periodoDoRelatorio({ de: '2025-10-20', ate: '2026-10-20' }, SP, agora)).dias).toBe(366);
    expect(erro(periodoDoRelatorio({ de: '2025-10-19', ate: '2026-10-20' }, SP, agora))).toMatch(/máximo é 366/);
    expect(erro(periodoDoRelatorio({ de: '2026-10-10', ate: '2026-10-01' }, SP, agora))).toMatch(/posterior/);
    expect(erro(periodoDoRelatorio({ de: '2026-10-21', ate: '2026-10-22' }, SP, agora))).toMatch(/futuro/);
    expect(erro(periodoDoRelatorio({ de: '2026-10-01' }, SP, agora))).toMatch(/início e a de fim/);
    expect(erro(periodoDoRelatorio({ ate: '2026-10-01' }, SP, agora))).toMatch(/início e a de fim/);
    expect(erro(periodoDoRelatorio({ dias: 'personalizado' }, SP, agora))).toMatch(/início e a de fim/);
  });
  it('datas inválidas: formato errado, 31 de fevereiro, mês 13, texto', () => {
    expect(erro(periodoDoRelatorio({ de: '01/10/2026', ate: '2026-10-07' }, SP, agora))).toMatch(/início inválida/);
    expect(erro(periodoDoRelatorio({ de: '2026-02-31', ate: '2026-03-01' }, SP, agora))).toMatch(/início inválida/);
    expect(erro(periodoDoRelatorio({ de: '2026-10-01', ate: '2026-13-01' }, SP, agora))).toMatch(/fim inválida/);
    expect(erro(periodoDoRelatorio({ de: '2026-10-01', ate: 'ontem' }, SP, agora))).toMatch(/fim inválida/);
    expect(lerDataIso('2024-02-29')).toEqual({ ano: 2024, mes: 2, dia: 29 });
    expect(lerDataIso('2026-02-29')).toBeNull();
    expect(lerDataIso('2026-1-5')).toBeNull();
  });
  it('datas presentes mandam sobre dias', () => {
    const p = ok(periodoDoRelatorio({ dias: '7', de: '2026-10-01', ate: '2026-10-02' }, SP, agora));
    expect(p.modo).toBe('personalizado');
    expect(p.dias).toBe(2);
  });
  it('fuso desconhecido é erro, não exceção', () => {
    expect(erro(periodoDoRelatorio({ dias: '7' }, 'Marte/Olympus', agora))).toMatch(/Fuso horário desconhecido/);
  });
  it('a query reproduz o período pedido', () => {
    expect(queryDoPeriodo({ dias: '7' })).toBe('?dias=7');
    expect(queryDoPeriodo({ de: '2026-10-01', ate: '2026-10-07' })).toBe('?de=2026-10-01&ate=2026-10-07');
    expect(queryDoPeriodo({ dias: '7', de: '2026-10-01', ate: '2026-10-07' })).toBe('?de=2026-10-01&ate=2026-10-07');
    expect(queryDoPeriodo({})).toBe('');
  });
});

describe('regras do relatório', () => {
  const p = { de: new Date('2026-10-01T03:00:00Z'), ate: new Date('2026-10-08T02:59:59.999Z') };
  const inc = (first: string, rec: string | null) => ({ firstFailureAt: new Date(first), recoveredAt: rec ? new Date(rec) : null });
  it('incidentes que tocam o período: antes e recuperado antes fica fora; aberto fica dentro; depois do fim fica fora', () => {
    const lista = [
      inc('2026-09-20T00:00:00Z', '2026-09-21T00:00:00Z'), // fora: terminou antes
      inc('2026-09-30T00:00:00Z', '2026-10-01T05:00:00Z'), // dentro: terminou dentro do período
      inc('2026-10-03T00:00:00Z', null), // dentro: aberto
      inc('2026-10-08T03:00:00Z', null), // fora: começou depois do fim (00:00 SP de 08/10)
      inc('2026-10-08T02:30:00Z', '2026-10-08T04:00:00Z'), // dentro: começou 23:30 SP de 07/10
    ];
    expect(incidentesNoPeriodo(lista, p)).toEqual([lista[1], lista[2], lista[4]]);
  });
  it('horas mais ativas: só com ação, por volume, empate pela hora mais cedo, no máximo N', () => {
    const horas = [
      { hora: 0, cliques: 0, contatos: 0 },
      { hora: 9, cliques: 5, contatos: 1 },
      { hora: 14, cliques: 6, contatos: 0 },
      { hora: 18, cliques: 2, contatos: 1 },
      { hora: 20, cliques: 0, contatos: 1 },
    ];
    expect(horasMaisAtivas(horas, 3).map((h) => h.hora)).toEqual([9, 14, 18]);
    expect(horasMaisAtivas([{ hora: 1, cliques: 0, contatos: 0 }])).toEqual([]);
  });
  it('por evidência: tentativas separadas, grupos por fonte e estado', () => {
    const r = porEvidencia([
      { evidenceSource: 'endpoint', receiptStatus: 'recebido' },
      { evidenceSource: 'endpoint', receiptStatus: 'recebido' },
      { evidenceSource: 'webhook', receiptStatus: 'confirmado_destino' },
      { evidenceSource: 'auxiliar', receiptStatus: 'tentativa' },
    ]);
    expect(r.tentativas).toBe(1);
    expect(r.grupos).toEqual([
      { evidencia: 'endpoint', status: 'recebido', total: 2 },
      { evidencia: 'webhook', status: 'confirmado_destino', total: 1 },
    ]);
  });
  it('campos sem mensagem', () => {
    expect(camposSemMensagem({ name: 'Ana', message: 'olá', email: 'a@b.co' })).toEqual({ name: 'Ana', email: 'a@b.co' });
  });
});
