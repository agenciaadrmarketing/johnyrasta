import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDoPg, tlsPara } from '../../src/shared/db/tls';
import { nomeDoPapel } from '../../scripts/db-setup';
import { avaliarUrl, mediana } from '../../scripts/supabase';

describe('TLS e configuração do pg', () => {
  it('local: sem TLS; remoto sem CA: cifrado e não verificado; remoto com CA: verificado', () => {
    expect(tlsPara('postgres://u:p@localhost:5432/x', {})).toBe(false);
    expect(tlsPara('postgres://u:p@aws-0-sa-east-1.pooler.supabase.com:5432/postgres', {})).toEqual({ rejectUnauthorized: false });
    expect(tlsPara('postgres://u:p@h.exemplo.com/x', { DATABASE_SSL_CA: 'CERT' })).toEqual({ rejectUnauthorized: true, ca: 'CERT' });
  });
  it('CA por arquivo (melhor para systemd)', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'ca-')), 'ca.crt');
    writeFileSync(f, 'CERT-DO-ARQUIVO');
    expect(tlsPara('postgres://u:p@h.exemplo.com/x', { DATABASE_SSL_CA_FILE: f })).toEqual({ rejectUnauthorized: true, ca: 'CERT-DO-ARQUIVO' });
  });
  it('remove sslmode da URL (no pg ele sobrepõe a opção ssl e exigiria a CA do sistema)', () => {
    const c = configDoPg('postgres://u:p@h.exemplo.com:6543/postgres?sslmode=require&application_name=x', {});
    expect(c.connectionString).not.toContain('sslmode');
    expect(c.connectionString).toContain('application_name=x');
    expect(c.ssl).toEqual({ rejectUnauthorized: false });
  });
});

describe('papéis no pooler do Supabase', () => {
  it('remove o sufixo .<ref> do usuário para obter o papel', () => {
    expect(nomeDoPapel('app_web.abcdref', 'abcdref')).toBe('app_web');
    expect(nomeDoPapel('app_web', 'abcdref')).toBe('app_web');
    expect(nomeDoPapel('app_web.abcdref', undefined)).toBe('app_web.abcdref');
  });
  it('avalia URL: modo transação, usuário sem ref, conexão direta (IPv6), sufixo ausente', () => {
    const t = (u: string, s?: string) => avaliarUrl(u, s).map((x) => `${x.nivel}:${x.texto}`).join(' | ');
    expect(t('postgres://postgres:p@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require')).toContain('bloqueio:No pooler do Supabase o usuário');
    expect(t('postgres://postgres.abc:p@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require', 'abc')).toContain('modo TRANSAÇÃO');
    expect(t('postgres://postgres.abc:p@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require', 'abc')).toContain('modo sessão');
    expect(t('postgres://postgres:p@db.abcdef.supabase.co:5432/postgres?sslmode=require')).toContain('IPv6');
    expect(t('postgres://postgres.abc:p@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require')).toContain('DB_ROLE_SUFFIX ausente');
  });
  it('mediana', () => { expect(mediana([5, 1, 3])).toBe(3); expect(mediana([1, 2, 3, 10])).toBe(2.5); });
});
