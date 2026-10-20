/**
 * Laços independentes do worker.
 *
 * Cada tarefa (disponibilidade, PageSpeed, e-mail, heartbeat, retenção) roda no
 * SEU laço, no SEU intervalo. Uma tarefa lenta (uma chamada ao PageSpeed pode
 * levar 90 s) não atrasa as outras; dentro de uma mesma tarefa as execuções
 * nunca se sobrepõem (a próxima só começa depois que a anterior terminou), e um
 * erro numa tarefa não derruba nem adia as demais. `parar()` não interrompe
 * trabalho em andamento: espera cada execução corrente terminar (encerramento
 * gracioso) e só então resolve.
 */
export type Tarefa = {
  nome: string;
  intervaloMs: number;
  executar: () => Promise<void>;
};

export type Agendador = { parar: () => Promise<void> };

export function iniciarAgendador(tarefas: Tarefa[], o: { aoErro: (nome: string, erro: unknown) => void }): Agendador {
  let parado = false;
  const acordar = new Set<() => void>();

  const dormir = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(fim, ms);
      function fim() {
        clearTimeout(t);
        acordar.delete(fim);
        resolve();
      }
      acordar.add(fim);
    });

  const laco = async (t: Tarefa) => {
    while (!parado) {
      const inicio = Date.now();
      try {
        await t.executar();
      } catch (e) {
        o.aoErro(t.nome, e);
      }
      if (parado) break;
      await dormir(Math.max(1, t.intervaloMs - (Date.now() - inicio)));
    }
  };

  const lacos = tarefas.map((t) => laco(t));
  return {
    async parar() {
      parado = true;
      for (const f of [...acordar]) f();
      await Promise.all(lacos);
    },
  };
}
