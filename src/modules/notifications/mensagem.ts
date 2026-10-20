/**
 * Texto do e-mail de alerta e a decisão de publicar. Tudo puro, sem
 * `server-only`: o worker monta a mensagem aqui e os testes de unidade
 * conferem cada tipo.
 *
 * Regra de tom: dizer só o que o monitor observou. "Falha confirmada em duas
 * checagens" e "o instante exato da queda não é conhecido" são afirmações
 * verdadeiras; "o site ficou fora do ar por 50 minutos" não é.
 */
import { dataHora } from '@/shared/time/formato';

export type AlertaParaMensagem = {
  kind: string;
  title: string;
  details: Record<string, unknown>;
  siteId: string | null;
  siteNome: string | null;
  siteDomain: string | null;
  createdAt: Date;
  /** Fuso IANA do site (ou o padrão da central quando não há site). */
  fuso: string;
  /** URL pública da central, sem barra final. `null` = não configurada. */
  urlDaCentral: string | null;
};

export type Mensagem = { assunto: string; corpo: string };

export type PrefsDaConta = { emailEnabled: boolean; recipients: string[]; kinds: string[] };
export type PrefDoSite = { emailEnabled: boolean } | null;

/**
 * Publica por e-mail? Conta com e-mail ligado, tipo na lista, ao menos um
 * destinatário e site não desligado. Alertas sem site (fila parada) seguem só
 * a conta. Sem linha de preferência do site = ligado.
 */
export function devePublicar(conta: PrefsDaConta | null, site: PrefDoSite, alerta: { kind: string; siteId: string | null }): boolean {
  if (!conta || !conta.emailEnabled) return false;
  if (conta.recipients.length === 0) return false;
  if (!conta.kinds.includes(alerta.kind)) return false;
  if (alerta.siteId !== null && site !== null && !site.emailEnabled) return false;
  return true;
}

/** Rótulos curtos das categorias de falha do verificador (mesmos nomes de `checks.error_category`). */
const CATEGORIA: Record<string, string> = {
  dns: 'o DNS não resolveu',
  bloqueado: 'o destino foi bloqueado pela política de rede',
  conexao: 'a conexão foi recusada ou interrompida',
  timeout: 'não houve resposta no prazo',
  tls: 'o certificado TLS falhou',
  http: 'o servidor respondeu com erro',
  redirecionamentos: 'houve redirecionamentos em excesso',
  tamanho: 'a resposta foi grande demais',
  desconhecido: 'a falha não foi classificada',
};

const ASSUNTO: Record<string, string> = {
  incidente_confirmado: 'indisponível para o monitor',
  incidente_recuperado: 'respondendo de novo',
  tls_vencendo: 'certificado próximo do vencimento',
  tls_falha: 'falha no certificado TLS',
  verificacao_atrasada: 'verificação ficou atrasada',
  coletor_parado: 'coleta de eventos interrompida',
  fila_parada: 'fila de medições do PageSpeed parada',
};

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}
function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function quando(v: unknown, fuso: string): string | null {
  const t = texto(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : dataHora(d, fuso);
}
function duracao(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

/** Caminho na central que leva à ação. */
export function caminhoNaCentral(kind: string, siteId: string | null): string {
  if (!siteId) return '/atencao';
  if (kind === 'coletor_parado') return `/sites/${siteId}/instalacao`;
  return `/sites/${siteId}/disponibilidade`;
}

export function montarMensagem(a: AlertaParaMensagem): Mensagem {
  const nome = a.siteNome ?? a.siteDomain ?? null;
  const alvo = a.siteDomain ?? a.siteNome ?? 'o site';
  const d = a.details ?? {};
  const assuntoBase = ASSUNTO[a.kind] ?? a.title;
  const assunto = `[JohnyWeb] ${nome ? `${nome}: ${assuntoBase}` : assuntoBase.charAt(0).toUpperCase() + assuntoBase.slice(1)}`;

  const horarios: string[] = [`Alerta gerado em ${dataHora(a.createdAt, a.fuso)}.`];
  let aconteceu: string;
  let fazer: string;

  switch (a.kind) {
    case 'incidente_confirmado': {
      const cat = texto(d.category);
      const http = numero(d.httpStatus);
      const motivo = cat ? CATEGORIA[cat] ?? cat : null;
      aconteceu =
        `O monitor não obteve resposta válida de ${alvo} em duas checagens seguidas; a falha está confirmada.` +
        (motivo ? ` Na última checagem, ${motivo}${http ? ` (HTTP ${http})` : ''}.` : '') +
        ' O instante exato da queda não é conhecido: o monitor observa a cada checagem.';
      const primeira = quando(d.firstFailureAt, a.fuso);
      const confirmada = quando(d.confirmedAt, a.fuso);
      if (primeira) horarios.push(`Primeira falha observada: ${primeira}.`);
      if (confirmada) horarios.push(`Confirmada na checagem de ${confirmada}.`);
      fazer =
        'Abra o endereço no navegador e confira hospedagem, domínio e certificado. Se for manutenção planejada, registre uma janela de manutenção na central: as checagens continuam e os alertas ficam suprimidos. Quando o site voltar a responder, a recuperação fica registrada na central (aba Disponibilidade e Atenção).';
      break;
    }
    case 'incidente_recuperado': {
      const primeira = quando(d.firstFailureAt, a.fuso);
      const voltou = quando(d.recoveredAt, a.fuso);
      const ms = numero(d.observedDurationMs);
      aconteceu = `${alvo} voltou a responder ao monitor. A primeira resposta válida depois da falha foi observada${voltou ? ` em ${voltou}` : ' agora'}.`;
      if (primeira) horarios.push(`Primeira falha observada: ${primeira}.`);
      if (voltou) horarios.push(`Primeira resposta válida: ${voltou}.`);
      if (ms !== null) horarios.push(`Duração observada entre as duas: ${duracao(ms)}. O período real pode ter começado antes da primeira falha observada.`);
      fazer = 'Confira se tudo voltou ao normal (formulários, área administrativa, certificado). O incidente fica registrado na aba Disponibilidade com os horários observados.';
      break;
    }
    case 'tls_vencendo': {
      const vence = quando(d.expiresAt, a.fuso);
      const faixa = numero(d.faixaDias);
      aconteceu = `O certificado TLS de ${alvo} vence${vence ? ` em ${vence}` : ' em breve'}${faixa !== null ? ` (${faixa} dias ou menos)` : ''}. Depois dessa data o navegador dos visitantes mostra aviso de segurança.`;
      fazer = 'Renove o certificado ou confira a renovação automática da hospedagem antes do vencimento. Depois de renovar, a próxima checagem registra a nova data; marque este aviso como resolvido em Atenção.';
      break;
    }
    case 'tls_falha': {
      const det = texto(d.detail);
      aconteceu = `O monitor não conseguiu validar o certificado TLS de ${alvo}${det ? `: ${det}` : ''}. Enquanto isso durar, o navegador dos visitantes mostra aviso de segurança e a disponibilidade não pode ser confirmada.`;
      fazer = 'Confira o certificado na hospedagem: vencido, cadeia incompleta ou nome diferente do domínio são as causas mais comuns.';
      break;
    }
    case 'verificacao_atrasada': {
      const ultima = quando(d.lastCheckAt, a.fuso);
      const retomada = quando(d.resumedAt, a.fuso);
      aconteceu = `O worker ficou sem verificar ${alvo} por mais tempo do que o intervalo configurado. Nesse período o estado do site não é conhecido.`;
      if (ultima) horarios.push(`Última checagem antes do atraso: ${ultima}.`);
      if (retomada) horarios.push(`Verificação retomada: ${retomada}.`);
      fazer = 'Isto é sobre o worker, não sobre o site. Confira em Configurações → Estado do funcionamento se o processo ficou parado ou sobrecarregado.';
      break;
    }
    case 'coletor_parado': {
      const media = numero(d.mediaDiaria);
      aconteceu = `${alvo} costumava registrar eventos${media !== null ? ` (média de ${Math.round(media)} por dia)` : ''} e não enviou nenhum nas últimas 24 h. Pode ser o coletor removido do site, um bloqueio no navegador ou simplesmente ausência de visitas; é uma suspeita, não uma prova.`;
      fazer = 'Abra o site, confira se o snippet do coletor continua instalado e use o teste de instalação na central para ver um evento chegar.';
      break;
    }
    case 'fila_parada': {
      const pend = numero(d.pendentes);
      aconteceu = `Há ${pend !== null ? pend : 'algumas'} ${pend === 1 ? 'medição devida' : 'medições devidas'} do PageSpeed há mais de 2 h e nenhuma concluída nesse período.`;
      fazer = 'Confira o log do worker e a cota da chave do PageSpeed no console do Google. Nenhuma nota é inventada enquanto a fila não anda.';
      break;
    }
    default: {
      aconteceu = a.title;
      fazer = 'Veja os detalhes na central.';
    }
  }

  const caminho = caminhoNaCentral(a.kind, a.siteId);
  const link = a.urlDaCentral ? `${a.urlDaCentral.replace(/\/+$/, '')}${caminho}` : `${caminho} (defina APP_URL no worker para receber o link completo)`;

  const corpo = [
    `${nome ? `${nome}${a.siteDomain && a.siteDomain !== nome ? ` (${a.siteDomain})` : ''}` : 'Central'} — ${assuntoBase}`,
    '',
    'O que aconteceu',
    aconteceu,
    '',
    `Horário observado (fuso ${a.fuso})`,
    ...horarios,
    '',
    'O que fazer',
    fazer,
    '',
    'Ver na central',
    link,
    '',
    '—',
    'Mensagem automática do JohnyWeb. Os alertas são gerados pelo worker a partir das checagens; os horários são os observados, não o instante exato do evento. Para mudar quem recebe ou que tipos chegam, use Configurações → Notificações.',
  ].join('\n');

  return { assunto, corpo };
}
