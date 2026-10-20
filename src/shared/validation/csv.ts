/** CSV com proteção contra fórmulas em planilhas (=, +, -, @, tab, CR). */
export function celulaCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function linhasCsv(cabecalho: string[], linhas: unknown[][]): string {
  const BOM = '﻿';
  return BOM + [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(',')).join('\r\n') + '\r\n';
}
