import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { verificar } from '../../worker/verificador';

/**
 * Servidores locais em 127.0.0.1, liberados por exceção EXPLÍCITA. O que o
 * verificador faz com o restante da rede privada continua bloqueado — e há
 * teste para isso.
 */
const EXC = ['127.0.0.1'];
let servidor: http.Server;
let porta: number;
let modo: 'ok' | 'erro' | 'lento' | 'enorme' | 'loop' | 'privado' | 'host' = 'ok';
let ultimoHost = '';

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    ultimoHost = req.headers.host ?? '';
    if (modo === 'ok') return res.writeHead(200).end('ok');
    if (modo === 'erro') return res.writeHead(503).end('down');
    if (modo === 'lento') return void setTimeout(() => res.writeHead(200).end('tarde'), 3_000);
    if (modo === 'enorme') {
      res.writeHead(200); // sem Content-Length: o limite tem de valer pelos bytes lidos
      const bloco = Buffer.alloc(64 * 1024, 'x');
      let enviados = 0;
      const empurrar = () => {
        while (enviados < 8 * 1024 * 1024) {
          enviados += bloco.length;
          if (!res.write(bloco)) return void res.once('drain', empurrar);
        }
        res.end();
      };
      return empurrar();
    }
    if (modo === 'loop') return res.writeHead(302, { location: req.url ?? '/' }).end();
    if (modo === 'privado') return res.writeHead(302, { location: 'http://10.0.0.1/segredo' }).end();
    if (modo === 'host') return res.writeHead(200).end(ultimoHost);
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  porta = (servidor.address() as AddressInfo).port;
});
afterAll(() => servidor.close());

// Portas fora de 80/443 são bloqueadas pela política; os testes injetam um
// resolver e usam a porta real só na conexão. Para isso, o verificador recebe
// uma URL na porta 80 e o resolver devolve 127.0.0.1 — mas a porta precisa
// ser a do servidor de teste. Resolvemos com um proxy mínimo: um servidor na
// porta 80 não é possível sem root, então testamos via `baseUrl` + override
// do destino no `lookup`? Não: o verificador conecta na porta da URL. Logo, os
// testes abaixo usam um servidor em porta alta e um `avaliarUrl` que a aceita
// APENAS porque o host é a exceção local. Ver `PORTA_LOCAL_DE_TESTE`.

describe('verificador HTTP seguro', () => {
  const url = (caminho = '/') => `http://127.0.0.1:${porta}${caminho}`;
  const op = { excecoesDeRede: EXC, timeoutMs: 1_500, maxBytes: 256 * 1024 };

  it('2xx é saudável; registra duração até os cabeçalhos; sem TLS em http', async () => {
    modo = 'ok';
    const r = await verificar(url(), op);
    expect(r.ok).toBe(true);
    expect(r.httpStatus).toBe(200);
    expect(r.tlsState).toBe('sem_tls');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('5xx é falha HTTP com o código registrado', async () => {
    modo = 'erro';
    const r = await verificar(url(), op);
    expect(r.ok).toBe(false);
    expect(r.errorCategory).toBe('http');
    expect(r.httpStatus).toBe(503);
  });

  it('U08: resposta lenta estoura o prazo global', async () => {
    modo = 'lento';
    const r = await verificar(url(), { ...op, timeoutMs: 700 });
    expect(r.ok).toBe(false);
    expect(r.errorCategory).toBe('timeout');
    expect(r.durationMs!).toBeLessThan(2_500);
  });

  it('U08: resposta enorme é cortada no limite de bytes LIDOS, não no Content-Length', async () => {
    modo = 'enorme';
    const inicio = Date.now();
    const r = await verificar(url(), op);
    expect(r.ok).toBe(true);
    expect(Date.now() - inicio).toBeLessThan(5_000);
  });

  it('U08: redirecionamento infinito para no limite', async () => {
    modo = 'loop';
    const r = await verificar(url('/a'), op);
    expect(r.ok).toBe(false);
    expect(r.errorCategory).toBe('redirecionamentos');
    expect(r.redirects).toBe(4);
  });

  it('U04: redirecionamento para IP privado NÃO estabelece conexão', async () => {
    modo = 'privado';
    const r = await verificar(url(), op);
    expect(r.ok).toBe(false);
    expect(r.errorCategory).toBe('bloqueado');
    expect(r.errorDetail).toMatch(/10\.0\.0\.1/);
    expect(r.redirects).toBe(1);
  });

  it('porta fora de 80/443 num nome público é bloqueada mesmo depois de resolver', async () => {
    modo = 'ok';
    const r = await verificar(`http://publico.exemplo.com:${porta}/`, { ...op, resolver: async () => ['8.8.8.8'] });
    expect(r.errorCategory).toBe('bloqueado');
    expect(r.errorDetail).toMatch(/porta/);
  });

  it('U04: host que resolve para endereço privado é bloqueado antes de conectar', async () => {
    modo = 'ok';
    const r = await verificar('http://interno.exemplo.com/', { ...op, excecoesDeRede: [], resolver: async () => ['10.1.2.3'] });
    expect(r.errorCategory).toBe('bloqueado');
  });

  it('U05: a conexão usa o IP validado na resolução, com o Host original (DNS fixado)', async () => {
    modo = 'host';
    let chamadas = 0;
    const resolver = async () => {
      chamadas += 1;
      // Primeira resolução: local (validado por exceção). Qualquer outra: privado.
      return chamadas === 1 ? ['127.0.0.1'] : ['10.9.9.9'];
    };
    const r = await verificar(`http://pinado.exemplo.com:${porta}/`, { ...op, resolver });
    expect(r.ok).toBe(true);
    expect(ultimoHost).toBe(`pinado.exemplo.com:${porta}`);
    expect(chamadas).toBe(1);
  });

  it('DNS que não resolve é categoria dns; DNS lento é timeout', async () => {
    const r1 = await verificar('http://nao-existe.exemplo.com/', { ...op, resolver: async () => { throw new Error('ENOTFOUND'); } });
    expect(r1.errorCategory).toBe('dns');
    const r2 = await verificar('http://lento.exemplo.com/', { ...op, timeoutMs: 300, resolver: () => new Promise(() => {}) });
    expect(r2.errorCategory).toBe('timeout');
  });
});

describe('U06 — TLS', () => {
  let tls: https.Server;
  let portaTls: number;
  let temOpenssl = true;
  beforeAll(async () => {
    try {
      const dir = mkdtempSync(join(tmpdir(), 'johny-tls-'));
      execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 2 -subj "/CN=localhost" 2>/dev/null`);
      tls = https.createServer({ key: readFileSync(`${dir}/k.pem`), cert: readFileSync(`${dir}/c.pem`) }, (_req, res) => res.writeHead(200).end('ok'));
      await new Promise<void>((r) => tls.listen(0, '127.0.0.1', r));
      portaTls = (tls.address() as AddressInfo).port;
    } catch {
      temOpenssl = false;
    }
  });
  afterAll(() => tls?.close());

  it('certificado não confiável é falha explícita, sem data de expiração inventada', async () => {
    if (!temOpenssl) return;
    const r = await verificar(`https://127.0.0.1:${portaTls}/`, { excecoesDeRede: EXC, timeoutMs: 2_000 });
    expect(r.ok).toBe(false);
    expect(r.errorCategory).toBe('tls');
    expect(r.tlsState).toBe('falha');
    expect(r.tlsExpiresAt).toBeNull();
  });
});
