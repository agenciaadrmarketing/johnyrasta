/** Formatação de datas e tempos relativos, em português, no fuso informado. */

export function dataHora(valor: Date | string, fuso = 'America/Sao_Paulo'): string {
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function data(valor: Date | string, fuso = 'America/Sao_Paulo'): string {
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** "há 3 minutos", "há 2 horas", "há 5 dias". Nunca "agora" para o que tem mais de um minuto. */
export function haQuantoTempo(valor: Date | string, agora: Date = new Date()): string {
  const d = typeof valor === 'string' ? new Date(valor) : valor;
  const seg = Math.max(0, Math.round((agora.getTime() - d.getTime()) / 1000));
  if (seg < 60) return 'há menos de um minuto';
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  const dias = Math.round(h / 24);
  if (dias < 30) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  const meses = Math.round(dias / 30);
  return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
}
