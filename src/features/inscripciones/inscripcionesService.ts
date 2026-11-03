import { supabase } from "../../lib/supabase";

export type Integrante = {
  id: string;
  alias: string;
  orden: number;
};

export type Inscripcion = {
  id: string;
  fecha_id: string;
  nombre: string;
  activa: boolean;
  version: number;
  creado_en: string;
  integrantes: Integrante[];
};

export async function listarInscripciones(
  fechaId: string,
): Promise<Inscripcion[]> {
  const resultado: Inscripcion[] = [];
  const tamanioPagina = 500;

  for (let desde = 0; ; desde += tamanioPagina) {
    const { data, error } = await supabase
      .from("inscripciones")
      .select(
        `
        id,
        fecha_id,
        nombre,
        activa,
        version,
        creado_en,
        integrantes:inscripcion_integrantes (
          id,
          alias,
          orden
        )
      `,
      )
      .eq("fecha_id", fechaId)
      .order("creado_en", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, desde + tamanioPagina - 1)
      .returns<Inscripcion[]>();

    if (error) throw error;

    const pagina = data ?? [];

    resultado.push(
      ...pagina.map((inscripcion) => ({
        ...inscripcion,
        integrantes: [...inscripcion.integrantes].sort(
          (a, b) => a.orden - b.orden,
        ),
      })),
    );

    if (pagina.length < tamanioPagina) break;
  }

  return resultado;
}

export async function anotarInscripcion(
  fechaId: string,
  nombre: string,
  integrantes: string[],
): Promise<string> {
  const { data, error } = await supabase.rpc("crear_inscripcion", {
    p_fecha_id: fechaId,
    p_nombre: nombre.trim(),
    p_integrantes: integrantes.map((alias) => alias.trim()),
  });

  if (error) {
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No pudimos confirmar el guardado. Actualizá el listado antes de reintentar.",
    );
  }

  if (typeof data !== "string") {
    throw new Error(
      "No recibimos la confirmación. Actualizá el listado antes de reintentar.",
    );
  }

  return data;
}

export async function modificarInscripcion(
  inscripcion: Inscripcion,
  accion: "editar" | "retirar" | "reactivar",
  nombre?: string,
  integrantes?: string[],
): Promise<void> {
  const { error } = await supabase.rpc("modificar_inscripcion", {
    p_id: inscripcion.id,
    p_version: inscripcion.version,
    p_accion: accion,
    p_nombre: nombre?.trim() ?? null,
    p_integrantes: integrantes?.map((alias) => alias.trim()) ?? null,
  });

  if (error) {
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No pudimos confirmar el cambio. Actualizá el listado antes de reintentar.",
    );
  }
}
