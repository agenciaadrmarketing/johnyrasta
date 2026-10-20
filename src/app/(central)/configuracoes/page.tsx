import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSessao } from '@/modules/accounts/contexto';
import { encerrarOutrasSessoes } from '@/modules/accounts/acoes';
import { tokenAtualHash } from '@/modules/accounts/session';
import { estadoDoWorker, workerSemSinal } from '@/modules/portfolio/consultas';
import { estadoDaFila, ROTULO_ALERTA } from '@/modules/monitoring/consultas';
import { estadoPageSpeed } from '@/modules/performance/consultas';
import { estadoDoProvedorDeEmail, preferenciasDeNotificacao, ROTULO_ENTREGA, ultimasEntregas } from '@/modules/notifications/consultas';
import { TIPOS_DE_ALERTA } from '@/modules/notifications/regras';
import { semConta, verificarBanco } from '@/shared/db';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Etiqueta } from '@/shared/ui/Etiqueta';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { dataHora, haQuantoTempo } from '@/shared/time/formato';
import { FormularioNotificacoes, FormularioPerfil, FormularioSenha } from './formularios';

export const metadata: Metadata = { title: 'Configurações' };

type Sessao = { id: string; created_at: Date; last_seen_at: Date; expires_at: Date; user_agent: string | null; token_hash: string };

/**
 * Perfil, sessões, integrações e saúde do sistema. Cada integração mostra o
 * estado real: "não configurada" nunca vira "funcionando".
 */
export default async function PaginaConfiguracoes() {
  const u = await exigirSessao();
  const [banco, worker, fila, ps, sessoes, atual, prefs, entregas, email] = [
    await verificarBanco(),
    await estadoDoWorker(u.accountId),
    await estadoDaFila(u.accountId),
    await estadoPageSpeed(u.accountId),
    await semConta((db) => db.query<Sessao>('select * from app.list_sessions($1)', [u.userId])),
    await tokenAtualHash(),
    await preferenciasDeNotificacao(u.accountId),
    await ultimasEntregas(u.accountId, 10),
    await estadoDoProvedorDeEmail(u.accountId),
  ];
  const workerAtrasado = worker ? workerSemSinal(worker.seenAt) : true;
  const pagespeed = !!process.env.PAGESPEED_API_KEY;
  const provedorApp = email.aplicacao.ativo ? email.aplicacao.provedor : null;
  // O worker é outro processo: só o heartbeat diz o que ELE leu do ambiente.
  const workerDiverge = email.worker !== null && email.worker.provedor !== provedorApp;
  const preferenciaSemProvedor = prefs.emailEnabled && !email.aplicacao.ativo;
  const tipos = TIPOS_DE_ALERTA.map((kind) => ({ kind, rotulo: ROTULO_ALERTA[kind] ?? kind }));
  const celula = { padding: '9px 10px', fontSize: 'var(--tipo-apoio)' } as const;
  const cabecalhoTabela = { textAlign: 'left', padding: '9px 10px', fontSize: 'var(--tipo-legenda)', color: 'var(--tx2)', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap' } as const;

  return (
    <>
      <Cabecalho kicker="Conta e sistema" titulo="Configurações" meta={u.accountName} />
      <div className="pagina">
        <Painel kicker="sistema" titulo="Estado do funcionamento" id="sistema" subtitulo="O que a central depende para medir alguma coisa.">
          <dl className="definicoes">
            <dt>Banco de dados</dt>
            <dd>
              {banco.ok ? <SeloEstado texto={`Conectado como ${banco.papel}`} tom="ok" /> : <SeloEstado texto="Sem conexão" tom="neg" titulo={banco.erro} />}
            </dd>
            <dt>Worker de verificações</dt>
            <dd style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2)', alignItems: 'center' }}>
              {!worker ? (
                <SeloEstado texto="Nunca visto" tom="warn" />
              ) : workerAtrasado ? (
                <SeloEstado texto={`Sem sinal ${haQuantoTempo(worker.seenAt)}`} tom="neg" />
              ) : (
                <SeloEstado texto={`Ativo · visto ${haQuantoTempo(worker.seenAt)}`} tom="ok" />
              )}
              {worker && (
                <span className="mono" style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>
                  {worker.workerId}
                  {worker.version ? ` · ${worker.version}` : ''}
                </span>
              )}
            </dd>
            <dt>Fila de verificações</dt>
            <dd style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2)', alignItems: 'center' }}>
              {fila.monitoresAtivos === 0 ? (
                <SeloEstado texto="Nenhum monitor ativo" tom="soft" />
              ) : fila.atrasados > 0 ? (
                <SeloEstado texto={`${fila.atrasados} de ${fila.monitoresAtivos} atrasados`} tom="neg" />
              ) : fila.devidos > 0 ? (
                <SeloEstado texto={`${fila.devidos} de ${fila.monitoresAtivos} aguardando o worker`} tom="warn" />
              ) : (
                <SeloEstado texto={`${fila.monitoresAtivos} monitores em dia`} tom="ok" />
              )}
              {fila.maisAntigoSegundos != null && fila.maisAntigoSegundos > 60 && (
                <span style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>mais antigo devido há {Math.round(fila.maisAntigoSegundos / 60)} min</span>
              )}
            </dd>
            <dt>PageSpeed (Google)</dt>
            <dd style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2)', alignItems: 'center' }}>
              {!pagespeed ? (
                <SeloEstado texto="Não configurado · sem chave" tom="soft" />
              ) : ps.atrasados > 0 ? (
                <SeloEstado texto={`Fila parada: ${ps.atrasados} medições devidas há mais de 2 h`} tom="neg" />
              ) : ps.urls === 0 ? (
                <SeloEstado texto="Chave presente · nenhuma URL escolhida" tom="soft" />
              ) : (
                <SeloEstado texto={`Ativo · ${ps.urls} URLs · ${ps.medicoes24h} medições em 24 h`} tom="ok" />
              )}
              {pagespeed && (ps.pendentes > 0 || ps.processando > 0 || ps.falhas24h > 0) && (
                <span style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>{ps.pendentes} na fila · {ps.processando} medindo · {ps.falhas24h} falhas em 24 h</span>
              )}
            </dd>
            <dt>E-mail de alertas</dt>
            <dd style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-2)', alignItems: 'center' }}>
              {email.aplicacao.ativo ? (
                <SeloEstado texto={email.aplicacao.descricao} tom={email.aplicacao.provedor === 'log' ? 'warn' : 'ok'} />
              ) : (
                <SeloEstado texto="Nenhum provedor configurado · alertas ficam só na central" tom="soft" titulo={email.aplicacao.motivo} />
              )}
              {preferenciaSemProvedor && <SeloEstado texto="Preferência salva; nada será enviado até configurar EMAIL_PROVIDER" tom="warn" />}
              {email.worker && (
                <span style={{ fontSize: 'var(--tipo-legenda)', color: workerDiverge ? 'var(--warn-tx)' : 'var(--tx3)' }}>
                  worker: {email.worker.provedor ? `provedor ${email.worker.provedor}` : 'sem provedor'} · {email.worker.pendentes} {email.worker.pendentes === 1 ? 'entrega pendente' : 'entregas pendentes'} · {email.worker.falhas24h} {email.worker.falhas24h === 1 ? 'falha' : 'falhas'} em 24 h
                  {workerDiverge && ' · diferente do ambiente da aplicação: quem envia é o worker'}
                </span>
              )}
            </dd>
          </dl>
          {(!worker || workerAtrasado) && (
            <div style={{ marginTop: 'var(--esp-3)' }}>
              <Aviso tom="warn">
                <span>
                  O worker é um processo separado da aplicação web, iniciado com <code className="mono">npm run worker</code>. Sem ele, nenhum site é
                  verificado e nenhum alerta é gerado. A central nunca inicia o worker por conta própria nem depende de uma aba aberta. Veja{' '}
                  <code className="mono">docs/OPERACAO.md</code>.
                </span>
              </Aviso>
            </div>
          )}
        </Painel>

        <Painel
          kicker="alertas"
          titulo="Notificações"
          id="notificacoes"
          subtitulo="Quem recebe e-mail quando o worker gera um alerta. Só alertas criados depois de salvar são enviados; os anteriores continuam em Atenção. Cada site pode ser desligado na própria aba Disponibilidade."
        >
          {preferenciaSemProvedor && (
            <div style={{ marginBottom: 'var(--esp-4)' }}>
              <Aviso tom="warn">
                <span>
                  <strong>Preferência salva; nada será enviado até configurar <code className="mono">EMAIL_PROVIDER</code>.</strong> Defina o provedor, a chave e o remetente
                  no ambiente do worker (veja <code className="mono">.env.example</code>). Até lá os alertas ficam só na central.
                </span>
              </Aviso>
            </div>
          )}
          <FormularioNotificacoes prefs={prefs} tipos={tipos} provedorAtivo={email.aplicacao.ativo} />

          <h3 style={{ fontSize: 'var(--tipo-corpo)', fontWeight: 'var(--peso-forte)', marginTop: 'var(--esp-6)', marginBottom: 'var(--esp-2)' }}>Últimas entregas</h3>
          {entregas.length === 0 ? (
            !email.aplicacao.ativo ? (
              <EstadoVazio tom="configurar" kicker="aguardando configuração" icone="caixa" titulo="Nenhuma entrega registrada" explicacao="Sem provedor configurado, o worker não enfileira nada. Configure EMAIL_PROVIDER no ambiente do worker para começar." />
            ) : !prefs.emailEnabled ? (
              <EstadoVazio tom="neutro" icone="caixa" titulo="E-mail desligado" explicacao="Ligue o envio acima e informe destinatários. Alertas gerados a partir daí passam a ser entregues." />
            ) : (
              <EstadoVazio tom="aguardando" kicker="aguardando o primeiro alerta" icone="relogio" titulo="Nenhuma entrega ainda" explicacao="A primeira sai quando o worker gerar um alerta de um dos tipos escolhidos. Nada é reenviado para o mesmo alerta." />
            )
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    {['Quando', 'Destinatário', 'Alerta', 'Estado', 'Tentativa', 'Detalhe'].map((h) => (
                      <th key={h} scope="col" style={cabecalhoTabela}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entregas.map((e) => (
                    <tr key={e.id} className="tabela-linha" style={{ borderBottom: '1px solid var(--rowbd)' }}>
                      <td style={{ ...celula, whiteSpace: 'nowrap' }}>{dataHora(e.sentAt ?? e.updatedAt)}</td>
                      <td style={celula} className="mono">{e.recipient}</td>
                      <td style={celula}>
                        {ROTULO_ALERTA[e.alertKind] ?? e.alertKind}
                        {e.siteNome && <span style={{ color: 'var(--tx3)' }}> · {e.siteNome}</span>}
                      </td>
                      <td style={celula}>
                        <Etiqueta texto={ROTULO_ENTREGA[e.state]} tom={e.state === 'enviado' ? 'ok' : e.state === 'falhou' ? 'neg' : e.state === 'pendente' ? 'warn' : 'soft'} />
                      </td>
                      <td style={celula} className="mono">{e.attempts} de {e.maxAttempts}</td>
                      <td style={{ ...celula, color: 'var(--tx3)' }}>
                        {e.state === 'enviado' ? `via ${e.provider ?? 'provedor'}` : e.state === 'pendente' ? (e.lastError ? `${e.lastError} · nova tentativa ${dataHora(e.nextAttemptAt)}` : 'aguardando o worker') : e.lastError ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Painel>

        <Painel kicker="perfil" titulo="Seus dados">
          <FormularioPerfil nome={u.name} email={u.email} />
        </Painel>

        <Painel kicker="segurança" titulo="Senha" subtitulo="Trocar a senha encerra as outras sessões.">
          <FormularioSenha />
        </Painel>

        <Painel
          kicker="segurança"
          titulo="Sessões ativas"
          subtitulo={`${sessoes.length} ${sessoes.length === 1 ? 'sessão' : 'sessões'}`}
          acoes={
            sessoes.length > 1 ? (
              <form action={encerrarOutrasSessoes}>
                <button type="submit" className="botao botao-pequeno botao-perigo">
                  Encerrar as outras sessões
                </button>
              </form>
            ) : undefined
          }
        >
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--esp-2)' }}>
            {sessoes.map((s) => (
              <li key={s.id} className="item-trabalho" data-tom="soft">
                <SeloEstado texto={s.token_hash === atual ? 'Esta sessão' : 'Outra sessão'} tom={s.token_hash === atual ? 'ok' : 'soft'} />
                <div className="item-trabalho-texto">
                  <span className="item-trabalho-titulo" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.user_agent || 'Navegador não identificado'}
                  </span>
                  <span className="item-trabalho-detalhe">
                    iniciada {dataHora(s.created_at)} · última atividade {haQuantoTempo(s.last_seen_at)} · expira {dataHora(s.expires_at)}
                  </span>
                </div>
                <span />
              </li>
            ))}
          </ul>
        </Painel>

        <Painel kicker="aparência" titulo="Tema e efeitos" subtitulo="Os controles ficam no cabeçalho de toda tela. A escolha persiste neste navegador e respeita a preferência de movimento reduzido do sistema.">
          <p style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>
            Página interna de referência dos componentes nos dois temas: <Link href="/referencia">/referencia</Link>.
          </p>
        </Painel>
      </div>
    </>
  );
}
