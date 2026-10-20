import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iniciarAgendador } from '../../worker/agendador';

describe('agendador de laços independentes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('tarefa lenta não atrasa as outras e não se sobrepõe a si mesma', async () => {
    let liberar!: () => void;
    const travada = new Promise<void>((r) => { liberar = r; });
    const n = { lenta: 0, rapida: 0, heartbeat: 0 };
    const a = iniciarAgendador([
      { nome: 'lenta', intervaloMs: 5_000, executar: async () => { n.lenta += 1; await travada; } },
      { nome: 'rapida', intervaloMs: 5_000, executar: async () => { n.rapida += 1; } },
      { nome: 'heartbeat', intervaloMs: 30_000, executar: async () => { n.heartbeat += 1; } },
    ], { aoErro: () => {} });
    await vi.advanceTimersByTimeAsync(95_000);
    expect(n.lenta).toBe(1); // ainda na primeira execução: nunca duas ao mesmo tempo
    expect(n.rapida).toBeGreaterThanOrEqual(19);
    expect(n.heartbeat).toBe(4); // 0, 30, 60, 90 s — sem esperar a tarefa lenta
    liberar();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(n.lenta).toBe(2);
    await a.parar();
  });

  it('erro numa tarefa é tratado à parte: a tarefa continua e as outras não são afetadas', async () => {
    const erros: string[] = [];
    let ok = 0; let falhas = 0;
    const a = iniciarAgendador([
      { nome: 'quebra', intervaloMs: 1_000, executar: async () => { falhas += 1; throw new Error('boom'); } },
      { nome: 'ok', intervaloMs: 1_000, executar: async () => { ok += 1; } },
    ], { aoErro: (nome) => erros.push(nome) });
    await vi.advanceTimersByTimeAsync(5_500);
    expect(falhas).toBeGreaterThanOrEqual(5);
    expect(ok).toBeGreaterThanOrEqual(5);
    expect(new Set(erros)).toEqual(new Set(['quebra']));
    await a.parar();
  });

  it('parar() não interrompe a execução em andamento: espera terminar e não agenda outra', async () => {
    let terminou = false; let execucoes = 0;
    let liberar!: () => void;
    const a = iniciarAgendador([{ nome: 't', intervaloMs: 1_000, executar: async () => { execucoes += 1; await new Promise<void>((r) => { liberar = r; }); terminou = true; } }], { aoErro: () => {} });
    await vi.advanceTimersByTimeAsync(10);
    let resolvido = false;
    const p = a.parar().then(() => { resolvido = true; });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(resolvido).toBe(false); // ainda esperando a execução corrente
    liberar();
    await p;
    expect(terminou).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(execucoes).toBe(1);
  });

  it('parar() acorda quem está dormindo, sem esperar o intervalo', async () => {
    const a = iniciarAgendador([{ nome: 't', intervaloMs: 3_600_000, executar: async () => {} }], { aoErro: () => {} });
    await vi.advanceTimersByTimeAsync(10);
    await a.parar(); // se esperasse a hora inteira, o teste travaria
  });
});
