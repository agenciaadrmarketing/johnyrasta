import { exigirSessao } from '@/modules/accounts/contexto';
import { sair } from '@/modules/accounts/acoes';
import { contagensDoMenu, listarSites } from '@/modules/portfolio/consultas';
import { MenuLateral } from '@/shared/ui/MenuLateral';
import { FaixaDemo } from '@/shared/ui/FaixaDemo';

/**
 * Casca autenticada. Só monta o menu; cada tela resolve o próprio contexto a
 * partir da URL, para não existir estado que fique fora de sincronia com a rota.
 */
export default async function LayoutCentral({ children }: { children: React.ReactNode }) {
  const usuario = await exigirSessao();
  const contagens = await contagensDoMenu(usuario.accountId);
  const sites = await listarSites(usuario.accountId, usuario.userId, { filtro: 'atencao' });
  return (
    <div className="casca-painel">
      <MenuLateral
        contagens={{ ...contagens, atencao: sites.length }}
        contaNome={usuario.accountName}
        usuarioNome={usuario.name}
        sair={sair}
      />
      <main className="conteudo-painel">
        {usuario.isDemo && <FaixaDemo />}
        {children}
      </main>
    </div>
  );
}
