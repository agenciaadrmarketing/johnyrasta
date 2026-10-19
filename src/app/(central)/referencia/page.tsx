import type { Metadata } from 'next';
import Link from 'next/link';
import { exigirSessao } from '@/modules/accounts/contexto';
import { Cabecalho } from '@/shared/ui/Cabecalho';
import { Painel, Aviso } from '@/shared/ui/Painel';
import { SeloEstado } from '@/shared/ui/SeloEstado';
import { Etiqueta } from '@/shared/ui/Etiqueta';
import { EstadoVazio } from '@/shared/ui/EstadoVazio';
import { Sobrelinha } from '@/shared/ui/Sobrelinha';
import { Marca } from '@/shared/ui/Marca';
import { Avatar } from '@/shared/ui/Avatar';
import { Icone } from '@/shared/ui/icones';

export const metadata: Metadata = { title: 'Referência de componentes' };

const ESTADOS = [
  ['Online', 'ok'],
  ['Recuperado', 'ok'],
  ['Suspeita de falha', 'warn'],
  ['Verificação atrasada', 'warn'],
  ['Indisponível para o monitor', 'neg'],
  ['Nunca verificado', 'soft'],
  ['Em manutenção', 'soft'],
  ['Monitor pausado', 'soft'],
] as const;

function Amostras() {
  return (
    <>
      <div>
        <Sobrelinha>Marca e tipografia</Sobrelinha>
        <div className="amostra" style={{ marginTop: 'var(--esp-2)' }}>
          <div style={{ width: 220 }}>
            <Marca />
          </div>
          <Avatar nome="Johny Rasta" tamanho={32} />
          <h1 className="mono" style={{ fontWeight: 'var(--peso-leve)', fontSize: 'var(--tipo-display)', letterSpacing: 'var(--trilha-justa)' }}>
            Título display
          </h1>
          <span style={{ fontSize: 'var(--tipo-corpo)' }}>Corpo 14px</span>
          <span style={{ fontSize: 'var(--tipo-apoio)', color: 'var(--tx2)' }}>Apoio</span>
          <span style={{ fontSize: 'var(--tipo-legenda)', color: 'var(--tx3)' }}>Legenda</span>
        </div>
      </div>
      <div>
        <Sobrelinha>Botões</Sobrelinha>
        <div className="amostra" style={{ marginTop: 'var(--esp-2)' }}>
          <button type="button" className="botao botao-primario">
            Primário
          </button>
          <button type="button" className="botao">
            Secundário
          </button>
          <button type="button" className="botao botao-pequeno">
            Pequeno
          </button>
          <button type="button" className="botao botao-pequeno botao-perigo">
            Perigo
          </button>
          <button type="button" className="botao" disabled>
            Desabilitado
          </button>
          <Link href="#" className="filtro" aria-current="true">
            Filtro ativo <span className="filtro-contagem mono">3</span>
          </Link>
          <Link href="#" className="filtro">
            Filtro <span className="filtro-contagem mono">12</span>
          </Link>
        </div>
      </div>
      <div>
        <Sobrelinha>Estados do site (texto sempre)</Sobrelinha>
        <div className="amostra" style={{ marginTop: 'var(--esp-2)' }}>
          {ESTADOS.map(([t, tom]) => (
            <SeloEstado key={t} texto={t} tom={tom} />
          ))}
        </div>
      </div>
      <div>
        <Sobrelinha>Etiquetas e paleta de dados</Sobrelinha>
        <div className="amostra" style={{ marginTop: 'var(--esp-2)' }}>
          <Etiqueta texto="WhatsApp" tom="c1" />
          <Etiqueta texto="Formulário" tom="c2" />
          <Etiqueta texto="Telefone" tom="c3" />
          <Etiqueta texto="E-mail" tom="c4" />
          <Etiqueta texto="Neutra" tom="soft" />
        </div>
      </div>
      <div>
        <Sobrelinha>Campos</Sobrelinha>
        <div className="grade-campos" style={{ marginTop: 'var(--esp-2)' }}>
          <label className="campo">
            Campo
            <input defaultValue="valor" readOnly />
            <span className="campo-dica">Dica abaixo do campo.</span>
          </label>
          <label className="campo">
            Com erro
            <input defaultValue="inválido" aria-invalid="true" readOnly />
            <span className="campo-erro">Mensagem de erro.</span>
          </label>
          <label className="campo">
            Seleção
            <select defaultValue="a">
              <option value="a">Opção A</option>
              <option value="b">Opção B</option>
            </select>
          </label>
        </div>
      </div>
      <div>
        <Sobrelinha>Avisos</Sobrelinha>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-2)', marginTop: 'var(--esp-2)' }}>
          <Aviso>Neutro: informação de contexto.</Aviso>
          <Aviso tom="ok">Confirmado: operação concluída.</Aviso>
          <Aviso tom="warn">Atenção: algo depende de você.</Aviso>
          <Aviso tom="neg">Erro recuperável: tente de novo ou veja o log.</Aviso>
        </div>
      </div>
      <div>
        <Sobrelinha>Linha de projeto</Sobrelinha>
        <div className="lista-projetos" style={{ marginTop: 'var(--esp-2)' }}>
          <article className="linha-projeto">
            <span className="projeto-iniciais mono" aria-hidden="true">
              CS
            </span>
            <div className="projeto-corpo">
              <div className="projeto-titulo">
                <span className="projeto-nome">Clínica Sol</span>
                <span className="projeto-cliente">Dra. Ana</span>
                <span className="projeto-dominio mono">clinicasol.com.br</span>
              </div>
              <div className="projeto-situacao">
                <SeloEstado texto="Nunca verificado" tom="soft" />
                <span>sem checagem registrada</span>
                <span aria-hidden="true">·</span>
                <span>Ainda não há checagem registrada: sem evidência de disponibilidade.</span>
              </div>
            </div>
            <div className="projeto-acoes">
              <span className="botao botao-pequeno">
                <Icone nome="estrela" tamanho={14} />
              </span>
              <span className="botao botao-pequeno">Abrir projeto</span>
            </div>
          </article>
        </div>
      </div>
      <div>
        <Sobrelinha>Estados vazios</Sobrelinha>
        <div className="grade-dupla" style={{ marginTop: 'var(--esp-2)' }}>
          <EstadoVazio titulo="Vazio neutro" explicacao="Não há nada, e isso é normal." />
          <EstadoVazio tom="aguardando" kicker="aguardando" titulo="Aguardando primeira medição" explicacao="Esperado; ainda não chegou." />
          <EstadoVazio tom="erro" kicker="interrompido" titulo="Coleta parou" explicacao="Deveria estar chegando e parou." />
          <EstadoVazio tom="configurar" kicker="decisão pendente" titulo="Falta configurar" explicacao="Precisa de uma decisão sua." acao={{ rotulo: 'Configurar', href: '#' }} />
        </div>
      </div>
    </>
  );
}

/**
 * Referência interna: os componentes nos DOIS temas, lado a lado. Um bloco
 * recebe `data-tema` próprio, então a conferência não depende do botão.
 */
export default async function PaginaReferencia() {
  await exigirSessao();
  return (
    <>
      <Cabecalho kicker="Design system Matrix" titulo="Referência" meta="tokens de src/styles/theme.css · verificados por npm run design" />
      <div className="pagina">
        <Painel titulo="Tema escuro (padrão)">
          <div className="referencia-tema" data-tema="escuro">
            <Amostras />
          </div>
        </Painel>
        <Painel titulo="Tema claro">
          <div className="referencia-tema" data-tema="claro">
            <Amostras />
          </div>
        </Painel>
      </div>
    </>
  );
}
