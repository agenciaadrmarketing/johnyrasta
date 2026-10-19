'use client';

import { useActionState } from 'react';
import { criarSite, editarSite } from '@/modules/portfolio/acoes';
import { BotaoSubmeter, Campo, ESTADO_VAZIO, Retorno, Selecao, type EstadoFormulario } from '@/shared/ui/Formulario';
import { FUSOS, FUSO_PADRAO, PLATAFORMAS } from '@/shared/validation/site';
import type { Site } from '@/modules/portfolio/consultas';

export function FormularioSite({
  clientes,
  site,
  clienteInicial,
}: {
  clientes: { id: string; name: string }[];
  site?: Site;
  clienteInicial?: string;
}) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(site ? editarSite : criarSite, ESTADO_VAZIO);
  const c = estado.campos ?? {};
  return (
    <form action={acao} className="formulario">
      {site && <input type="hidden" name="id" value={site.id} />}
      <Selecao
        nome="cliente"
        rotulo="Cliente"
        erro={c.cliente}
        padrao={site?.clientId ?? clienteInicial ?? clientes[0]?.id}
        opcoes={clientes.map((cl) => ({ valor: cl.id, texto: cl.name }))}
      />
      <Campo nome="nome" rotulo="Nome do site" erro={c.nome} defaultValue={site?.name} placeholder="Ex.: Clínica Sol — site institucional" required maxLength={80} />
      <Campo
        nome="url"
        rotulo="Endereço principal"
        erro={c.url}
        dica="O domínio é extraído daqui. www. é o mesmo site; outro subdomínio é outro site."
        defaultValue={site?.primaryUrl}
        placeholder="https://www.cliente.com.br"
        required
        inputMode="url"
      />
      <div className="grade-campos">
        <Selecao nome="fuso" rotulo="Fuso horário do site" erro={c.fuso} padrao={site?.timezone ?? FUSO_PADRAO} opcoes={FUSOS.map((f) => ({ valor: f, texto: f }))} dica="Horários e dias da semana são agrupados neste fuso." />
        <Selecao nome="plataforma" rotulo="Plataforma" erro={c.plataforma} padrao={site?.platform ?? 'html'} opcoes={PLATAFORMAS.map((p) => ({ valor: p.valor, texto: p.texto }))} />
      </div>
      <label className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--esp-2)', color: 'var(--tx)' }}>
        <input type="checkbox" name="monitorar" value="1" defaultChecked={site ? (site.monitor?.enabled ?? false) : true} style={{ width: 18, height: 18 }} />
        Verificar disponibilidade a cada 5 minutos (worker)
      </label>
      <Campo nome="notas" rotulo="Notas (opcional)" defaultValue={site?.notes ?? ''} maxLength={2000} placeholder="Hospedagem, contato técnico, observações" />
      <Retorno estado={estado} />
      <div className="formulario-acoes">
        <BotaoSubmeter>{site ? 'Salvar alterações' : 'Cadastrar site'}</BotaoSubmeter>
      </div>
    </form>
  );
}
