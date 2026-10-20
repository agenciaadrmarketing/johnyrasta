/**
 * Executa a central no notebook, acessível pelo celular na MESMA rede (Wi-Fi), só para desenvolvimento.
 *
 *   npm run lan          build de produção + `next start` (recomendado: é o que se mede e testa)
 *   npm run lan -- --sem-build      reaproveita o último `npm run build`
 *   npm run lan -- --ip 192.168.0.15   usa este IP (vários adaptadores, VPN, Docker)
 *   npm run lan:dev      `next dev` com recarga automática (mais lento; não serve para medir tempos)
 *
 * O worker NÃO sobe aqui: rode `npm run worker` em OUTRO terminal. Ctrl+C encerra a web.
 *
 * APP_URL é definido SÓ para este processo (o .env.local não é alterado) como http://<IP da rede>:<porta>.
 * Esse endereço http:// em rede privada é a única condição em que a versão de produção aceita cookie sem
 * `Secure`, sem HSTS e sem `upgrade-insecure-requests` (src/shared/ambiente.ts). Com APP_URL https:// ou
 * host público, nada disso é afrouxado.
 */
import { spawn, spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { loadEnv } from './env';
import { hostEhRedeLocal } from '../src/shared/ambiente';

const require = createRequire(import.meta.url);

export function enderecosDaRede(interfaces = networkInterfaces()): { nome: string; ip: string }[] {
  const out: { nome: string; ip: string }[] = [];
  for (const [nome, lista] of Object.entries(interfaces)) {
    for (const i of lista ?? []) {
      if (i.family === 'IPv4' && !i.internal && hostEhRedeLocal(i.address)) out.push({ nome, ip: i.address });
    }
  }
  // Wi-Fi/Ethernet domésticos primeiro (192.168.x), depois 10.x, depois o resto.
  const peso = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return out.sort((a, b) => peso(a.ip) - peso(b.ip));
}

function main() {
  loadEnv();
  const dev = process.argv.includes('--dev');
  const porta = Number(process.env.PORT ?? 3000);
  // --ip <endereço>: escolhe o IP à mão (VPN, Docker, várias placas). Precisa ser de rede privada/local.
  const iIp = process.argv.indexOf('--ip');
  const forcado = iIp >= 0 ? process.argv[iIp + 1] : undefined;
  if (forcado !== undefined && !hostEhRedeLocal(forcado)) {
    console.error(`--ip ${forcado} não é um endereço de rede privada/local; recusado (o modo HTTP local não vale para endereços públicos).`);
    process.exit(1);
  }
  const enderecos = forcado ? [{ nome: 'escolhido (--ip)', ip: forcado }] : enderecosDaRede();
  if (!enderecos.length) {
    console.error('Nenhuma rede privada encontrada. Conecte o notebook ao Wi-Fi/cabo e tente de novo (o celular precisa estar na mesma rede).');
    process.exit(1);
  }
  const principal = enderecos[0]!.ip;
  const appUrl = `http://${principal}:${porta}`;
  const env: NodeJS.ProcessEnv = { ...process.env, APP_URL: appUrl, PORT: String(porta) };
  if (dev) env.DEV_ORIGENS_PERMITIDAS = enderecos.map((e) => e.ip).join(',');
  else (env as Record<string, string | undefined>).NODE_ENV = 'production';
  const nextBin = require.resolve('next/dist/bin/next');

  if (!dev && !process.argv.includes('--sem-build')) {
    console.log('· build de produção (pode levar 1–2 min)…');
    const b = spawnSync(process.execPath, [nextBin, 'build'], { stdio: 'inherit', env });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }

  console.log('');
  console.log(`  Notebook:  http://localhost:${porta}`);
  for (const e of enderecos) console.log(`  Celular:   http://${e.ip}:${porta}   (${e.nome}${e === enderecos[0] ? ' — usado como APP_URL' : ''})`);
  console.log('');
  console.log('  O celular precisa estar no MESMO Wi-Fi do notebook. Use só rede de casa/confiável: a porta fica aberta à rede.');
  console.log('  Worker (checagens, PageSpeed, e-mail): outro terminal → npm run worker');
  console.log('  Encerrar: Ctrl+C aqui (e no terminal do worker). Com o notebook/processo desligado, nada roda.');
  console.log('');

  const filho = spawn(process.execPath, [nextBin, dev ? 'dev' : 'start', '-H', '0.0.0.0', '-p', String(porta)], { stdio: 'inherit', env });
  const encerrar = () => { filho.kill('SIGTERM'); };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
  filho.on('exit', (codigo) => process.exit(codigo ?? 0));
}

if (process.argv[1]?.endsWith('lan.ts')) main();
