import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/modules/accounts/password';

describe('senha', () => {
  it('hash verifica e rejeita, e cada hash tem sal próprio', async () => {
    const a = await hashPassword('correta-123456');
    const b = await hashPassword('correta-123456');
    expect(a).not.toBe(b);
    expect(await verifyPassword('correta-123456', a)).toBe(true);
    expect(await verifyPassword('errada-123456', a)).toBe(false);
    expect(await verifyPassword('x', 'lixo')).toBe(false);
  });
});
