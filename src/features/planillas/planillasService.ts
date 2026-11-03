import { supabase } from "../../lib/supabase";

export type TipoPlanilla = "eliminatorias" | "clasificatorias";

export type PlanillaFecha = {
  id: string;
  fecha_id: string;
  tipo: TipoPlanilla;
  casillas: string[];
  version: number;
};

export async function obtenerPlanilla(
  fechaId: string,
  tipo: TipoPlanilla,
): Promise<PlanillaFecha | null> {
  const { data, error } = await supabase
    .from("planillas_fecha")
    .select("id, fecha_id, tipo, casillas, version")
    .eq("fecha_id", fechaId)
    .eq("tipo", tipo)
    .maybeSingle<PlanillaFecha>();

  if (error) {
    throw new Error("No pudimos cargar la configuración de la planilla.");
  }

  return data;
}

export async function guardarPlanilla(
  fechaId: string,
  tipo: TipoPlanilla,
  casillas: string[],
  version: number,
): Promise<void> {
  const { error } = await supabase.rpc("guardar_planilla_fecha", {
    p_fecha_id: fechaId,
    p_tipo: tipo,
    p_casillas: casillas,
    p_version: version,
  });

  if (error) {
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No pudimos confirmar el guardado. Actualizá la planilla para revisar su estado.",
    );
  }
}