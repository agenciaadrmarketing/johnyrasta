import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number, o: { N: number; maxmem: number }) => Promise<Buffer>;

// N=2^15: ~100 ms por hash. Caro para força bruta, barato para um login.
// Exige mais que os 32 MB padrão do Node (N·r·128 = 33,5 MB): `maxmem` sobe.
const N = 2 ** 15;
const MAXMEM = 64 * 1024 * 1024;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const SENHA_MINIMA = 10;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(plain, salt, KEY_LENGTH, { N, maxmem: MAXMEM });
  return `scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, n, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(plain, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), maxmem: MAXMEM });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
