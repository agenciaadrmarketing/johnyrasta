import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { atrasoDeRetentativa, chaveDoTrabalho, classificarErroDaApi, lerPageSpeed, possivelRegressao, regressaoConfirmada, regressaoDesfeita, urlDaApi } from '@/modules/performance/pagespeed';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/${n}.json`, 'utf8'));

describe('leitura do PageSpeed', () => {
  it('resposta completa: notas 0–100, métricas de laboratório, diagnósticos ordenados sem somar, campo da URL com INP', () => {
    const l = lerPageSpeed(fx('psi-completo'));
    expect(l.laboratorio.status).toBe('ok');
    expect(l.laboratorio).toMatchObject({ performance: 72, accessibility: 95, bestPractices: 100, seo: 92, lcpMs: 3120.4, cls: 0.043, tbtMs: 210 });
    expect(l.laboratorio.diagnosticos.map((d) => d.id)).toEqual(['render-blocking-resources', 'unused-javascript']);
    expect(l.campo).toMatchObject({ scope: 'url', lcpP75Ms: 2300, inpP75Ms: 180, clsP75: 0.05, overall: 'AVERAGE' });
    expect(l.campoInsuficiente).toBe(false);
  });
  it('resposta parcial: status parcial, lista o que falta, nunca inventa nota; CrUX vazio = insuficiente (P03)', () => {
    const l = lerPageSpeed(fx('psi-parcial'));
    expect(l.laboratorio.status).toBe('parcial');
    expect(l.laboratorio.performance).toBe(55);
    expect(l.laboratorio.accessibility).toBeNull();
    expect(l.laboratorio.faltando).toEqual(expect.arrayContaining(['accessibility', 'best-practices', 'tbt', 'cls']));
    expect(l.campo).toBeNull();
    expect(l.campoInsuficiente).toBe(true);
  });
  it('campo caiu para a ORIGEM: identificado como origem, nunca como a página', () => {
    const l = lerPageSpeed(fx('psi-origem'));
    expect(l.campo?.scope).toBe('origin');
    expect(l.campo?.identifier).toBe('https://www.exemplo.com.br');
  });
  it('lixo não quebra: tudo nulo e parcial', () => {
    const l = lerPageSpeed({ foo: 1 });
    expect(l.laboratorio.status).toBe('parcial');
    expect(l.laboratorio.performance).toBeNull();
  });
});

describe('regras', () => {
  it('regressão: queda de 10+ pontos; nulos nunca são regressão', () => {
    expect(possivelRegressao(60, 75)).toBe(true);
    expect(possivelRegressao(70, 75)).toBe(false);
    expect(possivelRegressao(null, 75)).toBe(false);
    expect(possivelRegressao(60, null)).toBe(false);
  });
  it('P01: 429 e cota são transitórios (retentativa); página inacessível e 400 não; nada vira nota', () => {
    expect(classificarErroDaApi(429, {})).toMatchObject({ categoria: 'cota', transitorio: true });
    expect(classificarErroDaApi(403, { error: { message: 'Quota exceeded' } }).categoria).toBe('cota');
    expect(classificarErroDaApi(500, { error: { message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST' } })).toMatchObject({ categoria: 'pagina_inacessivel', transitorio: false });
    expect(classificarErroDaApi(400, { error: { message: 'Invalid URL' } })).toMatchObject({ categoria: 'bloqueado', transitorio: false });
    expect(classificarErroDaApi(504, {}).categoria).toBe('timeout');
  });
  it('backoff cresce com jitter e tem teto', () => {
    expect(atrasoDeRetentativa(1, 0.5)).toBe(120_000);
    expect(atrasoDeRetentativa(2, 0)).toBe(180_000);
    expect(atrasoDeRetentativa(20, 0.5)).toBe(60 * 60_000);
  });
  it('P02: mobile e desktop são chaves (séries) distintas; URL da API leva estratégia e categorias', () => {
    expect(chaveDoTrabalho('u1', 'mobile', '2026-10-19')).not.toBe(chaveDoTrabalho('u1', 'desktop', '2026-10-19'));
    const u = new URL(urlDaApi('https://a.com/', 'desktop', 'K'));
    expect(u.searchParams.get('strategy')).toBe('desktop');
    expect(u.searchParams.getAll('category')).toHaveLength(4);
    expect(u.searchParams.get('key')).toBe('K');
  });
});

describe('regressão confirmada', () => {
  it('exige as duas medições mais recentes ≥10 pontos abaixo da referência', () => {
    expect(regressaoConfirmada([50, 55, 80])).toBe(true);
    expect(regressaoConfirmada([50, 75, 80])).toBe(false);
    expect(regressaoConfirmada([75, 50, 80])).toBe(false);
    expect(regressaoConfirmada([50, 55])).toBe(false);
    expect(regressaoConfirmada([null, 55, 80])).toBe(false);
  });
  it('desfeita quando a nota volta a menos de 10 pontos da referência', () => {
    expect(regressaoDesfeita(75, 80)).toBe(true);
    expect(regressaoDesfeita(70, 80)).toBe(false);
    expect(regressaoDesfeita(null, 80)).toBe(false);
  });
});
