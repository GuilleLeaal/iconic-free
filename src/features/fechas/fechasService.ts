import { supabase } from '../../lib/supabase';

export type EstadoFecha =
  | 'borrador'
  | 'inscripciones'
  | 'en_curso'
  | 'finalizada'
  | 'archivada';

export type Fecha = {
  id: string;
  nombre: string;
  fecha_evento: string | null;
  integrantes_por_equipo: number;
  jurados_eliminatorias: 3 | 5;
  jurados_por_grupo_clasi: number;
  estado: EstadoFecha;
  creado_en: string;
};

export type NuevaFecha = {
  nombre: string;
  fecha_evento: string | null;
  integrantes_por_equipo: number;
  jurados_eliminatorias: 3 | 5;
  jurados_por_grupo_clasi: number;
};

const columnas = `
  id,
  nombre,
  fecha_evento,
  integrantes_por_equipo,
  jurados_eliminatorias,
  jurados_por_grupo_clasi,
  estado,
  creado_en
`;

export async function listarFechas(): Promise<Fecha[]> {
  const { data, error } = await supabase
    .from('fechas')
    .select(columnas)
    .order('creado_en', { ascending: false })
    .returns<Fecha[]>();

  if (error) throw error;

  return data ?? [];
}

export async function crearFecha(
  datos: NuevaFecha,
): Promise<Fecha> {
  const { data, error } = await supabase
    .from('fechas')
    .insert({
      ...datos,
      nombre: datos.nombre.trim(),
      estado: 'borrador',
    })
    .select(columnas)
    .single<Fecha>();

  if (error) throw error;

  return data;
}