import Link from 'next/link';
import { TelaDeErro } from '@/shared/ui/TelaDeErro';
import { estiloAcao } from '@/shared/ui/estilosDeErro';

/**
 * 404. Também é a resposta a quem tenta abrir, pela URL, um registro de OUTRA
 * conta: dizer "403, existe mas não é seu" confirmaria a existência.
 */
export default function NaoEncontrado() {
  return (
    <TelaDeErro
      codigo="404"
      titulo="Esta tela não existe aqui"
      descricao="O endereço não corresponde a nenhuma tela da central — ou aponta para um registro que não pertence à sua conta."
      acoes={
        <>
          <Link href="/sites" style={estiloAcao(true)}>
            Ir para Meus sites
          </Link>
          <Link href="/atencao" style={estiloAcao(false)}>
            Ver Atenção
          </Link>
        </>
      }
    />
  );
}
