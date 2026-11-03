import { supabase } from "../../lib/supabase";

export type EntradaSorteo = {
  id: string;
  nombre: string;
  version: number;
  integrantes: string[];
};

export type CruceSorteo = {
  numero: number;
  inscripciones: EntradaSorteo[];
};

export type GrupoClasi = {
  nombre: string;
  total: number;
  tandas: CruceSorteo[];
};

export type Sorteo = {
  id: string;
  fecha_id: string;
  vigente: boolean;
  creado_en: string;
  plan: {
    version_algoritmo: number;
    tipo: "dieciseisavos" | "octavos" | "clasificatorias";
    total: number;
    integrantes_por_equipo: number;
    clasifican?: number;
    cruces?: CruceSorteo[];
    grupos?: GrupoClasi[];
  };
};

function mensajeError(error: { code?: string; message: string }) {
  return error.code === "P0001"
    ? error.message
    : "No pudimos confirmar la operación. Actualizá el sorteo antes de reintentar.";
}

export async function obtenerSorteo(fechaId: string): Promise<Sorteo | null> {
  const { data, error } = await supabase
    .from("sorteos")
    .select("id, fecha_id, vigente, creado_en, plan")
    .eq("fecha_id", fechaId)
    .eq("vigente", true)
    .maybeSingle<Sorteo>();

  if (error) throw new Error(mensajeError(error));

  return data;
}

export async function generarSorteo(fechaId: string): Promise<Sorteo> {
  const { data, error } = await supabase.rpc("generar_sorteo", {
    p_fecha_id: fechaId,
  });

  if (error) {
    throw new Error(mensajeError(error));
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("No recibimos el sorteo. Actualizá la pantalla.");
  }

  return data as Sorteo;
}

export async function deshacerSorteo(id: string): Promise<void> {
  const { error } = await supabase.rpc("deshacer_sorteo", {
    p_id: id,
  });

  if (error) throw new Error(mensajeError(error));
}
