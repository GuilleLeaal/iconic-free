import { supabase } from "../../lib/supabase";
import type { TandaClasi } from "./clasificatoriasService";

export type PuntuacionClasi = {
  inscripcion_id: string;
  casillas: (number | null)[];
};

export type VotacionJurado = {
  id: string;
  tanda_id: string;
  jurado_id: string;
  puntuaciones: PuntuacionClasi[];
  estado: "borrador" | "finalizada";
  version: number;
};

export type GrupoJurado = {
  id: string;
  nombre: string;
  clasificatoria: {
    id: string;
    estado: "en_curso" | "finalizada";
    casillas: string[];
    fecha: {
      id: string;
      nombre: string;
      estado: string;
      integrantes_por_equipo: number;
      maximo_tanda: number | null;
    };
  };
};

export type GrupoJuradoConTanda = {
  grupo: GrupoJurado;
  tanda: TandaClasi | null;
  voto: VotacionJurado | null;
};

export type GrupoJuradoConTandas = {
  grupo: GrupoJurado;
  tandas: TandaClasi[];
  votos: VotacionJurado[];
};

export async function cargarGruposJurado(
  juradoId: string,
  competenciaId: string,
): Promise<GrupoJuradoConTandas[]> {
  const grupos: GrupoJurado[] = [];
  const tamanoPagina = 500;

  for (let desde = 0; ; desde += tamanoPagina) {
    const { data, error } = await supabase
      .from("grupos_clasificatorias")
      .select(
        `
        id,
        nombre,
        clasificatoria:clasificatorias!inner(
          id,
          estado,
          casillas,
          fecha:fechas!inner(id, nombre, estado, integrantes_por_equipo, maximo_tanda)
        )
      `,
      )
      .eq("clasificatoria.fecha.estado", "en_curso")
      .eq("clasificatoria.fecha.competencia_id", competenciaId)
      .order("id")
      .range(desde, desde + tamanoPagina - 1)
      .returns<GrupoJurado[]>();

    if (error) {
      throw new Error("No pudimos cargar tus grupos asignados.");
    }

    grupos.push(...(data ?? []));

    if (!data || data.length < tamanoPagina) break;
  }

  // Las políticas filtran los grupos asignados. La RPC obtiene tandas y
  // votos juntos y vuelve a verificar la asignación en el servidor.
  return Promise.all(
    grupos.map(async (grupo): Promise<GrupoJuradoConTandas> => {
      const { data, error } = await supabase.rpc("consultar_tandas_jurado", {
        p_grupo_id: grupo.id,
      });
      if (
        error ||
        !data ||
        !Array.isArray(data.tandas) ||
        !Array.isArray(data.votos)
      ) {
        throw new Error("No pudimos cargar las tandas y tus planillas.");
      }
      const votos = data.votos as VotacionJurado[];
      if (votos.some((voto) => voto.jurado_id !== juradoId)) {
        throw new Error("Tu sesión cambió. Volvé a ingresar.");
      }
      return { grupo, tandas: data.tandas as TandaClasi[], votos };
    }),
  );
}

export async function guardarPuntuaciones(
  tandaId: string,
  puntuaciones: PuntuacionClasi[],
  version: number,
  finalizar: boolean,
): Promise<number> {
  const { data, error } = await supabase.rpc(
    "guardar_votacion_clasificatoria",
    {
      p_tanda_id: tandaId,
      p_puntuaciones: puntuaciones,
      p_version: version,
      p_finalizar: finalizar,
    },
  );

  if (error) {
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No pudimos confirmar el guardado. Actualizá antes de reintentar.",
    );
  }

  if (typeof data !== "number") {
    throw new Error("No recibimos la confirmación. Actualizá tu planilla.");
  }

  return data;
}
export type SolicitudAltaClasi = {
  solicitudId: string;
  grupoId: string;
  tandaId: string | null;
  nombre: string;
  integrantes: string[];
};

export async function retirarParticipanteClasi(tandaId: string, inscripcionId: string, version: number): Promise<void> {
  const { error } = await supabase.rpc('retirar_participante_clasi', {
    p_tanda_id: tandaId,
    p_inscripcion_id: inscripcionId,
    p_version: version,
  });
  if (error) throw new Error(error.code === 'P0001' ? error.message : 'No pudimos confirmar el retiro. Actualizá antes de reintentar.');
}

export type ResultadoAltaClasi = {
  inscripcion_id: string;
  tanda_id: string;
  numero: number;
};

export class ErrorAltaClasi extends Error {
  readonly incierto: boolean;
  constructor(mensaje: string, incierto: boolean) {
    super(mensaje);
    this.incierto = incierto;
  }
}

export async function agregarParticipanteClasi(
  solicitud: SolicitudAltaClasi,
): Promise<ResultadoAltaClasi> {
  const { data, error } = await supabase.rpc("agregar_participante_clasi", {
    p_grupo_id: solicitud.grupoId,
    p_tanda_id: solicitud.tandaId,
    p_nombre: solicitud.nombre.trim(),
    p_integrantes: solicitud.integrantes.map((alias) => alias.trim()),
    p_solicitud_id: solicitud.solicitudId,
  });
  if (error) {
    throw new ErrorAltaClasi(
      error.code === "P0001"
        ? error.message
        : "No recibimos confirmación. Reintentá esta misma solicitud para comprobar el alta.",
      error.code !== "P0001",
    );
  }
  if (
    !data ||
    typeof data.inscripcion_id !== "string" ||
    typeof data.tanda_id !== "string" ||
    !Number.isInteger(data.numero)
  ) {
    throw new ErrorAltaClasi(
      "No recibimos confirmación. Reintentá esta misma solicitud.",
      true,
    );
  }
  return data as ResultadoAltaClasi;
}
