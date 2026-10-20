import { describe, expect, it } from 'vitest';
import { acaoDoHref, coletaParouDeChegar, escolherCliqueAtribuido, horaLocal, normalizarPath, origemDaSessao, sessaoAindaAtiva, validarEvento } from '@/modules/analytics/regras';
import { filtrarCampos, identificadores, normalizarEmail, normalizarTelefone } from '@/modules/contacts/identidade';
import { celulaCsv, linhasCsv } from '@/shared/validation/csv';

const agora = new Date('2026-10-20T12:00:00Z');

describe('eventos', () => {
  const base = { event_id: 'evt_12345678', session_key: 'ses_12345678', type: 'page_view', path: '/contato?token=abc#x', occurred_at: '2026-10-20T11:59:00Z' };
  it('valida e limpa: path sem query/hash, só UTMs permitidas, referrer vira host', () => {
    const r = validarEvento({ ...base, utm: { utm_source: 'ig', gclid: 'x', utm_campaign: 'c' }, referrer: 'https://l.instagram.com/?u=1' }, agora);
    expect(r.ok && r.evento.path).toBe('/contato');
    expect(r.ok && r.evento.utm).toEqual({ utm_source: 'ig', utm_campaign: 'c' });
    expect(r.ok && r.evento.referrer).toBe('l.instagram.com');
  });
  it('rejeita ids curtos, tipos estranhos, clique sem ação e relógio fora da janela', () => {
    expect(validarEvento({ ...base, event_id: 'x' }, agora).ok).toBe(false);
    expect(validarEvento({ ...base, type: 'purchase' }, agora).ok).toBe(false);
    expect(validarEvento({ ...base, type: 'click' }, agora).ok).toBe(false);
    expect(validarEvento({ ...base, occurred_at: '2026-10-20T09:00:00Z' }, agora).ok).toBe(false);
    expect(validarEvento({ ...base, occurred_at: '2026-10-20T12:10:00Z' }, agora).ok).toBe(false);
  });
  it('path normalizado e origem', () => {
    expect(normalizarPath('/a/b/?x=1')).toBe('/a/b');
    expect(normalizarPath('/')).toBe('/');
    expect(origemDaSessao({ utm_source: 'meta', utm_medium: 'cpc' }, null, 'site.com')).toEqual({ source: 'meta', medium: 'cpc', campaign: null });
    expect(origemDaSessao({}, 'www.site.com', 'site.com').source).toBe('direto');
    expect(origemDaSessao({}, 'www.google.com.br', 'site.com')).toMatchObject({ source: 'google', medium: 'organico' });
    expect(origemDaSessao({}, 'blog.parceiro.com', 'site.com')).toMatchObject({ source: 'blog.parceiro.com', medium: 'referral' });
  });
  it('E03: sessão expira em 30 min de inatividade', () => {
    expect(sessaoAindaAtiva(new Date('2026-10-20T11:00:00Z'), new Date('2026-10-20T11:30:00Z'))).toBe(true);
    expect(sessaoAindaAtiva(new Date('2026-10-20T11:00:00Z'), new Date('2026-10-20T11:30:01Z'))).toBe(false);
  });
  it('detecção automática de WhatsApp, telefone e e-mail', () => {
    expect(acaoDoHref('https://wa.me/5511999999999')).toBe('whatsapp');
    expect(acaoDoHref('https://api.whatsapp.com/send?phone=1')).toBe('whatsapp');
    expect(acaoDoHref('tel:+5511')).toBe('phone');
    expect(acaoDoHref('mailto:a@b.co')).toBe('email');
    expect(acaoDoHref('https://site.com/contato')).toBeNull();
  });
  it('coleta interrompida só com volume regular', () => {
    expect(coletaParouDeChegar([30, 25, 40, 22, 28, 35, 31], 0)).toBe(true);
    expect(coletaParouDeChegar([3, 0, 2, 1, 0, 4, 2], 0)).toBe(false);
    expect(coletaParouDeChegar([30, 25, 40, 22, 28, 35, 31], 5)).toBe(false);
  });
});

describe('atribuição (T02, T03)', () => {
  const ev = (min: number, type = 'click') => ({ occurredAt: new Date(agora.getTime() - min * 60_000), type });
  it('último clique elegível na janela de 30 min', () => {
    const c = escolherCliqueAtribuido([ev(40), ev(12), ev(3), ev(1, 'page_view')], agora);
    expect(c?.occurredAt).toEqual(ev(3).occurredAt);
  });
  it('sem clique na janela: sem atribuição; clique depois da submissão não conta', () => {
    expect(escolherCliqueAtribuido([ev(31)], agora)).toBeNull();
    expect(escolherCliqueAtribuido([ev(-2)], agora)).toBeNull();
    expect(escolherCliqueAtribuido([], agora)).toBeNull();
  });
});

describe('horários (T01)', () => {
  it('meia-noite UTC cai às 21h do dia anterior em São Paulo', () => {
    expect(horaLocal(new Date('2026-10-20T00:30:00Z'), 'America/Sao_Paulo')).toEqual({ hora: 21, diaSemana: 1, data: '2026-10-19' });
    expect(horaLocal(new Date('2026-10-20T00:30:00Z'), 'UTC')).toEqual({ hora: 0, diaSemana: 2, data: '2026-10-20' });
  });
});

describe('identidade', () => {
  it('e-mail e telefone normalizados com país explícito', () => {
    expect(normalizarEmail('  Joao@Exemplo.COM ')).toBe('joao@exemplo.com');
    expect(normalizarEmail('nao-e-email')).toBeNull();
    expect(normalizarTelefone('(11) 99999-8888')).toBe('+5511999998888');
    expect(normalizarTelefone('011 3333-4444')).toBe('+551133334444');
    expect(normalizarTelefone('+351 912 345 678')).toBe('+351912345678');
    expect(normalizarTelefone('912345678', 'PT')).toBe('+351912345678');
    expect(normalizarTelefone('123')).toBeNull();
    expect(normalizarTelefone('55 11 99999 8888')).toBe('+5511999998888');
  });
  it('campos permitidos: mensagem só quando ativada; newsletter sem nome é válida', () => {
    expect(filtrarCampos({ name: 'A', email: 'a@b.co', message: 'oi', password: 'x' }, ['name', 'email', 'message'], false)).toEqual({ name: 'A', email: 'a@b.co' });
    expect(filtrarCampos({ email: 'a@b.co', message: 'oi' }, ['email', 'message'], true)).toEqual({ email: 'a@b.co', message: 'oi' });
    expect(identificadores({ email: 'a@b.co' }, 'BR').valido).toBe(true);
    expect(identificadores({ name: 'Só nome' }, 'BR').valido).toBe(false);
  });
});

describe('CSV', () => {
  it('protege fórmulas e escapa', () => {
    expect(celulaCsv('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(celulaCsv('+5511')).toBe("'+5511");
    expect(celulaCsv('a,b')).toBe('"a,b"');
    expect(linhasCsv(['a'], [['x']])).toBe('﻿a\r\nx\r\n');
  });
});
