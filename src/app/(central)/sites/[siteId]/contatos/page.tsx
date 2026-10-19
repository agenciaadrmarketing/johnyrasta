import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { exigirSessao } from '@/modules/accounts/contexto';
import { buscarSite } from '@/modules/portfolio/consultas';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';

export const metadata: Metadata = { title: 'Contatos' };

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
        icone="mensagem"
        titulo="Contatos recebidos, origem da evidência e exportação"
        explicacao="Na Fase 4 o site envia formulários para o endpoint da central ou confirma por integração assinada. Cada contato mostrará de onde veio a evidência."
      />
    </div>
  );
}
