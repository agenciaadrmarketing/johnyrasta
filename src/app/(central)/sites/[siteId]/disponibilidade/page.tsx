import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';

export const metadata: Metadata = { title: 'Disponibilidade' };

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
        icone="relogio"
        titulo="Checagens, incidentes, recuperação e certificado TLS"
        explicacao="O worker da Fase 2 verifica a URL principal a cada 5 minutos com conexão segura, confirma falha em duas checagens seguidas e registra a recuperação. Até lá, não há evidência de disponibilidade."
      />
    </div>
  );
}
