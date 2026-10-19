import { describe, expect, it } from 'vitest';
import { situacaoDoSite, type FatosDoSite } from '@/modules/portfolio/situacao';

const agora = new Date('2026-10-19T12:00:00Z');
const min = (n: number) => new Date(agora.getTime() - n * 60_000);
const monitor = (extra: Partial<NonNullable<FatosDoSite['monitor']>> = {}): FatosDoSite => ({
  arquivado: false,
  monitor: { habilitado: true, intervaloSegundos: 300, manutencaoAte: null, ultimaChecagem: null, incidenteAberto: null, recuperadoEm: null, ...extra },
});

describe('situação do site (máquina de estados)', () => {
  it('sem monitor: não afirma disponibilidade e pede decisão', () => {
    const s = situacaoDoSite('x', { arquivado: false, monitor: null }, agora);
    expect(s.estado).toBe('sem_monitor');
    expect(s.proximaAcao?.href).toBe('/sites/x/editar');
  });

  it('nunca verificado: sem evidência, aponta o worker', () => {
    const s = situacaoDoSite('x', monitor(), agora);
    expect(s.estado).toBe('nunca_verificado');
    expect(s.verificadoEm).toBeNull();
    expect(s.proximaAcao?.href).toContain('/configuracoes');
  });

  it('U03: sem nova checagem por mais de três intervalos, nunca mostra verde antigo', () => {
    const s = situacaoDoSite('x', monitor({ ultimaChecagem: { em: min(16), ok: true } }), agora);
    expect(s.estado).toBe('verificacao_atrasada');
    expect(s.tom).toBe('warn');
  });

  it('checagem recente ok: online', () => {
    const s = situacaoDoSite('x', monitor({ ultimaChecagem: { em: min(2), ok: true } }), agora);
    expect(s.estado).toBe('online');
    expect(s.verificadoEm).toEqual(min(2));
  });

  it('U02: falha isolada é suspeita, não incidente confirmado', () => {
    const s = situacaoDoSite('x', monitor({ ultimaChecagem: { em: min(1), ok: false }, incidenteAberto: { desde: min(1), confirmado: false } }), agora);
    expect(s.estado).toBe('suspeita');
    expect(s.proximaAcao).toBeNull();
  });

  it('U01: incidente confirmado é a maior prioridade e leva à disponibilidade', () => {
    const s = situacaoDoSite('x', monitor({ ultimaChecagem: { em: min(1), ok: false }, incidenteAberto: { desde: min(6), confirmado: true } }), agora);
    expect(s.estado).toBe('indisponivel');
    expect(s.prioridade).toBe(0);
    expect(s.proximaAcao?.href).toBe('/sites/x/disponibilidade');
  });

  it('pausado não calcula disponibilidade; manutenção suprime; arquivado não verifica', () => {
    expect(situacaoDoSite('x', monitor({ habilitado: false }), agora).estado).toBe('pausado');
    expect(situacaoDoSite('x', monitor({ manutencaoAte: min(-30) }), agora).estado).toBe('em_manutencao');
    expect(situacaoDoSite('x', { arquivado: true, monitor: null }, agora).estado).toBe('arquivado');
  });

  it('ordenação: incidente < atraso < nunca verificado < online', () => {
    const p = (f: FatosDoSite) => situacaoDoSite('x', f, agora).prioridade;
    const incidente = p(monitor({ ultimaChecagem: { em: min(1), ok: false }, incidenteAberto: { desde: min(6), confirmado: true } }));
    const atraso = p(monitor({ ultimaChecagem: { em: min(20), ok: true } }));
    const nunca = p(monitor());
    const online = p(monitor({ ultimaChecagem: { em: min(1), ok: true } }));
    expect(incidente).toBeLessThan(atraso);
    expect(atraso).toBeLessThan(nunca);
    expect(nunca).toBeLessThan(online);
  });
});
