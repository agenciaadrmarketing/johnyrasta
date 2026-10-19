/** Identifica a conta de demonstração. Nunca aparece numa conta real. */
export function FaixaDemo() {
  return (
    <div className="faixa-demo" role="status" data-testid="faixa-demo">
      <span className="mono">&gt;_</span>
      <span>
        <strong>Conta de demonstração.</strong> Os sites e clientes aqui são fictícios e identificados como tal. Nada aqui
        é medição real.
      </span>
    </div>
  );
}
