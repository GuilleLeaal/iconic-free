import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Fecha } from './fechasService';
import type { Configuracion } from './configuracionFechaModelo';
import { Copy, Save, SlidersHorizontal, Trophy } from 'lucide-react';
export function CamposConfiguracion({ valor, onChange, actividad = false }: { valor: Configuracion; onChange: (c: Configuracion) => void; actividad?: boolean }) {
  const cambiar = (c: Partial<Configuracion>) => onChange({ ...valor, ...c });
  return <div className="campos-fecha">
    <label className="campo">Fase inicial<select disabled={actividad} value={valor.fase_inicial} onChange={e => cambiar({ fase_inicial: e.target.value as Configuracion['fase_inicial'] })}><option value="octavos">Octavos · 8 cruces</option><option value="dieciseisavos">Dieciseisavos · 16 cruces</option></select></label>
    <label className="campo">Primera fase<select value={valor.por_cruce} onChange={e => cambiar({ por_cruce: Number(e.target.value) })}><option value={2}>Duelos · 2 inscripciones</option><option value={3}>Triangulares · 3 inscripciones</option><option value={4}>Cuadrangulares · 4 inscripciones</option></select></label>
    <div className="formato-resumen"><span className="icono-formato"><Trophy size={20} /></span><p>Clasifican {(valor.fase_inicial === 'octavos' ? 8 : 16) * valor.por_cruce} inscripciones. Después de la primera fase continúan duelos.</p></div>
    <p className="texto-secundario campo-ancho">Clasificatorias solo si las inscripciones superan los cupos · grupos {valor.grupos_clasi ?? 'automáticos'} · tandas de hasta {valor.maximo_tanda} · {valor.llave_fija ? 'llave fija' : 'sorteo nuevo por fase'}.</p>
    <details className="acordeon campo-ancho"><summary><span>Configuración avanzada<small>Clasificatorias, grupos, tandas y avance entre fases</small></span></summary>
      <div className="campos-fecha contenido-acordeon">
      <p className="texto-secundario campo-ancho">Si hay más de {(valor.fase_inicial === 'octavos' ? 8 : 16) * valor.por_cruce} inscripciones, se realizan clasificatorias para seleccionar quiénes pasan a eliminatorias. Con esa cantidad o menos, pasan directamente.</p>
      <label className="campo">Grupos de clasis<select disabled={actividad} value={valor.grupos_clasi ?? ''} onChange={e => cambiar({ grupos_clasi: e.target.value ? Number(e.target.value) : null })}><option value="">Automáticos · hasta 3, según inscripciones</option>{[1, 2, 3].map(n => <option value={n} key={n}>{n} {n === 1 ? 'grupo' : 'grupos'}</option>)}</select></label>
      <label className="campo">Máximo por tanda<select disabled={actividad} value={valor.maximo_tanda} onChange={e => cambiar({ maximo_tanda: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6].map(n => <option value={n} key={n}>{n} inscripciones</option>)}</select></label>
      <label className="campo">Entre fases<select disabled={actividad} value={valor.llave_fija ? 'fija' : 'sorteo'} onChange={e => cambiar({ llave_fija: e.target.value === 'fija' })}><option value="sorteo">Sorteo nuevo por fase</option><option value="fija">Llave fija</option></select></label>
      <p className="texto-secundario">Todos los grupos necesitan la cantidad de jurados configurada. Las asignaciones se preparan antes de iniciar clasis.</p>
      </div>
    </details>
  </div>;
}
export default function ConfiguracionFecha({ fecha, onActualizar }: { fecha: Fecha; onActualizar: () => void }) {
  const [valor, setValor] = useState<Configuracion>({ fase_inicial: fecha.fase_inicial ?? 'octavos', por_cruce: fecha.por_cruce ?? 2, clasis_modo: fecha.clasis_modo ?? 'automaticas', grupos_clasi: fecha.grupos_clasi, maximo_tanda: fecha.maximo_tanda ?? 5, llave_fija: fecha.llave_fija ?? false });
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [solicitud] = useState(() => crypto.randomUUID());
  const [nombreCopia, setNombreCopia] = useState(`${fecha.nombre} — copia`);
  const [actividad, setActividad] = useState(false);
  const [cerrada, setCerrada] = useState(false);
  const [cantidad, setCantidad] = useState<number | null>(null);
  useEffect(() => {
    let vigente = true;
    void Promise.all([
      supabase.from('inscripciones').select('id', { count: 'exact', head: true }).eq('fecha_id', fecha.id).eq('activa', true),
      supabase.from('clasificatorias').select('estado').eq('fecha_id', fecha.id),
      supabase.from('sorteos').select('id').eq('fecha_id', fecha.id).eq('vigente', true).maybeSingle(),
    ]).then(async ([inscripciones, clasis, sorteo]) => {
      if (!vigente) return;
      setCantidad(inscripciones.count);
      setActividad((clasis.data?.length ?? 0) > 0);
      let manual = false;
      if (sorteo.data) {
        const { count } = await supabase.from('cruces_eliminatorias').select('id', { count: 'exact', head: true }).eq('sorteo_id', sorteo.data.id).eq('resolucion', 'manual');
        manual = (count ?? 0) > 0;
      }
      if (vigente) setCerrada(manual || clasis.data?.some(c => c.estado === 'finalizada') === true);
    });
    return () => { vigente = false; };
  }, [fecha.id]);
  async function guardar(regenerar = false) {
    setOcupado(true); setError(''); setAviso('');
    const { error } = await supabase.rpc('configurar_fecha', { p_fecha_id: fecha.id, p_configuracion: valor, p_version: fecha.configuracion_version, p_regenerar: regenerar });
    setOcupado(false);
    if (error) {
      if (!regenerar && error.message.includes('Confirmá su regeneración') && window.confirm(error.message)) { await guardar(true); return; }
      setError(error.message); return;
    }
    setAviso('Configuración guardada. Se conserva la actividad registrada.'); onActualizar();
  }
  return <section className="panel configuracion-formato"><div className="cabecera-seccion"><span className="icono-seccion"><SlidersHorizontal size={21} /></span><div><h2>Configuración de la fecha</h2><p className="texto-secundario">Formato, cupos y fases de competencia.</p></div></div>
    {!fecha.fase_inicial && <p className="texto-secundario">Fecha histórica: conserva su configuración anterior hasta que elijas y guardes una nueva explícitamente.</p>}
    <form onSubmit={e => { e.preventDefault(); void guardar(); }}><fieldset disabled={ocupado || cerrada || fecha.estado === 'finalizada' || fecha.estado === 'archivada'}>
      <CamposConfiguracion valor={valor} onChange={setValor} actividad={actividad} />
      {cantidad !== null && cantidad < (valor.fase_inicial === 'octavos' ? 8 : 16) * valor.por_cruce && <p className="aviso-formato">Hay {cantidad} inscripciones para {(valor.fase_inicial === 'octavos' ? 8 : 16) * valor.por_cruce} cupos. Podés cambiar el formato o conservarlo con pases libres.</p>}
      {actividad && <p className="aviso-formato">Durante clasis podés ajustar el tipo y cupos. Se conservan grupos, jurados, tandas y puntos.</p>}
      <div className="acciones-formulario"><button className="boton boton-principal"><Save size={17} />Guardar configuración</button></div>
    </fieldset></form>
    {cerrada && <p className="aviso-formato">El cierre de clasis o una batalla disputada bloquea el cambio de formato para conservar sus resultados.</p>}
    <details className="acordeon copiar-fecha"><summary><span>Reutilizar esta configuración<small>Creá otra fecha, sin copiar participantes ni resultados</small></span></summary><div className="contenido-acordeon">
    <label className="campo">Nombre de nueva fecha<input value={nombreCopia} onChange={e => setNombreCopia(e.target.value)} /></label>
    <button className="boton boton-secundario" disabled={ocupado || !nombreCopia.trim()} onClick={async () => {
      setOcupado(true); setError('');
      const { error } = await supabase.rpc('copiar_configuracion_fecha', { p_origen: fecha.id, p_nombre: nombreCopia, p_solicitud: solicitud });
      setOcupado(false); if (error) setError(error.message); else { setAviso('Nueva fecha creada con configuración y planillas.'); onActualizar(); }
    }}><Copy size={17} />Copiar configuración a una nueva fecha</button>
    </div></details>
    {error && <p className="mensaje-error" role="alert">{error}</p>}{aviso && <p role="status">{aviso}</p>}
  </section>;
}
