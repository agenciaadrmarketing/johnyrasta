import Link from 'next/link';
import type { PeriodoDoRelatorio } from '@/modules/reports/periodo';
import { BotaoImprimir } from '@/shared/ui/BotaoImprimir';

/**
 * Controles do relatório: trocar período, imprimir, exportar CSV. Some na
 * impressão. Os CSVs são as rotas que as abas já usam; a de eventos só
 * aceita 7, 30 ou 90 dias, por isso num período personalizado o link não é
 * oferecido — em vez de um arquivo com números diferentes dos da tela.
 */
export function BarraDoRelatorio({ periodo, sites, voltarPara }: { periodo: PeriodoDoRelatorio; sites: { id: string; nome: string }[]; voltarPara: string }) {
  return (
    <div className="nao-imprime" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-3)', alignItems: 'center' }}>
      <Link href={voltarPara} className="botao botao-pequeno">
        Alterar período ou alvo
      </Link>
      <BotaoImprimir />
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2)', alignItems: 'center', marginLeft: 'auto', fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>
        {sites.map((s) => (
          <span key={s.id} style={{ display: 'inline-flex', gap: 'var(--esp-2)', alignItems: 'center' }}>
            {sites.length > 1 && <span style={{ color: 'var(--tx3)' }}>{s.nome}:</span>}
            {periodo.diasPadrao !== null && (
              <a href={`/api/exportar/eventos?site=${s.id}&dias=${periodo.diasPadrao}`} className="botao botao-pequeno">
                CSV de eventos ({periodo.diasPadrao} dias)
              </a>
            )}
            <a href={`/api/exportar/contatos?site=${s.id}`} className="botao botao-pequeno" title="Todos os contatos do site, sem recorte de período">
              CSV de contatos (todos)
            </a>
          </span>
        ))}
      </span>
      {periodo.diasPadrao === null && (
        <p style={{ flexBasis: '100%', fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>
          O CSV de eventos cobre janelas de 7, 30 ou 90 dias contadas a partir de agora; para este período personalizado ele não é oferecido, porque os números não bateriam com os desta tela. O CSV de contatos lista todos os contatos do site, sem recorte de período.
        </p>
      )}
    </div>
  );
}
