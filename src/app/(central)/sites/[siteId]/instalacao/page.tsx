import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';

export const metadata: Metadata = { title: 'Instalação' };

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
        icone="verificar"
        titulo="Script, formulários, consentimento e prova de funcionamento"
        explicacao="Na Fase 4 a central gera instruções para HTML, React/Next e WordPress e confirma a instalação por um evento de teste isolado."
      />
    </div>
  );
}
