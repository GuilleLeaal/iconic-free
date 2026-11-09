export type Configuracion = {
  fase_inicial: 'octavos' | 'dieciseisavos';
  por_cruce: number;
  clasis_modo: 'automaticas' | 'siempre';
  armado_clasis: 'sorteo' | 'manual';
  grupos_clasi: number | null;
  maximo_tanda: number;
  llave_fija: boolean;
};
export const predeterminada: Configuracion = {
  fase_inicial: 'octavos', por_cruce: 2, clasis_modo: 'automaticas', armado_clasis: 'sorteo',
  grupos_clasi: null, maximo_tanda: 5, llave_fija: false,
};
