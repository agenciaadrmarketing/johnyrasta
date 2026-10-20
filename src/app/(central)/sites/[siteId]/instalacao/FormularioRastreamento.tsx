'use client';

import { useActionState } from 'react';
import { salvarRastreamento } from '@/modules/analytics/acoes';
import { BotaoSubmeter, ESTADO_VAZIO, Retorno, type EstadoFormulario } from '@/shared/ui/Formulario';
import type { Rastreamento } from '@/modules/analytics/consultas';

const CAMPOS: { k: string; rotulo: string }[] = [
  { k: 'name', rotulo: 'Nome' }, { k: 'email', rotulo: 'E-mail' }, { k: 'phone', rotulo: 'Telefone' },
  { k: 'company', rotulo: 'Empresa' }, { k: 'subject', rotulo: 'Assunto' }, { k: 'message', rotulo: 'Mensagem (desligada por padrão)' },
];

export function FormularioRastreamento({ siteId, r }: { siteId: string; r: Rastreamento }) {
  const [estado, acao] = useActionState<EstadoFormulario, FormData>(salvarRastreamento, ESTADO_VAZIO);
  const cb = (name: string, rotulo: string, checked: boolean) => (
    <label key={name} style={{ display: 'inline-flex', gap: 'var(--esp-2)', alignItems: 'center', fontSize: 'var(--tipo-corpo)' }}>
      <input type="checkbox" name={name} value="1" defaultChecked={checked} /> {rotulo}
    </label>
  );
  return (
    <form action={acao} className="formulario" style={{ maxWidth: 'none' }}>
      <input type="hidden" name="site" value={siteId} />
      <fieldset style={{ border: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--esp-2)' }}>
        <legend className="campo-dica">O que medir</legend>
        {cb('pageviews', 'Visitas (page_view, inclusive rotas SPA)', r.collectPageviews)}
        {cb('clicks', 'Cliques em botões (data-track-id e detecção de WhatsApp, telefone e e-mail)', r.collectClicks)}
      </fieldset>
      <div className="grade-campos">
        <label className="campo">
          Formulários
          <select name="form_mode" defaultValue={r.formMode}>
            <option value="endpoint">Endpoint da central (o site posta aqui)</option>
            <option value="webhook">Destino original confirma por assinatura</option>
            <option value="auxiliar">Cópia auxiliar da tentativa (não prova entrega)</option>
            <option value="desligado">Não receber formulários</option>
          </select>
          <span className="campo-dica">Cada modo mostra a origem da evidência ao lado do contato.</span>
        </label>
        <label className="campo">
          Consentimento
          <select name="consent_mode" defaultValue={r.consentMode}>
            <option value="nenhum">Identificador do navegador desde o início</option>
            <option value="exigido">Só após o site chamar jw(&apos;consent&apos;)</option>
          </select>
          <span className="campo-dica">Receber um pedido de contato tem finalidade própria e não depende de aceitar analytics.</span>
        </label>
        <label className="campo">
          País padrão dos telefones
          <input name="pais" defaultValue={r.defaultCountry} maxLength={2} style={{ textTransform: 'uppercase' }} />
          <span className="campo-dica">Código ISO de duas letras. Usado quando o telefone vem sem DDI.</span>
        </label>
      </div>
      <fieldset style={{ border: 'none', display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-3) var(--esp-5)' }}>
        <legend className="campo-dica">Campos de formulário aceitos (o resto é descartado no servidor)</legend>
        {CAMPOS.map((c) => cb(`campo_${c.k}`, c.rotulo, r.allowedFields.includes(c.k)))}
      </fieldset>
      {cb('mensagem', 'Guardar o conteúdo da mensagem (evite em saúde e advocacia)', r.collectMessage)}
      <Retorno estado={estado} />
      <div className="formulario-acoes"><BotaoSubmeter>Salvar configuração</BotaoSubmeter></div>
    </form>
  );
}
