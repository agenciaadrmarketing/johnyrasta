import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSessao } from '@/modules/accounts/contexto';
import { encerrarOutrasSessoes } from '@/modules/accounts/acoes';
import { tokenAtualHash } from '@/modules/accounts/session';
import { estadoDoWorker, workerSemSinal } from '@/modules/portfolio/consultas';
import { semConta, verificarBanco } from '@/shared/db';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { dataHora, haQuantoTempo } from '@/shared/time/formato';
import { FormularioPerfil, FormularioSenha } from './formularios';

export const metadata: Metadata = { title: 'Configurações' };

type Sessao = { id: string; created_at: Date; last_seen_at: Date; expires_at: Date; user_agent: string | null; token_hash: string };

/**
 * Perfil, sessões, integrações e saúde do sistema. Cada integração mostra o
 * estado real: "não configurada" nunca vira "funcionando".
 */
export default async function PaginaConfiguracoes() {
  const u = await exigirSessao();
  const [banco, worker, sessoes, atual] = [
    await verificarBanco(),
    await estadoDoWorker(u.accountId),
    await semConta((db) => db.query<Sessao>('select * from app.list_sessions($1)', [u.userId])),
    await tokenAtualHash(),
  ];
  const workerAtrasado = worker ? workerSemSinal(worker.seenAt) : true;
  const pagespeed = !!process.env.PAGESPEED_API_KEY;
  const email = !!process.env.EMAIL_PROVIDER;

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
            <dt>PageSpeed (Google)</dt>
            <dd>{pagespeed ? <SeloEstado texto="Chave presente · medições na Fase 3" tom="soft" /> : <SeloEstado texto="Não configurado" tom="soft" />}</dd>
            <dt>E-mail de alertas</dt>
            <dd>{email ? <SeloEstado texto="Provedor configurado · entregas na Fase 5" tom="soft" /> : <SeloEstado texto="Não configurado · alertas só na central" tom="soft" />}</dd>
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
