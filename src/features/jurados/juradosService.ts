import { supabase } from "../../lib/supabase";

export type ApartadoJurado =
  | "eliminatorias"
  | "clasi_a"
  | "clasi_b"
  | "clasi_c";

export type JuradoDisponible = {
  id: string;
  nombre: string;
};

export type AsignacionJurado = {
  id: string;
  fecha_id: string;
  jurado_id: string;
  apartado: ApartadoJurado;
};

const TAMANO_PAGINA = 500;

export async function listarJurados(): Promise<JuradoDisponible[]> {
  const resultado: JuradoDisponible[] = [];

  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data, error } = await supabase
      .from("perfiles")
      .select("id, nombre")
      .eq("rol", "jurado")
      .order("nombre")
      .order("id")
      .range(desde, desde + TAMANO_PAGINA - 1)
      .returns<JuradoDisponible[]>();

    if (error) {
      throw new Error("No pudimos cargar las cuentas de jurado.");
    }

    resultado.push(...(data ?? []));

    if (!data || data.length < TAMANO_PAGINA) break;
  }

  return resultado;
}

export async function listarAsignaciones(
  fechaId: string,
): Promise<AsignacionJurado[]> {
  const resultado: AsignacionJurado[] = [];

  for (let desde = 0; ; desde += TAMANO_PAGINA) {
    const { data, error } = await supabase
      .from("jurados_fecha")
      .select("id, fecha_id, jurado_id, apartado")
      .eq("fecha_id", fechaId)
      .order("creado_en")
      .order("id")
      .range(desde, desde + TAMANO_PAGINA - 1)
      .returns<AsignacionJurado[]>();

    if (error) {
      throw new Error("No pudimos cargar las asignaciones de jurados.");
    }

    resultado.push(...(data ?? []));

    if (!data || data.length < TAMANO_PAGINA) break;
  }

  return resultado;
}

export async function configurarJurado(
  fechaId: string,
  juradoId: string,
  apartado: ApartadoJurado,
  asignar: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("configurar_jurado_fecha", {
    p_fecha_id: fechaId,
    p_jurado_id: juradoId,
    p_apartado: apartado,
    p_asignar: asignar,
  });

  if (error) {
    throw new Error(
      error.code === "P0001"
        ? error.message
        : "No pudimos confirmar el cambio. Revisá las asignaciones actualizadas antes de reintentar.",
    );
  }
}