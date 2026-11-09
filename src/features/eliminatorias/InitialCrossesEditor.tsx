import { RefreshCw } from 'lucide-react';
import type { FilaRankingClasi } from '../clasificatorias/resultadosClasiService';
import type { InitialCross, InitialDrawMode } from './initialCrosses';
import '../clasificatorias/clasificatorias.css';
import '../clasificatorias/armados.css';

export default function InitialCrossesEditor({ mode, crosses, finalists, disabled, onMode, onChange, onShuffle, onFill }:
  { mode: InitialDrawMode; crosses: InitialCross[]; finalists: FilaRankingClasi[]; disabled: boolean;
    onMode: (mode: InitialDrawMode) => void; onChange: (crosses: InitialCross[]) => void;
    onShuffle: () => void; onFill: () => void }) {
  const assigned = crosses.flatMap(c => c.inscripciones).filter(Boolean).length;
  function assign(crossIndex: number, position: number, id: string) {
    const next = structuredClone(crosses);
    const previous = next[crossIndex].inscripciones[position];
    if (id) for (const c of next) {
      const index = c.inscripciones.indexOf(id);
      if (index >= 0) { c.inscripciones[index] = previous; break; }
    }
    next[crossIndex].inscripciones[position] = id || null;
    onChange(next);
  }
  return <fieldset className="manual-board armado-cruces" disabled={disabled}>
    <label className="campo">Armado de cruces<select value={mode} onChange={e => onMode(e.target.value as InitialDrawMode)}>
      <option value="sorteo">Por sorteo</option><option value="puntaje">Por puntaje · del mayor al menor</option><option value="manual">Manual</option>
    </select></label>
    {mode === 'puntaje' && <p className="texto-secundario">Los puntajes más altos se agrupan primero, en cruces consecutivos. Los empates conservan el orden de la tabla.</p>}
    {mode === 'manual' && <><p className="texto-secundario">Elegí quién ocupa cada lugar. Si elegís a alguien ya ubicado, se intercambian los lugares.</p>
      <button type="button" className="boton boton-secundario" onClick={onFill}>Completar por puntaje</button></>}
    {mode === 'sorteo' && <button type="button" className="boton boton-secundario acciones-armado" onClick={onShuffle}><RefreshCw size={16} />Sortear de nuevo</button>}
    <p role="status">{assigned}/{finalists.length} clasificados ubicados</p>
    <h4>Vista previa de los cruces</h4>
    <div className="grilla-tandas-clasi">{crosses.map((cross, crossIndex) => <article className="tanda-clasi" key={cross.numero}>
      <h4>Cruce {cross.numero}</h4>
      {mode === 'manual' ? cross.inscripciones.map((id, position) => <label className="campo" key={position}>Lugar {position + 1} del cruce {cross.numero}
        <select value={id ?? ''} onChange={e => assign(crossIndex, position, e.target.value)}><option value="">Lugar libre</option>
          {finalists.map(f => <option value={f.inscripcion_id} key={f.inscripcion_id}>{f.entrada.nombre} · {f.puntos} puntos</option>)}
        </select></label>) : <>
        {cross.inscripciones.filter(Boolean).map(id => { const f = finalists.find(f => f.inscripcion_id === id)!;
          return <p key={id}><strong>{f.entrada.nombre}</strong> · {f.puntos} puntos</p>;
        })}
        {cross.inscripciones.filter(Boolean).length === 0 && <p className="texto-secundario">Vacante</p>}
        {cross.inscripciones.filter(Boolean).length === 1 && <p className="texto-secundario">Pase libre</p>}
      </>}
    </article>)}</div>
  </fieldset>;
}
