import { describe, expect, it } from 'vitest';
import { transicao, type EstadoDoMonitor, type ResultadoDaChecagem } from '@/modules/monitoring/transicao';

const t0 = new Date('2026-10-19T12:00:00Z');
const mais = (min: number) => new Date(t0.getTime() + min * 60_000);
const ok: ResultadoDaChecagem = { ok: true, httpStatus: 200, durationMs: 120, errorCategory: null, errorDetail: null, finalUrl: 'https://a/', redirects: 0, tlsExpiresAt: new Date('2027-06-01T00:00:00Z'), tlsState: 'valido' };
const falha: ResultadoDaChecagem = { ...ok, ok: false, httpStatus: 500, errorCategory: 'http', tlsExpiresAt: null, tlsState: 'desconhecido' };
const base = (extra: Partial<EstadoDoMonitor> = {}): EstadoDoMonitor => ({
  id: 'm1', siteId: 's1', siteNome: 'Site', intervalSeconds: 300, consecutiveFailures: 0, lastFailureAt: null, lastCheckAt: null, emManutencao: false, tlsExpiresAt: null, incidenteAberto: null, ...extra,
});

describe('máquina de estados do monitor', () => {
  it('U01: 200 → falha → falha abre UM incidente, confirma na segunda, um alerta', () => {
    const t1 = transicao(base(), falha, t0);
    expect(t1.acao.tipo).toBe('abrir_incidente');
    expect(t1.alertas).toHaveLength(0);
    const aberto = base({ consecutiveFailures: 1, lastFailureAt: t0, incidenteAberto: { id: 'i1', confirmado: false, firstFailureAt: t0, failedChecks: 1 } });
    const t2 = transicao(aberto, falha, mais(5));
    expect(t2.acao).toEqual({ tipo: 'confirmar_incidente', incidenteId: 'i1' });
    expect(t2.alertas.map((a) => a.kind)).toEqual(['incidente_confirmado']);
    expect(t2.alertas[0]!.dedupeKey).toBe('incidente:i1:confirmado');
  });

  it('U02: falha isolada seguida de 200 fecha sem alerta', () => {
    const aberto = base({ consecutiveFailures: 1, lastFailureAt: t0, incidenteAberto: { id: 'i1', confirmado: false, firstFailureAt: t0, failedChecks: 1 } });
    const t = transicao(aberto, ok, mais(5));
    expect(t.acao).toEqual({ tipo: 'fechar_isolada', incidenteId: 'i1' });
    expect(t.alertas.filter((a) => a.kind.startsWith('incidente'))).toHaveLength(0);
    expect(t.consecutiveFailures).toBe(0);
  });

  it('N01: o mesmo incidente em 10 checagens produz a mesma chave, nunca um alerta novo', () => {
    const confirmado = base({ consecutiveFailures: 2, lastFailureAt: mais(5), incidenteAberto: { id: 'i1', confirmado: true, firstFailureAt: t0, failedChecks: 2 } });
    const chaves = new Set<string>();
    let m = confirmado;
    for (let i = 0; i < 10; i++) {
      const t = transicao(m, falha, mais(10 + i * 5));
      expect(t.acao.tipo).toBe('incrementar_incidente');
      for (const a of t.alertas) chaves.add(a.dedupeKey);
      m = { ...m, consecutiveFailures: t.consecutiveFailures, lastFailureAt: mais(10 + i * 5) };
    }
    expect(chaves.size).toBe(0);
  });

  it('recuperação após incidente confirmado: alerta de recuperação e resolve o de abertura', () => {
    const confirmado = base({ consecutiveFailures: 4, lastFailureAt: mais(15), incidenteAberto: { id: 'i1', confirmado: true, firstFailureAt: t0, failedChecks: 4 } });
    const t = transicao(confirmado, ok, mais(20));
    expect(t.acao).toEqual({ tipo: 'recuperar', incidenteId: 'i1' });
    expect(t.alertas.map((a) => a.kind)).toEqual(['incidente_recuperado']);
    expect(t.resolver).toEqual(['incidente:i1:confirmado']);
  });

  it('lacuna maior que 3 intervalos reinicia a contagem: a 2ª falha vira 1ª de novo', () => {
    const aberto = base({ consecutiveFailures: 1, lastFailureAt: t0, incidenteAberto: { id: 'i1', confirmado: false, firstFailureAt: t0, failedChecks: 1 } });
    const t = transicao(aberto, falha, mais(16));
    expect(t.consecutiveFailures).toBe(1);
    expect(t.acao.tipo).toBe('abrir_incidente');
  });

  it('em manutenção: estados mudam, nenhum alerta operacional sai', () => {
    const aberto = base({ emManutencao: true, consecutiveFailures: 1, lastFailureAt: t0, incidenteAberto: { id: 'i1', confirmado: false, firstFailureAt: t0, failedChecks: 1 } });
    const t = transicao(aberto, falha, mais(5));
    expect(t.acao.tipo).toBe('confirmar_incidente');
    expect(t.alertas).toHaveLength(0);
  });

  it('TLS: faixas 30/14/7/1 com dedupe por certificado e faixa; handshake com falha não gera data', () => {
    const em = (dias: number) => ({ ...ok, tlsExpiresAt: new Date(t0.getTime() + dias * 86_400_000) });
    expect(transicao(base(), em(45), t0).alertas).toHaveLength(0);
    const a30 = transicao(base(), em(29), t0).alertas[0]!;
    expect(a30.kind).toBe('tls_vencendo');
    expect(a30.dedupeKey.endsWith(':30')).toBe(true);
    expect(transicao(base(), em(13), t0).alertas[0]!.dedupeKey.endsWith(':14')).toBe(true);
    expect(transicao(base(), em(0.5), t0).alertas[0]!.severity).toBe('alta');
    const semData = transicao(base(), { ...ok, tlsState: 'falha', tlsExpiresAt: null, ok: false, errorCategory: 'tls' }, t0);
    expect(semData.alertas.find((a) => a.kind === 'tls_vencendo')).toBeUndefined();
  });
});
