/**
 * Verificador HTTP seguro.
 *
 * Uma requisição GET por checagem, com:
 *  - validação da URL antes de resolver (esquema, porta, host reservado);
 *  - resolução DNS própria e validação de TODOS os endereços;
 *  - conexão FIXADA no IP validado (`lookup` injetado): o que foi validado é
 *    o que recebe a conexão — DNS rebinding não troca o destino (U05);
 *  - revalidação em cada redirecionamento (U04), no máximo 3;
 *  - timeout GLOBAL, incluindo DNS (U08);
 *  - limite de bytes lidos, independente de Content-Length (U08);
 *  - TLS verificado (certificado e hostname) e expiração lida do socket (U06).
 *
 * Saudável = resposta FINAL 2xx. 401/403 são registrados com o código e
 * contam como falha HTTP, para quem opera investigar.
 */
import http from 'node:http';
import https from 'node:https';
import { promises as dns } from 'node:dns';
import type { TLSSocket } from 'node:tls';
import { avaliarEnderecos, avaliarUrl, portaExigeExcecao } from '@/modules/monitoring/rede';
import type { ResultadoDaChecagem } from '@/modules/monitoring/transicao';

export type OpcoesDoVerificador = {
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  /** IPs privados permitidos explicitamente (testes locais, rede própria). Nunca padrão. */
  excecoesDeRede?: readonly string[];
  /** Resolução DNS injetável, para testes. */
  resolver?: (host: string) => Promise<string[]>;
  userAgent?: string;
};

const PADRAO = {
  timeoutMs: 10_000,
  maxRedirects: 3,
  maxBytes: 512 * 1024,
  userAgent: 'JohnyWeb-Monitor/2.0 (+verificador de disponibilidade)',
};

async function resolverPadrao(host: string): Promise<string[]> {
  const r = await dns.lookup(host, { all: true, verbatim: true });
  return r.map((x) => x.address);
}

class Falha extends Error {
  constructor(public categoria: NonNullable<ResultadoDaChecagem['errorCategory']>, detalhe: string) {
    super(detalhe);
  }
}

export async function verificar(urlInicial: string, opcoes: OpcoesDoVerificador = {}): Promise<ResultadoDaChecagem> {
  const o = { ...PADRAO, ...opcoes, resolver: opcoes.resolver ?? resolverPadrao, excecoesDeRede: opcoes.excecoesDeRede ?? [] };
  const prazo = Date.now() + o.timeoutMs;
  const restante = () => prazo - Date.now();

  let url = urlInicial;
  let redirects = 0;
  let tlsExpiresAt: Date | null = null;
  let tlsState: ResultadoDaChecagem['tlsState'] = 'desconhecido';
  const inicio = Date.now();

  try {
    for (;;) {
      const d = avaliarUrl(url, o.excecoesDeRede);
      if (!d.ok) throw new Falha('bloqueado', d.motivo);
      if (restante() <= 0) throw new Falha('timeout', 'prazo esgotado antes de resolver DNS');

      let ips: string[];
      try {
        ips = await comPrazo(o.resolver(d.host), restante(), 'DNS');
      } catch (e) {
        if (e instanceof Falha) throw e;
        throw new Falha('dns', `não resolve: ${mensagem(e)}`);
      }
      const dIp = avaliarEnderecos(ips, o.excecoesDeRede);
      if (!dIp.ok) throw new Falha('bloqueado', dIp.motivo);
      if (portaExigeExcecao(d.porta) && !ips.every((ip) => o.excecoesDeRede.includes(ip))) {
        throw new Falha('bloqueado', `porta ${d.porta} não permitida`);
      }
      const ip = ips[0]!;

      const resp = await requisicao(d.url, ip, restante(), o.userAgent, o.maxBytes);
      if (resp.tls) {
        tlsState = resp.tls.state;
        tlsExpiresAt = resp.tls.expiresAt;
      } else if (d.url.protocol === 'http:') {
        tlsState = 'sem_tls';
        tlsExpiresAt = null;
      }

      if (resp.status >= 300 && resp.status < 400 && resp.location) {
        redirects += 1;
        if (redirects > o.maxRedirects) throw new Falha('redirecionamentos', `mais de ${o.maxRedirects} redirecionamentos`);
        url = new URL(resp.location, url).toString();
        continue;
      }
      const ok = resp.status >= 200 && resp.status < 300;
      return {
        ok,
        httpStatus: resp.status,
        durationMs: Date.now() - inicio,
        errorCategory: ok ? null : 'http',
        errorDetail: ok ? null : `HTTP ${resp.status}`,
        finalUrl: url,
        redirects,
        tlsExpiresAt,
        tlsState,
      };
    }
  } catch (e) {
    const f = e instanceof Falha ? e : new Falha('desconhecido', mensagem(e));
    return {
      ok: false,
      httpStatus: null,
      durationMs: Date.now() - inicio,
      errorCategory: f.categoria,
      errorDetail: f.message.slice(0, 300),
      finalUrl: url,
      redirects,
      tlsExpiresAt: f.categoria === 'tls' ? null : tlsExpiresAt,
      tlsState: f.categoria === 'tls' ? 'falha' : tlsState,
    };
  }
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function comPrazo<T>(p: Promise<T>, ms: number, oQue: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Falha('timeout', `${oQue} excedeu o prazo`)), Math.max(0, ms));
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

type Resposta = { status: number; location: string | null; tls: null | { state: 'valido' | 'falha'; expiresAt: Date | null } };

function requisicao(url: URL, ip: string, prazoMs: number, userAgent: string, maxBytes: number): Promise<Resposta> {
  return new Promise<Resposta>((resolve, reject) => {
    const https_ = url.protocol === 'https:';
    const mod = https_ ? https : http;
    let encerrado = false;
    const fim = (fn: () => void) => { if (!encerrado) { encerrado = true; fn(); } };

    const req = mod.request(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': userAgent, accept: 'text/html,*/*;q=0.5', 'accept-encoding': 'identity' },
        // A conexão vai para o IP JÁ VALIDADO, com o nome original para SNI e Host.
        lookup: (_host, opts, cb) => {
          const family = ip.includes(':') ? 6 : 4;
          const o = opts as { all?: boolean };
          if (o.all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: ip, family }]);
          else cb(null, ip, family);
        },
        servername: https_ ? url.hostname : undefined,
        rejectUnauthorized: true,
        agent: false,
      },
      (res) => {
        let tls: Resposta['tls'] = null;
        if (https_) {
          const s = res.socket as TLSSocket;
          const cert = s.getPeerCertificate?.();
          const validade = cert && cert.valid_to ? new Date(cert.valid_to) : null;
          tls = { state: 'valido', expiresAt: validade && !Number.isNaN(validade.getTime()) ? validade : null };
        }
        const status = res.statusCode ?? 0;
        const location = res.headers.location ?? null;
        // Lê até o limite e descarta; acima dele, encerra a conexão. O limite é
        // de bytes LIDOS, não do Content-Length declarado.
        let lidos = 0;
        res.on('data', (chunk: Buffer) => {
          lidos += chunk.length;
          if (lidos > maxBytes) {
            res.destroy();
            fim(() => resolve({ status, location, tls }));
          }
        });
        res.on('end', () => fim(() => resolve({ status, location, tls })));
        res.on('error', () => fim(() => resolve({ status, location, tls })));
      },
    );
    req.setTimeout(Math.max(1, prazoMs), () => {
      req.destroy(new Falha('timeout', 'sem resposta dentro do prazo'));
    });
    const prazoGlobal = setTimeout(() => req.destroy(new Falha('timeout', 'prazo global esgotado')), Math.max(1, prazoMs));
    req.on('close', () => clearTimeout(prazoGlobal));
    req.on('error', (e: NodeJS.ErrnoException) => {
      fim(() => {
        if (e instanceof Falha) return reject(e);
        const code = e.code ?? '';
        if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|HOSTNAME|altnames|certificate/i.test(`${code} ${e.message}`)) {
          return reject(new Falha('tls', `${code || 'TLS'}: ${e.message}`));
        }
        if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'EPIPE') {
          return reject(new Falha('conexao', `${code}: ${e.message}`));
        }
        if (code === 'ETIMEDOUT') return reject(new Falha('timeout', e.message));
        reject(new Falha('conexao', `${code || 'erro'}: ${e.message}`));
      });
    });
    req.end();
  });
}
