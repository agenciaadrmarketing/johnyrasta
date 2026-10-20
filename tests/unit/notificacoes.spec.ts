import { describe, expect, it } from 'vitest';
import { caminhoNaCentral, devePublicar, montarMensagem, type AlertaParaMensagem } from '@/modules/notifications/mensagem';
import { analisarDestinatarios, atrasoDeReentrega, TIPOS_DE_ALERTA } from '@/modules/notifications/regras';
import { lerConfigDeEmail } from '@/modules/notifications/provedor';
import { criarEnviador, transitorioPorStatus } from '../../worker/email';

const base: AlertaParaMensagem = {
  kind: 'incidente_confirmado',
  title: 'Loja Alfa: indisponível para o monitor',
  details: { category: 'http', httpStatus: 503, firstFailureAt: '2026-10-20T12:00:00Z', confirmedAt: '2026-10-20T12:05:00Z' },
  siteId: 'site-1',
  siteNome: 'Loja Alfa',
  siteDomain: 'lojaalfa.com.br',
  createdAt: new Date('2026-10-20T12:05:00Z'),
  fuso: 'America/Sao_Paulo',
  urlDaCentral: 'https://central.exemplo.com',
};

describe('mensagem de e-mail', () => {
  it('incidente confirmado: assunto com prefixo, horários no fuso do site, confirmação em duas checagens, sem prometer instante da queda', () => {
    const m = montarMensagem(base);
    expect(m.assunto).toBe('[JohnyWeb] Loja Alfa: indisponível para o monitor');
    expect(m.corpo).toContain('duas checagens seguidas');
    expect(m.corpo).toContain('o servidor respondeu com erro (HTTP 503)');
    // 12:00Z = 09:00 em São Paulo (UTC-3).
    expect(m.corpo).toContain('Primeira falha observada: 20/10/2026, 09:00');
    expect(m.corpo).toContain('Confirmada na checagem de 20/10/2026, 09:05');
    expect(m.corpo).toContain('O instante exato da queda não é conhecido');
    expect(m.corpo).toContain('https://central.exemplo.com/sites/site-1/disponibilidade');
    expect(m.corpo).toContain('fuso America/Sao_Paulo');
    expect(m.corpo).not.toMatch(/fora do ar por/i);
  });

  it('recuperação: alerta distinto, com duração OBSERVADA e ressalva', () => {
    const m = montarMensagem({ ...base, kind: 'incidente_recuperado', details: { firstFailureAt: '2026-10-20T12:00:00Z', recoveredAt: '2026-10-20T12:50:00Z', observedDurationMs: 50 * 60_000 } });
    expect(m.assunto).toBe('[JohnyWeb] Loja Alfa: respondendo de novo');
    expect(m.corpo).toContain('Duração observada entre as duas: 50 min');
    expect(m.corpo).toContain('pode ter começado antes da primeira falha observada');
  });

  it('TLS vencendo e TLS com falha: data de vencimento e detalhe', () => {
    const v = montarMensagem({ ...base, kind: 'tls_vencendo', details: { expiresAt: '2026-11-01T00:00:00Z', faixaDias: 14 } });
    expect(v.assunto).toContain('certificado próximo do vencimento');
    expect(v.corpo).toContain('vence em 31/10/2026, 21:00 (14 dias ou menos)');
    const f = montarMensagem({ ...base, kind: 'tls_falha', details: { detail: 'certificate has expired' } });
    expect(f.corpo).toContain('certificate has expired');
    expect(f.corpo).toContain('aviso de segurança');
  });

  it('verificação atrasada fala do worker, não do site; coletor parado é suspeita, não prova', () => {
    const a = montarMensagem({ ...base, kind: 'verificacao_atrasada', details: { lastCheckAt: '2026-10-20T11:00:00Z', resumedAt: '2026-10-20T12:05:00Z' } });
    expect(a.corpo).toContain('Isto é sobre o worker, não sobre o site');
    expect(a.corpo).toContain('Última checagem antes do atraso: 20/10/2026, 08:00');
    const c = montarMensagem({ ...base, kind: 'coletor_parado', details: { mediaDiaria: 42.4 } });
    expect(c.corpo).toContain('média de 42 por dia');
    expect(c.corpo).toContain('é uma suspeita, não uma prova');
    expect(c.corpo).toContain('/sites/site-1/instalacao');
  });

  it('fila parada não tem site: assunto sem nome, link para Atenção, fuso padrão', () => {
    const m = montarMensagem({ ...base, kind: 'fila_parada', siteId: null, siteNome: null, siteDomain: null, details: { pendentes: 3 }, urlDaCentral: null });
    expect(m.assunto).toBe('[JohnyWeb] Fila de medições do PageSpeed parada');
    expect(m.corpo).toContain('Há 3 medições devidas do PageSpeed há mais de 2 h');
    expect(m.corpo).toContain('/atencao (defina APP_URL');
  });

  it('tipo desconhecido não quebra: usa o título do alerta', () => {
    const m = montarMensagem({ ...base, kind: 'novo_tipo', title: 'Algo novo', details: {} });
    expect(m.assunto).toBe('[JohnyWeb] Loja Alfa: Algo novo');
    expect(m.corpo).toContain('Algo novo');
  });

  it('caminho na central por tipo', () => {
    expect(caminhoNaCentral('incidente_confirmado', 's')).toBe('/sites/s/disponibilidade');
    expect(caminhoNaCentral('coletor_parado', 's')).toBe('/sites/s/instalacao');
    expect(caminhoNaCentral('fila_parada', null)).toBe('/atencao');
  });
});

describe('devePublicar', () => {
  const conta = { emailEnabled: true, recipients: ['a@x.com'], kinds: [...TIPOS_DE_ALERTA] };
  const alerta = { kind: 'incidente_confirmado', siteId: 's1' };
  it('tudo ligado → publica; sem preferência do site = ligado', () => {
    expect(devePublicar(conta, null, alerta)).toBe(true);
    expect(devePublicar(conta, { emailEnabled: true }, alerta)).toBe(true);
  });
  it('conta sem configuração ou com e-mail desligado → não', () => {
    expect(devePublicar(null, null, alerta)).toBe(false);
    expect(devePublicar({ ...conta, emailEnabled: false }, null, alerta)).toBe(false);
  });
  it('sem destinatários → não', () => {
    expect(devePublicar({ ...conta, recipients: [] }, null, alerta)).toBe(false);
  });
  it('tipo fora da lista → não', () => {
    expect(devePublicar({ ...conta, kinds: ['tls_vencendo'] }, null, alerta)).toBe(false);
  });
  it('site desligado → não; alerta sem site ignora a preferência de site', () => {
    expect(devePublicar(conta, { emailEnabled: false }, alerta)).toBe(false);
    expect(devePublicar(conta, { emailEnabled: false }, { kind: 'fila_parada', siteId: null })).toBe(true);
  });
});

describe('regras', () => {
  it('destinatários: um por linha, vírgula e ponto e vírgula; minúsculas; sem repetição; inválidos listados', () => {
    const r = analisarDestinatarios('A@X.com\n b@x.com, a@x.com; invalido\n\n c@x');
    expect(r.validos).toEqual(['a@x.com', 'b@x.com']);
    expect(r.invalidos).toEqual(['invalido', 'c@x']);
    expect(analisarDestinatarios('')).toEqual({ validos: [], invalidos: [] });
  });
  it('backoff: 1, 2, 4, 8, 16 min com jitter de ±25% e teto', () => {
    expect(atrasoDeReentrega(1, 0.5)).toBe(60_000);
    expect(atrasoDeReentrega(2, 0.5)).toBe(120_000);
    expect(atrasoDeReentrega(3, 0.5)).toBe(240_000);
    expect(atrasoDeReentrega(4, 0.5)).toBe(480_000);
    expect(atrasoDeReentrega(5, 0.5)).toBe(960_000);
    expect(atrasoDeReentrega(9, 0.5)).toBe(960_000);
    expect(atrasoDeReentrega(1, 0)).toBe(45_000);
    expect(atrasoDeReentrega(1, 1)).toBe(75_000);
  });
  it('configuração do provedor: ausente, desconhecido, incompleto e completo; nunca expõe a chave na descrição', () => {
    expect(lerConfigDeEmail({})).toMatchObject({ ativo: false, motivo: 'EMAIL_PROVIDER ausente' });
    expect(lerConfigDeEmail({ EMAIL_PROVIDER: 'sendgrid' }).ativo).toBe(false);
    expect(lerConfigDeEmail({ EMAIL_PROVIDER: 'resend' })).toMatchObject({ ativo: false, motivo: expect.stringContaining('EMAIL_API_KEY') });
    expect(lerConfigDeEmail({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'k' })).toMatchObject({ ativo: false, motivo: expect.stringContaining('EMAIL_FROM') });
    const ok = lerConfigDeEmail({ EMAIL_PROVIDER: 'Resend', EMAIL_API_KEY: 're_segredo', EMAIL_FROM: 'a@x.com' });
    expect(ok).toMatchObject({ ativo: true, provedor: 'resend', from: 'a@x.com' });
    expect(ok.ativo && ok.descricao).not.toContain('re_segredo');
    expect(lerConfigDeEmail({ EMAIL_PROVIDER: 'webhook', EMAIL_WEBHOOK_URL: 'ftp://x' }).ativo).toBe(false);
    expect(lerConfigDeEmail({ EMAIL_PROVIDER: 'webhook', EMAIL_WEBHOOK_URL: 'https://hooks.exemplo.com/jw' })).toMatchObject({ ativo: true, descricao: 'Webhook · hooks.exemplo.com' });
    expect(lerConfigDeEmail({ EMAIL_PROVIDER: 'log' })).toMatchObject({ ativo: true, provedor: 'log' });
  });
});

describe('adaptador de e-mail (worker/email.ts)', () => {
  type Chamada = { url: string; init: RequestInit };
  const resposta = (status: number, corpo: unknown) =>
    ({ ok: status >= 200 && status < 300, status, text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) }) as Response;
  const fetchQueDevolve = (status: number, corpo: unknown, chamadas: Chamada[] = []) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), init: init ?? {} });
      return resposta(status, corpo);
    }) as typeof fetch;
  const pedido = { to: 'a@x.com', subject: '[JohnyWeb] teste', text: 'corpo', alertId: 'alerta-1' };
  const cfgResend = lerConfigDeEmail({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_k', EMAIL_FROM: 'alertas@x.com' });

  it('resend 200 → ok com id; cabeçalho Bearer, from, to, subject e text no corpo', async () => {
    const chamadas: Chamada[] = [];
    const enviar = criarEnviador(cfgResend, { fetch: fetchQueDevolve(200, { id: 'msg_1' }, chamadas) })!;
    expect(await enviar(pedido)).toEqual({ ok: true, id: 'msg_1' });
    expect(chamadas[0]!.url).toBe('https://api.resend.com/emails');
    const h = chamadas[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer re_k');
    expect(JSON.parse(chamadas[0]!.init.body as string)).toEqual({ from: 'alertas@x.com', to: ['a@x.com'], subject: '[JohnyWeb] teste', text: 'corpo' });
  });
  it('resend 429 → transitório; 400 → definitivo; 500 → transitório', async () => {
    expect(await criarEnviador(cfgResend, { fetch: fetchQueDevolve(429, { message: 'rate limited' }) })!(pedido)).toMatchObject({ ok: false, transitorio: true, erro: expect.stringContaining('HTTP 429') });
    expect(await criarEnviador(cfgResend, { fetch: fetchQueDevolve(400, { message: 'invalid from' }) })!(pedido)).toMatchObject({ ok: false, transitorio: false, erro: expect.stringContaining('invalid from') });
    expect(await criarEnviador(cfgResend, { fetch: fetchQueDevolve(503, '') })!(pedido)).toMatchObject({ ok: false, transitorio: true });
  });
  it('timeout → transitório, e o fetch recebe o sinal de abort', async () => {
    const fetchLento = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, rej) => {
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as typeof fetch;
    const r = await criarEnviador(cfgResend, { fetch: fetchLento, timeoutMs: 20 })!(pedido);
    expect(r).toMatchObject({ ok: false, transitorio: true, erro: expect.stringContaining('sem resposta') });
  });
  it('erro de rede → transitório; nunca ok sem 2xx', async () => {
    const fetchQueFalha = (async () => { throw new Error('ECONNRESET'); }) as typeof fetch;
    expect(await criarEnviador(cfgResend, { fetch: fetchQueFalha })!(pedido)).toMatchObject({ ok: false, transitorio: true, erro: 'rede: ECONNRESET' });
    expect(await criarEnviador(cfgResend, { fetch: fetchQueDevolve(302, '') })!(pedido)).toMatchObject({ ok: false });
  });
  it('webhook: POST na URL com {to, subject, text, alertId}; 204 sem corpo é ok sem id; 404 é definitivo', async () => {
    const chamadas: Chamada[] = [];
    const cfg = lerConfigDeEmail({ EMAIL_PROVIDER: 'webhook', EMAIL_WEBHOOK_URL: 'https://hooks.exemplo.com/jw', EMAIL_API_KEY: 'tok' });
    const enviar = criarEnviador(cfg, { fetch: fetchQueDevolve(204, '', chamadas) })!;
    expect(await enviar(pedido)).toEqual({ ok: true, id: undefined });
    expect(chamadas[0]!.url).toBe('https://hooks.exemplo.com/jw');
    expect(JSON.parse(chamadas[0]!.init.body as string)).toMatchObject({ to: 'a@x.com', subject: '[JohnyWeb] teste', text: 'corpo', alertId: 'alerta-1' });
    expect((chamadas[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(await criarEnviador(cfg, { fetch: fetchQueDevolve(404, 'not found') })!(pedido)).toMatchObject({ ok: false, transitorio: false });
  });
  it('postmark: token no cabeçalho próprio e MessageID como id', async () => {
    const chamadas: Chamada[] = [];
    const cfg = lerConfigDeEmail({ EMAIL_PROVIDER: 'postmark', EMAIL_API_KEY: 'pm_k', EMAIL_FROM: 'alertas@x.com' });
    const enviar = criarEnviador(cfg, { fetch: fetchQueDevolve(200, { MessageID: 'pm-1', ErrorCode: 0 }, chamadas) })!;
    expect(await enviar(pedido)).toEqual({ ok: true, id: 'pm-1' });
    expect((chamadas[0]!.init.headers as Record<string, string>)['x-postmark-server-token']).toBe('pm_k');
    expect(chamadas[0]!.url).toBe('https://api.postmarkapp.com/email');
  });
  it('log: registra e devolve ok; sem provedor: enviador nulo', async () => {
    const linhas: string[] = [];
    const enviar = criarEnviador(lerConfigDeEmail({ EMAIL_PROVIDER: 'log' }), { log: (l) => linhas.push(l) })!;
    expect(await enviar(pedido)).toMatchObject({ ok: true });
    expect(linhas[0]).toContain('a@x.com');
    expect(criarEnviador(lerConfigDeEmail({}))).toBeNull();
  });
  it('classificação por status', () => {
    expect(transitorioPorStatus(429)).toBe(true);
    expect(transitorioPorStatus(500)).toBe(true);
    expect(transitorioPorStatus(408)).toBe(true);
    expect(transitorioPorStatus(400)).toBe(false);
    expect(transitorioPorStatus(422)).toBe(false);
  });
});
