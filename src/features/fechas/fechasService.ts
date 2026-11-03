import { supabase } from '../../lib/supabase';
import type { Configuracion } from './configuracionFechaModelo';

export type EstadoFecha =
  | 'borrador'
  | 'inscripciones'
  | 'en_curso'
  | 'finalizada'
  | 'archivada';

export type Fecha = {
  id: string;
  competencia_id: string;
  fase_inicial: "octavos" | "dieciseisavos" | null;
  por_cruce: number | null;
  cupos: number | null;
  clasis_modo: "automaticas" | "siempre" | null;
  grupos_clasi: number | null;
  maximo_tanda: number | null;
  llave_fija: boolean | null;
  configuracion_version: number;
  nombre: string;
  fecha_evento: string | null;
  integrantes_por_equipo: number;
  jurados_eliminatorias: 3 | 5;
  jurados_por_grupo_clasi: number;
  estado: EstadoFecha;
  creado_en: string;
};

export type NuevaFecha = Configuracion & {
  nombre: string;
  fecha_evento: string | null;
  integrantes_por_equipo: number;
  jurados_eliminatorias: 3 | 5;
  jurados_por_grupo_clasi: number;
};

export const columnas = `
  competencia_id, fase_inicial, por_cruce, cupos, clasis_modo, grupos_clasi, maximo_tanda, llave_fija, configuracion_version,
  id,
  nombre,
  fecha_evento,
  integrantes_por_equipo,
  jurados_eliminatorias,
  jurados_por_grupo_clasi,
  estado,
  creado_en
`;

export async function listarFechas(competenciaId: string): Promise<Fecha[]> {
  const { data, error } = await supabase
    .from('fechas')
    .select(columnas)
    .eq('competencia_id', competenciaId)
    .is('eliminado_en', null)
    .order('creado_en', { ascending: false })
    .returns<Fecha[]>();

  if (error) throw error;

  return data ?? [];
}

export async function crearFecha(
  datos: NuevaFecha,
  competenciaId: string,
): Promise<Fecha> {
  const { data, error } = await supabase
    .from('fechas')
    .insert({
      ...datos,
      competencia_id: competenciaId,
      nombre: datos.nombre.trim(),
      estado: 'borrador',
    })
    .select(columnas)
    .single<Fecha>();

  if (error) throw error;

  return data;
}

export async function eliminarFecha(fechaId: string, competenciaId: string): Promise<void> {
  const { error } = await supabase.rpc('eliminar_fecha', {
    p_fecha_id: fechaId, p_competencia_id: competenciaId,
  });
  if (error) throw new Error(error.code === 'P0001' ? error.message :
    'No pudimos confirmar la eliminación. Actualizá el listado antes de reintentar. Comprobá que la migración 025 esté aplicada.');
}
