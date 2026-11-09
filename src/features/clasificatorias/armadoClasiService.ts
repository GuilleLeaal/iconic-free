import { supabase } from '../../lib/supabase';

export type ManualRound = { id: string; posiciones: (string | null)[] };
export type ManualGroup = { nombre: string; tandas: ManualRound[] };
export type ManualLayout = { version: number; grupos: ManualGroup[] };

function checkError(error: { code?: string; message: string } | null) {
  if (error) throw new Error(error.code === 'P0001' ? error.message :
    'No pudimos confirmar el cambio. Actualizá el armado antes de reintentar.');
}

export async function loadManualLayout(fechaId: string): Promise<ManualLayout> {
  const { data, error } = await supabase.from('armados_clasificatorias')
    .select('version, grupos').eq('fecha_id', fechaId).maybeSingle<ManualLayout>();
  checkError(error);
  return data ?? { version: 0, grupos: [] };
}

export async function saveManualLayout(fechaId: string, layout: ManualLayout, groups: ManualGroup[]): Promise<void> {
  const { error } = await supabase.rpc('guardar_armado_clasificatorias', {
    p_fecha_id: fechaId, p_version: layout.version, p_grupos: groups,
  });
  checkError(error);
}

export async function registerInRound(fechaId: string, version: number, roundId: string,
  position: number, name: string, members: string[], registrationId: string | null): Promise<void> {
  const { error } = await supabase.rpc('inscribir_en_ronda', {
    p_fecha_id: fechaId, p_version: version, p_tanda_id: roundId, p_posicion: position + 1,
    p_nombre: name.trim(), p_integrantes: members.map(a => a.trim()), p_inscripcion_id: registrationId,
  });
  checkError(error);
}
