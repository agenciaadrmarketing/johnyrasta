/**
 * Regras puras das notificações: tipos conhecidos, destinatários e backoff.
 * Sem `server-only`: o worker e os testes de unidade importam daqui.
 */
import { emailValido } from '@/shared/validation/conta';

/** Tipos de alerta que podem ir por e-mail — os mesmos de `alerts.kind`. */
export const TIPOS_DE_ALERTA = [
  'incidente_confirmado',
  'incidente_recuperado',
  'tls_vencendo',
  'tls_falha',
  'verificacao_atrasada',
  'coletor_parado',
  'fila_parada',
  'regressao_pagespeed',
] as const;
export type TipoDeAlerta = (typeof TIPOS_DE_ALERTA)[number];

/**
 * Tipos OFERECIDOS na tela. `verificacao_atrasada` fica de fora: o worker a grava já
 * resolvida (D20) e o outbox só enfileira alertas abertos, então marcar essa caixa
 * prometeria um e-mail que nunca sai. O alerta continua na central.
 */
export const TIPOS_OFERECIDOS = TIPOS_DE_ALERTA.filter((k) => k !== 'verificacao_atrasada');

export const MAXIMO_DESTINATARIOS = 10;

export function tipoConhecido(v: string): v is TipoDeAlerta {
  return (TIPOS_DE_ALERTA as readonly string[]).includes(v);
}

/**
 * Um destinatário por linha (vírgula e ponto e vírgula também separam).
 * Minúsculas, sem repetição, cada um validado. Devolve os válidos E os
 * inválidos: o formulário mostra exatamente o que foi recusado.
 */
export function analisarDestinatarios(texto: string): { validos: string[]; invalidos: string[] } {
  const validos: string[] = [];
  const invalidos: string[] = [];
  const vistos = new Set<string>();
  for (const parte of texto.split(/[\n,;]+/)) {
    const e = parte.trim().toLowerCase();
    if (!e) continue;
    if (!emailValido(e)) {
      if (!invalidos.includes(e)) invalidos.push(e);
      continue;
    }
    if (vistos.has(e)) continue;
    vistos.add(e);
    validos.push(e);
  }
  return { validos, invalidos };
}

/**
 * Atraso antes da próxima tentativa de entrega, em ms: 1, 2, 4, 8, 16 min
 * (tentativa 1 → 1 min), com jitter de ±25% para dois workers não baterem
 * no provedor no mesmo instante. Teto de 16 min.
 */
export function atrasoDeReentrega(tentativa: number, aleatorio = Math.random()): number {
  const expoente = Math.max(0, Math.min(4, tentativa - 1));
  const base = 2 ** expoente * 60_000;
  return Math.round(base * (0.75 + aleatorio * 0.5));
}
