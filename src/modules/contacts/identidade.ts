/**
 * Normalização de identificadores de contato. Puro.
 *
 * E-mail: minúsculas, espaços fora. Telefone: só dígitos, com país explícito
 * (padrão do site) quando faltar o DDI. Um telefone compartilhado não é
 * necessariamente uma pessoa — a reconciliação trata isso, não a normalização.
 */
export function normalizarEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? e : null;
}

const DDI: Record<string, string> = { BR: '55', PT: '351', US: '1', ES: '34', AR: '54' };

export function normalizarTelefone(v: unknown, pais = 'BR'): string | null {
  if (typeof v !== 'string') return null;
  const bruto = v.trim();
  if (!bruto) return null;
  const internacional = bruto.startsWith('+') || bruto.startsWith('00');
  let d = bruto.replace(/\D/g, '');
  if (bruto.startsWith('00')) d = d.slice(2);
  if (!internacional) {
    // Remove zero de operadora e prefixa o DDI do país do site.
    d = d.replace(/^0+/, '');
    const ddi = DDI[pais] ?? DDI.BR!;
    // Já veio com o DDI do país (ex.: "55 11 9…" digitado sem +): não duplica.
    const jaTemDdi = d.startsWith(ddi) && d.length >= ddi.length + 10;
    if (!jaTemDdi) d = ddi + d;
  }
  if (d.length < 8 || d.length > 15) return null;
  // Brasil: celular tem 11 dígitos nacionais (DDD + 9 dígitos); fixo 10.
  if (d.startsWith('55') && !(d.length === 12 || d.length === 13)) return null;
  return `+${d}`;
}

export type CamposDeContato = { name?: string | null; email?: string | null; phone?: string | null; message?: string | null; [k: string]: unknown };

/** Mantém só os campos permitidos; mensagem só quando ativada. Tamanhos limitados. */
export function filtrarCampos(entrada: Record<string, unknown>, permitidos: readonly string[], comMensagem: boolean): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const k of permitidos) {
    if (k === 'message' && !comMensagem) continue;
    const v = entrada[k];
    if (typeof v === 'string' && v.trim()) saida[k] = v.trim().slice(0, k === 'message' ? 2000 : 200);
  }
  if (comMensagem && typeof entrada.message === 'string' && entrada.message.trim() && permitidos.includes('message')) saida.message = entrada.message.trim().slice(0, 2000);
  return saida;
}

/** Validade mínima: ao menos UM contato válido. Nome é opcional (newsletter legítima). */
export function identificadores(campos: Record<string, string>, pais: string): { email: string | null; phone: string | null; valido: boolean } {
  const email = normalizarEmail(campos.email);
  const phone = normalizarTelefone(campos.phone, pais);
  return { email, phone, valido: !!(email || phone) };
}
