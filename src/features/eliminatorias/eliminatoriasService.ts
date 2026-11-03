import { supabase } from "../../lib/supabase";
import type { Fecha } from "../fechas/fechasService";

export type FaseEliminatoria = "octavos" | "cuartos" | "semifinal" | "final";

export type EntradaEliminatoria = {
  id: string;
  nombre: string;
  version: number;
  integrantes: string[];
};

export type CruceEliminatoria = {
  id: string;
  fecha_id: string;
  sorteo_id: string;
  fase: FaseEliminatoria;
  numero: number;
  entradas: EntradaEliminatoria[];
  listo: boolean;
  estado: "pendiente" | "resuelto" | "vacante";
  ganador_id: string | null;
  resolucion: "manual" | "automatica" | null;
  version: number;
};

type SorteoActual = {
  id: string;
  eliminatorias_aleatorias: boolean;
  plan: {
    tipo: "octavos" | "clasificatorias";
  };
};

export async function cargarEliminatorias(fechaId: string) {
  const [resultadoFecha, resultadoSorteo, resultadoCruces] = await Promise.all([
    supabase.from("fechas").select("*").eq("id", fechaId).single<Fecha>(),

    supabase
      .from("sorteos")
      .select("id, plan, eliminatorias_aleatorias")
      .eq("fecha_id", fechaId)
      .eq("vigente", true)
      .maybeSingle<SorteoActual>(),

    supabase
      .from("cruces_eliminatorias")
      .select(
        "id, fecha_id, sorteo_id, fase, numero, entradas, listo, estado, ganador_id, resolucion, version",
      )
      .eq("fecha_id", fechaId)
      .order("numero")
      .returns<CruceEliminatoria[]>(),
  ]);

  if (resultadoFecha.error || resultadoSorteo.error || resultadoCruces.error) {
    throw new Error("No pudimos cargar el estado de las eliminatorias.");
  }

  return {
    fecha: resultadoFecha.data,
    sorteo: resultadoSorteo.data,
    cruces: resultadoCruces.data ?? [],
  };
}

function mensajeError(error: { code?: string; message: string }): string {
  return error.code === "P0001"
    ? error.message
    : "No pudimos confirmar la operación. Revisá los cruces actualizados antes de reintentar.";
}

export async function iniciarEliminatorias(fechaId: string): Promise<void> {
  const { error } = await supabase.rpc("iniciar_eliminatorias", {
    p_fecha_id: fechaId,
  });

  if (error) throw new Error(mensajeError(error));
}

export async function confirmarGanador(
  cruce: CruceEliminatoria,
  ganadorId: string,
): Promise<void> {
  const { error } = await supabase.rpc("confirmar_ganador_cruce", {
    p_cruce_id: cruce.id,
    p_ganador_id: ganadorId,
    p_version: cruce.version,
  });

  if (error) throw new Error(mensajeError(error));
}

export async function sortearFaseEliminatoria(
  fechaId: string,
  fase: "cuartos" | "semifinal",
): Promise<void> {
  const { error } = await supabase.rpc("sortear_fase_eliminatoria", {
    p_fecha_id: fechaId,
    p_fase: fase,
  });

  if (error) throw new Error(mensajeError(error));
}

export async function deshacerResultado(
  cruce: CruceEliminatoria,
): Promise<void> {
  const { error } = await supabase.rpc("deshacer_resultado_cruce", {
    p_cruce_id: cruce.id,
    p_version: cruce.version,
  });

  if (error) throw new Error(mensajeError(error));
}