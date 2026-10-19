import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';

export const metadata: Metadata = { title: 'Velocidade' };

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
        icone="tendencia"
        titulo="Medições PageSpeed em mobile e desktop, com histórico"
        explicacao="Na Fase 3 você escolhe até 3 URLs prioritárias e configura a chave do Google. Sem chave, a integração aparece como não configurada — nunca como nota."
      />
    </div>
  );
}
