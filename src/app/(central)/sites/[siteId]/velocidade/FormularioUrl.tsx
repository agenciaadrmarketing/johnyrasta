'use client';

import { useActionState } from 'react';
import { adicionarUrl } from '@/modules/performance/acoes';
import { BotaoSubmeter, Campo, ESTADO_VAZIO, Retorno, type EstadoFormulario } from '@/shared/ui/Formulario';

export function FormularioUrl({ siteId, dominio }: { siteId: string; dominio: string }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(adicionarUrl, ESTADO_VAZIO);
  return (
    <form action={acao} className="formulario">
      <input type="hidden" name="site" value={siteId} />
      <Campo nome="url" rotulo="URL prioritária" erro={estado.campos?.url} placeholder={`https://www.${dominio}/pagina`} dica={`Precisa ser do domínio ${dominio}. Até 3 por site.`} required inputMode="url" />
      <fieldset style={{ border: 'none', display: 'flex', gap: 'var(--esp-4)', flexWrap: 'wrap' }}>
        <legend className="campo-dica" style={{ marginBottom: 'var(--esp-1)' }}>Dispositivos (séries separadas, nunca média)</legend>
        <label style={{ display: 'inline-flex', gap: 'var(--esp-2)', alignItems: 'center' }}><input type="checkbox" name="dev_mobile" value="1" defaultChecked /> Mobile</label>
        <label style={{ display: 'inline-flex', gap: 'var(--esp-2)', alignItems: 'center' }}><input type="checkbox" name="dev_desktop" value="1" defaultChecked /> Desktop</label>
        {estado.campos?.devices && <span className="campo-erro">{estado.campos.devices}</span>}
      </fieldset>
      <Retorno estado={estado} />
      <div className="formulario-acoes"><BotaoSubmeter ocupado="Adicionando…">Adicionar URL</BotaoSubmeter></div>
    </form>
  );
}
