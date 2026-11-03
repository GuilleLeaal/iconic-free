import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type Perfil = {
  id: string;
  nombre: string;
  rol: 'organizacion' | 'jurado';
};

type ResultadoPerfil = {
  usuarioId: string;
  perfil: Perfil | null;
  error: string | null;
};

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [sesionCargada, setSesionCargada] = useState(false);
  const [resultadoPerfil, setResultadoPerfil] =
    useState<ResultadoPerfil | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(
      (_event, nuevaSesion) => {
        setSession(nuevaSesion);
        setSesionCargada(true);
      },
    );

    return () => data.subscription.unsubscribe();
  }, []);

  const usuarioId = session?.user.id;

  useEffect(() => {
    if (!usuarioId) return;

    let cancelado = false;

    async function cargarPerfil() {
      try {
        const { data, error } = await supabase
          .from('perfiles')
          .select('id, nombre, rol')
          .eq('id', usuarioId!)
          .single();

        if (error) throw error;

        if (
          !data ||
          (data.rol !== 'organizacion' && data.rol !== 'jurado')
        ) {
          throw new Error('Perfil inválido.');
        }

        if (!cancelado) {
          setResultadoPerfil({
            usuarioId: usuarioId!,
            perfil: {
              id: data.id,
              nombre: data.nombre,
              rol: data.rol,
            },
            error: null,
          });
        }
      } catch {
        if (!cancelado) {
          setResultadoPerfil({
            usuarioId: usuarioId!,
            perfil: null,
            error:
              'No pudimos cargar tu perfil. Revisá la conexión e intentá nuevamente.',
          });
        }
      }
    }

    void cargarPerfil();

    return () => {
      cancelado = true;
    };
  }, [usuarioId, intento]);

  const resultadoActual =
    resultadoPerfil?.usuarioId === usuarioId
      ? resultadoPerfil
      : null;

  function reintentarPerfil() {
    setResultadoPerfil(null);
    setIntento((actual) => actual + 1);
  }

  return {
    session,
    perfil: resultadoActual?.perfil ?? null,
    errorPerfil: resultadoActual?.error ?? null,
    cargando:
      !sesionCargada ||
      Boolean(
        usuarioId &&
          !resultadoActual?.perfil &&
          !resultadoActual?.error,
      ),
    reintentarPerfil,
  };
}