/**
 * Regras puras de cadastro de site. Sem `server-only`: o cliente monta o
 * formulário com as mesmas listas, e o servidor valida com as mesmas funções.
 */

export const PLATAFORMAS = [
  { valor: 'html', texto: 'HTML estático' },
  { valor: 'wordpress', texto: 'WordPress' },
  { valor: 'react', texto: 'React (SPA)' },
  { valor: 'next', texto: 'Next.js' },
  { valor: 'framer', texto: 'Framer' },
  { valor: 'webflow', texto: 'Webflow' },
  { valor: 'wix', texto: 'Wix' },
  { valor: 'shopify', texto: 'Shopify' },
  { valor: 'outro', texto: 'Outra' },
] as const;

export type Plataforma = (typeof PLATAFORMAS)[number]['valor'];

export function plataformaValida(v: string): v is Plataforma {
  return PLATAFORMAS.some((p) => p.valor === v);
}

/**
 * Fusos oferecidos. Lista curta de propósito: cobre o Brasil real sem virar
 * um seletor de 400 itens. Quem chega por outro caminho é validado por
 * `fusoValido`, porque o valor vai para `at time zone` em consultas.
 */
export const FUSOS = [
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Belem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'America/Noronha',
  'Europe/Lisbon',
  'Europe/Madrid',
  'America/New_York',
  'UTC',
] as const;
export type Fuso = (typeof FUSOS)[number];
export const FUSO_PADRAO: Fuso = 'America/Sao_Paulo';

export function fusoValido(valor: string): valor is Fuso {
  return (FUSOS as readonly string[]).includes(valor);
}

export type UrlNormalizada = { ok: true; url: string; domain: string } | { ok: false; erro: string };

/**
 * Normaliza a URL principal do site e extrai o domínio.
 *
 * Política de subdomínio: `www.` é o mesmo site e some; qualquer outro
 * subdomínio é um site distinto. Só HTTP/HTTPS, sem credenciais, sem porta
 * fora do padrão, sem IP (um site entregue tem nome). A validação de destino
 * PRIVADO (SSRF) é do verificador da Fase 2, não daqui: aqui o que se garante
 * é a forma.
 */
export function normalizarUrlDoSite(entrada: string): UrlNormalizada {
  let texto = entrada.trim();
  if (!texto) return { ok: false, erro: 'Informe o endereço do site.' };
  if (!/^[a-z]+:\/\//i.test(texto)) texto = `https://${texto}`;
  let u: URL;
  try {
    u = new URL(texto);
  } catch {
    return { ok: false, erro: 'Endereço inválido. Exemplo: https://www.cliente.com.br' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, erro: 'Só endereços http ou https.' };
  if (u.username || u.password) return { ok: false, erro: 'O endereço não pode conter usuário ou senha.' };
  if (u.port) return { ok: false, erro: 'Use o endereço sem porta.' };
  const host = u.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return { ok: false, erro: 'Use o nome do site, não um IP.' };
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    return { ok: false, erro: 'Domínio inválido. Exemplo: cliente.com.br' };
  }
  const domain = host.replace(/^www\./, '');
  u.hash = '';
  u.search = '';
  u.hostname = host;
  const url = u.toString();
  return { ok: true, url, domain };
}

export type ErrosDeSite = Partial<Record<'nome' | 'url' | 'fuso' | 'plataforma' | 'cliente', string>>;

export function validarSite(campos: {
  nome: string;
  url: string;
  fuso: string;
  plataforma: string;
  clienteId: string;
}): { ok: true; valor: { nome: string; url: string; domain: string; fuso: Fuso; plataforma: Plataforma; clienteId: string } } | { ok: false; erros: ErrosDeSite } {
  const erros: ErrosDeSite = {};
  const nome = campos.nome.trim();
  if (nome.length < 2 || nome.length > 80) erros.nome = 'Nome entre 2 e 80 caracteres.';
  const url = normalizarUrlDoSite(campos.url);
  if (!url.ok) erros.url = url.erro;
  if (!fusoValido(campos.fuso)) erros.fuso = 'Fuso horário desconhecido. Escolha um da lista.';
  if (!plataformaValida(campos.plataforma)) erros.plataforma = 'Plataforma desconhecida.';
  if (!/^[0-9a-f-]{36}$/i.test(campos.clienteId)) erros.cliente = 'Escolha o cliente.';
  if (Object.keys(erros).length > 0 || !url.ok) return { ok: false, erros };
  return {
    ok: true,
    valor: {
      nome,
      url: url.url,
      domain: url.domain,
      fuso: campos.fuso as Fuso,
      plataforma: campos.plataforma as Plataforma,
      clienteId: campos.clienteId,
    },
  };
}

export function validarCliente(campos: { nome: string; notas: string }): { ok: true; valor: { nome: string; notas: string | null } } | { ok: false; erros: { nome?: string; notas?: string } } {
  const nome = campos.nome.trim();
  const notas = campos.notas.trim();
  const erros: { nome?: string; notas?: string } = {};
  if (nome.length < 2 || nome.length > 80) erros.nome = 'Nome entre 2 e 80 caracteres.';
  if (notas.length > 2000) erros.notas = 'Notas até 2000 caracteres.';
  if (Object.keys(erros).length > 0) return { ok: false, erros };
  return { ok: true, valor: { nome, notas: notas || null } };
}

/** Iniciais para o ladrilho do projeto: "Clínica Sol" → "CS"; "acme.com.br" → "AC". */
export function iniciaisDoSite(nome: string): string {
  const partes = nome.trim().split(/[\s.-]+/).filter(Boolean);
  if (partes.length >= 2) return (partes[0]![0]! + partes[1]![0]!).toUpperCase();
  return (partes[0] ?? '·').slice(0, 2).toUpperCase();
}
