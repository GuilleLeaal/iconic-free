import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, enlaceAcceso } from '../lib/supabase';

type Perfil = {
  id: string;
  nombre: string;
};

type ResultadoPerfil = {
  usuarioId: string;
  perfil: Perfil | null;
  error: string | null;
};

export function useAuth() {
  const [requierePassword, setRequierePassword] = useState(enlaceAcceso);
  const [session, setSession] = useState<Session | null>(null);
  const [sesionCargada, setSesionCargada] = useState(false);
  const [resultadoPerfil, setResultadoPerfil] =
    useState<ResultadoPerfil | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(
      (_event, nuevaSesion) => {
        if (_event === 'PASSWORD_RECOVERY') setRequierePassword(true);
        if (_event === 'SIGNED_OUT') setRequierePassword(false);
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
          .select('id, nombre')
          .eq('id', usuarioId!)
          .single();

        if (error) throw error;

        if (!data) {
          throw new Error('Perfil inválido.');
        }

        if (!cancelado) {
          setResultadoPerfil({
            usuarioId: usuarioId!,
            perfil: {
              id: data.id,
              nombre: data.nombre,
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
    requierePassword,
    terminarAcceso: () => setRequierePassword(false),
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
