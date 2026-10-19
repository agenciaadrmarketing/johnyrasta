import { redirect } from 'next/navigation';

/** A raiz só redireciona: a entrada da central é "Meus sites". */
export default function Raiz() {
  redirect('/sites');
}
