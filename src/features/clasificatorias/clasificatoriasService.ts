import { supabase } from "../../lib/supabase";
import type { Fecha } from "../fechas/fechasService";

export type EntradaClasi = {
  id: string;
  nombre: string;
  version: number;
  integrantes: string[];
};

export type Clasificatoria = {
  id: string;
  fecha_id: string;
  sorteo_id: string;
  estado: "en_curso" | "finalizada";
  casillas: string[];
  clasifican: number;
};

export type GrupoClasi = {
  id: string;
  clasificatoria_id: string;
  nombre: "A" | "B" | "C";
};

export type JuradoClasi = {
  grupo_id: string;
  jurado_id: string;
  nombre: string;
};

export type TandaClasi = {
  id: string;
  grupo_id: string;
  numero: number;
  entradas: EntradaClasi[];
  estado: "pendiente" | "en_curso" | "finalizada";
  version: number;
  participantes_bloqueados: boolean;
  retirados?: EntradaClasi[];
};

type SorteoClasi = {
  id: string;
  plan: {
    tipo: "dieciseisavos" | "octavos" | "clasificatorias";
    total: number;
    clasifican?: number;
    grupos?: { nombre: string; total: number }[];
  };
};

export type EstadoClasificatorias = {
  fecha: Fecha;
  sorteo: SorteoClasi | null;
  clasificatoria: Clasificatoria | null;
  grupos: GrupoClasi[];
  jurados: JuradoClasi[];
  tandas: TandaClasi[];
  votaciones: ResumenVotoClasi[];
};

async function listarTandas(grupoIds: string[]): Promise<TandaClasi[]> {
  const resultado: TandaClasi[] = [];
  const tamanoPagina = 500;

  for (let desde = 0; ; desde += tamanoPagina) {
    const { data, error } = await supabase
      .from("tandas_clasificatorias")
      .select(
        "id, grupo_id, numero, entradas, estado, version, participantes_bloqueados",
      )
      .in("grupo_id", grupoIds)
      .order("grupo_id")
      .order("numero")
      .order("id")
      .range(desde, desde + tamanoPagina - 1)
      .returns<TandaClasi[]>();

    if (error) {
      throw new Error("No pudimos cargar las tandas.");
    }

    resultado.push(...(data ?? []));

    if (!data || data.length < tamanoPagina) break;
  }

  return resultado;
}

async function listarResumenVotos(
  tandaIds: string[],
): Promise<ResumenVotoClasi[]> {
  const resultado: ResumenVotoClasi[] = [];

  // Cada tanda tiene como máximo cinco jurados.
  // Consultamos tandas en bloques para evitar URLs demasiado largas.
  for (let desde = 0; desde < tandaIds.length; desde += 100) {
    const bloque = tandaIds.slice(desde, desde + 100);

    const { data, error } = await supabase
      .from("votaciones_clasificatorias")
      .select("tanda_id, jurado_id, estado")
      .in("tanda_id", bloque)
      .order("id")
      .range(0, 499)
      .returns<ResumenVotoClasi[]>();

    if (error) {
      throw new Error("No pudimos cargar el estado de las votaciones.");
    }

    resultado.push(...(data ?? []));
  }

  return resultado;
}

export async function cargarClasificatorias(
  fechaId: string,
): Promise<EstadoClasificatorias> {
  const [resultadoFecha, resultadoSorteo] = await Promise.all([
    supabase.from("fechas").select("*").eq("id", fechaId).single<Fecha>(),

    supabase
      .from("sorteos")
      .select("id, plan")
      .eq("fecha_id", fechaId)
      .eq("vigente", true)
      .maybeSingle<SorteoClasi>(),
  ]);

  if (resultadoFecha.error || resultadoSorteo.error) {
    throw new Error("No pudimos cargar el estado de la fecha.");
  }

  const estado: EstadoClasificatorias = {
    fecha: resultadoFecha.data,
    sorteo: resultadoSorteo.data,
    clasificatoria: null,
    grupos: [],
    jurados: [],
    tandas: [],
    votaciones: [],
  };

  if (!estado.sorteo) return estado;

  const resultadoClasi = await supabase
    .from("clasificatorias")
    .select("id, fecha_id, sorteo_id, estado, casillas, clasifican")
    .eq("sorteo_id", estado.sorteo.id)
    .maybeSingle<Clasificatoria>();

  if (resultadoClasi.error) {
    throw new Error("No pudimos cargar la clasificatoria.");
  }

  estado.clasificatoria = resultadoClasi.data;

  if (!estado.clasificatoria) return estado;

  const resultadoGrupos = await supabase
    .from("grupos_clasificatorias")
    .select("id, clasificatoria_id, nombre")
    .eq("clasificatoria_id", estado.clasificatoria.id)
    .order("nombre")
    .returns<GrupoClasi[]>();

  if (resultadoGrupos.error) {
    throw new Error("No pudimos cargar los grupos.");
  }

  estado.grupos = resultadoGrupos.data ?? [];

  if (estado.grupos.length === 0) {
    throw new Error("La clasificatoria iniciada no tiene grupos.");
  }

  const grupoIds = estado.grupos.map((grupo) => grupo.id);

  const [resultadoJurados, tandas] = await Promise.all([
    supabase
      .from("jurados_clasificatorias")
      .select("grupo_id, jurado_id, nombre")
      .in("grupo_id", grupoIds)
      .order("nombre")
      .returns<JuradoClasi[]>(),

    listarTandas(grupoIds),
  ]);

  if (resultadoJurados.error) {
    throw new Error("No pudimos cargar los jurados de los grupos.");
  }

  estado.jurados = resultadoJurados.data ?? [];
  estado.tandas = tandas;
  estado.votaciones = await listarResumenVotos(tandas.map((tanda) => tanda.id));

  return estado;
}

export async function iniciarClasificatorias(fechaId: string): Promise<void> {
  const { error } = await supabase.rpc("iniciar_clasificatorias", {
    p_fecha_id: fechaId,
  });

  if (error) {
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No pudimos confirmar el inicio. Actualizá la pantalla antes de reintentar.",
    );
  }
}

export type ResumenVotoClasi = {
  tanda_id: string;
  jurado_id: string;
  estado: "borrador" | "finalizada";
};
