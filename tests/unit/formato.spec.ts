import { describe, expect, it } from 'vitest';
import { dataHora, haQuantoTempo } from '@/shared/time/formato';

describe('formato de tempo', () => {
  const agora = new Date('2026-10-19T12:00:00Z');
  it('tempo relativo em português, sem "agora" enganoso', () => {
    expect(haQuantoTempo(new Date('2026-10-19T11:59:40Z'), agora)).toBe('há menos de um minuto');
    expect(haQuantoTempo(new Date('2026-10-19T11:57:00Z'), agora)).toBe('há 3 minutos');
    expect(haQuantoTempo(new Date('2026-10-19T10:00:00Z'), agora)).toBe('há 2 horas');
    expect(haQuantoTempo(new Date('2026-10-14T12:00:00Z'), agora)).toBe('há 5 dias');
  });
  it('T01: meia-noite UTC cai no dia anterior em São Paulo', () => {
    expect(dataHora('2026-10-19T00:30:00Z', 'America/Sao_Paulo')).toBe('18/10/2026, 21:30');
    expect(dataHora('2026-10-19T00:30:00Z', 'UTC')).toBe('19/10/2026, 00:30');
  });
});
