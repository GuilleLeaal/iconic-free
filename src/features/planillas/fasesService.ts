import { supabase } from "../../lib/supabase";

export type FaseEliminatoria =
  | "octavos"
  | "cuartos"
  | "semifinal"
  | "final";

export type RondaPlanilla = {
  nombre: string;
  casillas: string[];
};

export type ConfiguracionFase = {
  rondas: RondaPlanilla[];
  replica: RondaPlanilla[];
};

export type PlanillaFase = {
  id: string;
  fecha_id: string;
  fase: FaseEliminatoria;
  configuracion: ConfiguracionFase;
  version: number;
};

export async function obtenerPlanillaFase(
  fechaId: string,
  fase: FaseEliminatoria,
): Promise<PlanillaFase | null> {
  const { data, error } = await supabase
    .from("planillas_fases")
    .select("id, fecha_id, fase, configuracion, version")
    .eq("fecha_id", fechaId)
    .eq("fase", fase)
    .maybeSingle<PlanillaFase>();

  if (error) {
    throw new Error("No pudimos cargar la configuración de esta fase.");
  }

  return data;
}

export async function guardarPlanillaFase(
  fechaId: string,
  fase: FaseEliminatoria,
  configuracion: ConfiguracionFase,
  version: number,
): Promise<void> {
  const { error } = await supabase.rpc("guardar_planilla_fase", {
    p_fecha_id: fechaId,
    p_fase: fase,
    p_configuracion: configuracion,
    p_version: version,
  });

  if (error) {
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No pudimos confirmar el guardado. Actualizá esta fase para revisar su estado.",
    );
  }
}