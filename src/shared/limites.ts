/**
 * Limites de requisição em memória (por instância). Protege contra abuso sem
 * derrubar a carteira inteira: a chave combina site e origem. Num deploy com
 * várias instâncias cada uma aplica o próprio limite — o teto efetivo é
 * N× o configurado, o que ainda cumpre o papel.
 */
const baldes = new Map<string, { tokens: number; atualizado: number }>();

export function permitir(chave: string, porMinuto: number, agora = Date.now()): boolean {
  const b = baldes.get(chave) ?? { tokens: porMinuto, atualizado: agora };
  const recarga = ((agora - b.atualizado) / 60_000) * porMinuto;
  b.tokens = Math.min(porMinuto, b.tokens + recarga);
  b.atualizado = agora;
  if (b.tokens < 1) {
    baldes.set(chave, b);
    return false;
  }
  b.tokens -= 1;
  baldes.set(chave, b);
  if (baldes.size > 50_000) baldes.clear();
  return true;
}

/** Lê o corpo com teto de bytes EFETIVO, sem confiar em Content-Length. */
export async function lerCorpoLimitado(req: Request, maxBytes: number): Promise<string | null> {
  const leitor = req.body?.getReader();
  if (!leitor) return '';
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await leitor.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(partes.map((p) => Buffer.from(p))));
}

export function ipDaRequisicao(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'desconhecido';
}
