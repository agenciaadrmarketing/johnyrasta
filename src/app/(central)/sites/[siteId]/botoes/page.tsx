import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';

export const metadata: Metadata = { title: 'Botões e horários' };

/** Fase 1: a aba existe e diz o que falta. Nenhum dado é simulado. */
export default async function Pagina({ params }: { params: Promise<{ siteId: string }> }) {
  const u = await exigirSessao();
  const { siteId } = await params;
  const site = await buscarSite(u.accountId, u.userId, siteId);
  if (!site) notFound();
  return (
    <div className="pagina">
      <EstadoVazio
        tom="aguardando"
        kicker="aguardando configuração"
        icone="cursor"
        titulo="Cliques por botão, página e posição; ações por hora e dia da semana"
        explicacao="Na Fase 4 o coletor registra visitas e cliques sem ler campos de formulário. Horários são agrupados no fuso deste site."
      />
    </div>
  );
}
