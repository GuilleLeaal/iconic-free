import { supabase } from "../../lib/supabase";
import type { EntradaClasi } from "./clasificatoriasService";

export type FilaRankingClasi = {
  inscripcion_id: string;
  entrada: EntradaClasi;
  grupo: string;
  tanda: number;
  puesto: number | null;
  completa: boolean;
  sin_puntuar?: boolean;
  casillas_vacias?: boolean;
  puntos: number | null;
  jurados_esperados: number;
  jurados_finalizados: number;
  detalle_jurados: {
    jurado_id: string;
    nombre: string;
    estado: "sin_guardar" | "borrador" | "finalizada";
    total: number | null;
  }[];
};

export type RankingClasi = {
  clasificatoria_id: string;
  fecha_id: string;
  estado: "en_curso" | "finalizada";
  fecha_estado: string;
  clasifican: number;
  efectivos: number;
  puntuados: number;
  fase_inicial: string;
  casillas: string[];
  total: number;
  completos: number;
  lista_para_cerrar: boolean;
  jurados_consistentes: boolean;
  tandas_total: number;
  tandas_finalizadas: number;
  filas: FilaRankingClasi[];
  corte: {
    puntos: number | null;
    directos: string[];
    empatados: string[];
    cupos: number;
    requiere_desempate: boolean;
  };
  version: string;
  cierre: null | {
    clasificados: EntradaClasi[];
    ganadores_desempate: string[];
    nota_desempate: string | null;
    cerrado_en: string;
  };
};

export async function cargarResultadosClasi(
  fechaId: string,
): Promise<RankingClasi | null> {
  const sorteo = await supabase
    .from("sorteos")
    .select("id")
    .eq("fecha_id", fechaId)
    .eq("vigente", true)
    .maybeSingle<{ id: string }>();
  if (sorteo.error) throw new Error("No pudimos cargar el sorteo de la fecha.");
  if (!sorteo.data) return null;
  const clasi = await supabase
    .from("clasificatorias")
    .select("id")
    .eq("sorteo_id", sorteo.data.id)
    .maybeSingle<{ id: string }>();
  if (clasi.error) throw new Error("No pudimos cargar las clasificatorias.");
  if (!clasi.data) return null;
  const { data, error } = await supabase.rpc(
    "consultar_ranking_clasificatoria",
    {
      p_clasificatoria_id: clasi.data.id,
    },
  );
  if (error)
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No pudimos cargar la tabla global. Revisá que el SQL 014 esté aplicado.",
    );
  if (
    !data ||
    !Array.isArray(data.filas) ||
    typeof data.version !== "string" ||
    !data.corte
  ) {
    throw new Error(
      "No recibimos una tabla global válida. Actualizá para reintentar.",
    );
  }
  return data as RankingClasi;
}

export async function cerrarClasificatorias(
  ranking: RankingClasi,
  ganadores: string[],
  nota: string,
): Promise<void> {
  const { error } = await supabase.rpc(
    "cerrar_clasificatorias_y_sortear_octavos",
    {
      p_clasificatoria_id: ranking.clasificatoria_id,
      p_version: ranking.version,
      p_ganadores_desempate: ganadores,
      p_nota_desempate: nota.trim() || null,
    },
  );
  if (error)
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No pudimos confirmar el cierre. Actualizá para comprobar si quedó guardado antes de reintentar.",
    );
}
