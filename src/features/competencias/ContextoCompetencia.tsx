import { createContext, useContext } from 'react';

export type Competencia = { id: string; nombre: string; organizacion: boolean; jurado: boolean };
export const ContextoCompetencia = createContext<{ competencia: Competencia; usuarioId: string } | null>(null);
export function useCompetencia() {
  const contexto = useContext(ContextoCompetencia);
  if (!contexto) throw new Error('Elegí una competencia para continuar.');
  return contexto;
}
