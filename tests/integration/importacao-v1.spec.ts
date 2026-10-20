import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { criarConta, prepararBanco, urls } from './apoio';
import { aplicarImportacao, lerExistentes, planejarImportacao, type DadosV1 } from '../../src/modules/portfolio/importacao-v1';

let admin: Client;
let conta: { accountId: string };
const dados: DadosV1 = {
  clients: [
    { id: 'c1', name: 'Clínica Sol', notes: 'Cliente antigo' },
    { id: 'c2', name: 'Arquivada', archived_at: '2026-01-01' },
    { id: 'c3', name: 'Loja Mar' },
  ],
  sites: [
    { id: 's1', client_id: 'c1', name: 'Site Sol', domain: 'www.clinicasol.com.br', timezone: 'America/Manaus', platform: 'wordpress' },
    { id: 's2', client_id: 'c1', name: 'Blog Sol', domain: 'blog.clinicasol.com.br', timezone: 'Fuso/Inexistente', platform: 'xyz' },
    { id: 's3', client_id: 'c2', name: 'Velho', domain: 'velho.com.br' },
    { id: 's4', client_id: 'c3', name: 'Loja', domain: '192.168.0.1' },
    { id: 's5', client_id: 'c3', name: 'Loja Mar', domain: 'lojamar.com.br', archived_at: '2026-02-02' },
    { id: 's6', client_id: 'c3', name: 'Repetido', domain: 'clinicasol.com.br' },
  ],
  monitored_urls: [
    { site_id: 's1', url: 'https://www.clinicasol.com.br/contato?x=1', prioritaria: true },
    { site_id: 's1', url: 'https://outro.com/', prioritaria: true },
    { site_id: 's1', url: 'https://www.clinicasol.com.br/sobre', prioritaria: false },
  ],
};

beforeAll(async () => {
  await prepararBanco();
  admin = new Client({ connectionString: urls().admin });
  await admin.connect();
  conta = await criarConta(admin, 'Conta Import');
});
afterAll(async () => { await admin.end(); });

describe('importação do cadastro da V1', () => {
  it('o plano ignora com motivo: arquivado, IP, domínio repetido; troca fuso/plataforma inválidos por padrão', () => {
    const p = planejarImportacao(dados, { clientes: new Set(), dominios: new Set() });
    const sites = p.filter((x) => x.tipo === 'site');
    expect(sites.filter((x) => x.acao === 'criar').map((x) => x.v1Id)).toEqual(['s1', 's2']);
    const ign = Object.fromEntries(sites.filter((x) => x.acao === 'ignorar').map((x) => [x.v1Id, (x as { motivo: string }).motivo]));
    expect(ign.s3).toMatch(/cliente arquivado/);
    expect(ign.s4).toMatch(/domínio inválido/);
    expect(ign.s5).toMatch(/arquivado na V1/);
    expect(ign.s6).toMatch(/já cadastrado/);
    const s2 = sites.find((x) => x.v1Id === 's2');
    expect(s2).toMatchObject({ fuso: 'America/Sao_Paulo', plataforma: 'outro' });
    const s1 = sites.find((x) => x.v1Id === 's1');
    expect(s1).toMatchObject({ domain: 'clinicasol.com.br', url: 'https://www.clinicasol.com.br/', fuso: 'America/Manaus', plataforma: 'wordpress', urlsPrioritarias: ['https://www.clinicasol.com.br/contato'] });
  });
  it('aplica, é idempotente na segunda rodada e não toca no que já existe', async () => {
    const r1 = await aplicarImportacao(admin, conta.accountId, dados, { monitorar: true });
    expect(r1.resultado).toMatchObject({ clientesCriados: 1, sitesCriados: 2, urlsPrioritarias: 1 });
    expect((await admin.query('select count(*)::int as n from monitors')).rows[0].n).toBe(2);
    const site = (await admin.query("select notes, public_id, primary_url from sites where domain = 'clinicasol.com.br'")).rows[0];
    expect(site.notes).toBe('Importado da V1.');
    expect(site.public_id.length).toBeGreaterThan(8);
    const r2 = await aplicarImportacao(admin, conta.accountId, dados, { monitorar: true });
    expect(r2.resultado).toMatchObject({ clientesCriados: 0, sitesCriados: 0 });
    expect((await admin.query('select count(*)::int as n from sites')).rows[0].n).toBe(2);
    expect((await lerExistentes(admin, conta.accountId)).dominios.size).toBe(2);
    expect((await admin.query("select count(*)::int as n from audit_log where action = 'importacao.v1'")).rows[0].n).toBe(2);
  });
});
