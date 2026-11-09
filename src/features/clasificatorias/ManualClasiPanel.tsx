import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { Fecha } from '../fechas/fechasService';
import { listarInscripciones, modificarInscripcion } from '../inscripciones/inscripcionesService';
import type { Inscripcion } from '../inscripciones/inscripcionesService';
import EditarInscripcion from '../inscripciones/EditarInscripcion';
import { loadManualLayout, registerInRound, saveManualLayout } from './armadoClasiService';
import type { ManualGroup, ManualLayout } from './armadoClasiService';
import '../inscripciones/inscripciones.css';
import './clasificatorias.css';
import './armados.css';

type Slot = { round: string; position: number; label: string };
const GROUP_NAMES = ['A', 'B', 'C'];

export default function ManualClasiPanel({ fecha, bloqueado, onContinue }: { fecha: Fecha; bloqueado: boolean; onContinue: () => void }) {
  const [layout, setLayout] = useState<ManualLayout>({ version: 0, grupos: [] });
  const [registrations, setRegistrations] = useState<Inscripcion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [editing, setEditing] = useState<Inscripcion | null>(null);
  const [moving, setMoving] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>(Array(fecha.integrantes_por_equipo).fill(''));
  const [returning, setReturning] = useState('');
  const busy = useRef(false);
  const limit = fecha.maximo_tanda ?? 5;
  const editable = !bloqueado && ['borrador', 'inscripciones'].includes(fecha.estado);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setLoadError('');
      try {
        const [data, entries] = await Promise.all([loadManualLayout(fecha.id), listarInscripciones(fecha.id)]);
        if (!cancelled) { setLayout(data); setRegistrations(entries); }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'No pudimos cargar el armado.');
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [fecha.id, attempt]);

  async function execute(operation: () => Promise<void>, message: string, onSuccess?: () => void) {
    if (busy.current || loading || loadError || !editable) return;
    busy.current = true; setSaving(true); setError(''); setNotice('');
    try { await operation(); setNotice(message); onSuccess?.(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No pudimos confirmar el cambio. Actualizá el armado.'); }
    finally { busy.current = false; setSaving(false); setAttempt(a => a + 1); }
  }

  function save(groups: ManualGroup[]) {
    void execute(() => saveManualLayout(fecha.id, layout, groups), 'Armado guardado.');
  }

  const slots: Slot[] = layout.grupos.flatMap(g => g.tandas.flatMap((t, i) =>
    t.posiciones.map((_, position) => ({ round: t.id, position, label: `Clasi ${g.nombre} · Ronda ${i + 1} · Lugar ${position + 1}` }))));
  const withdrawn = registrations.filter(i => !i.activa);

  function move(target: string) {
    const destination = slots.find(s => `${s.round}:${s.position}` === target);
    if (!moving || !destination) return;
    const groups = structuredClone(layout.grupos);
    const sourceRound = groups.flatMap(g => g.tandas).find(t => t.id === moving.round)!;
    const targetRound = groups.flatMap(g => g.tandas).find(t => t.id === destination.round)!;
    [sourceRound.posiciones[moving.position], targetRound.posiciones[destination.position]] =
      [targetRound.posiciones[destination.position], sourceRound.posiciones[moving.position]];
    void execute(() => saveManualLayout(fecha.id, layout, groups), 'Orden actualizado.', () => setMoving(null));
  }

  return <section className="panel inscripciones-panel manual-clasi-panel">
    <div className="cabecera-inscripciones"><div><h2>Inscripciones y clasis</h2>
      <p className="texto-secundario">Agregá rondas e inscribí a cada participante en el lugar que elijas.</p></div>
      <button type="button" className="boton boton-secundario" disabled={loading || saving || Boolean(editing)} onClick={() => setAttempt(a => a + 1)}><RefreshCw size={17} />Actualizar</button>
    </div>
    <p className="texto-secundario">Máximo de {limit} por ronda. Podés dejar lugares libres; las rondas vacías no generan planillas. Los cambios se guardan al realizarlos.</p>
    {!editable && <p className="aviso-formato">El armado está cerrado. Consultá las tandas y su avance en Clasificatorias.</p>}
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    {notice && <p className="mensaje-guardado" role="status">{notice}</p>}
    {loadError && <p className="mensaje-error" role="alert">{loadError}</p>}
    {editing && <EditarInscripcion key={editing.id} inscripcion={editing} esIndividual={fecha.integrantes_por_equipo === 1}
      onCancelar={() => setEditing(null)} onGuardada={() => { setEditing(null); setAttempt(a => a + 1); }} />}
    {slot && <form className="formulario-inscripcion" onSubmit={e => {
      e.preventDefault();
      void execute(() => registerInRound(fecha.id, layout.version, slot.round, slot.position, name, members, returning || null),
        'Participante inscripto en la ronda.', () => { setSlot(null); setName(''); setMembers(Array(fecha.integrantes_por_equipo).fill('')); setReturning(''); });
    }}>
      <h3>Inscribir · {slot.label}</h3>
      <fieldset disabled={saving || loading || !editable || Boolean(loadError)}>
        {withdrawn.length > 0 && <label className="campo">Participante<select value={returning} onChange={e => setReturning(e.target.value)}><option value="">Inscribir participante nuevo</option>{withdrawn.map(i => <option key={i.id} value={i.id}>Reincorporar a {i.nombre}</option>)}</select></label>}
        {!returning && <div className="campos-inscripcion">
          {fecha.integrantes_por_equipo > 1 && <label className="campo campo-ancho">Nombre del equipo (opcional)<input value={name} onChange={e => setName(e.target.value)} /></label>}
          {members.map((alias, index) => <label className="campo" key={index}>{members.length === 1 ? 'Alias' : `Alias del integrante ${index + 1}`}<input required autoFocus={index === 0} autoComplete="off" value={alias} onChange={e => setMembers(values => values.map((v, i) => i === index ? e.target.value : v))} /></label>)}
        </div>}
        <div className="acciones-armado"><button type="submit" className="boton boton-principal">{saving ? 'Inscribiendo…' : 'Inscribir en este lugar'}</button>
          <button type="button" className="boton boton-secundario" onClick={() => setSlot(null)}>Cancelar</button></div>
      </fieldset>
    </form>}
    {moving && <div className="formulario-inscripcion"><label className="campo">Mover desde {moving.label}<select autoFocus value="" disabled={loading || saving} onChange={e => move(e.target.value)}>
      <option value="">Elegí el destino</option>{slots.filter(s => s.round !== moving.round || s.position !== moving.position).map(s => {
        const id = layout.grupos.flatMap(g => g.tandas).find(t => t.id === s.round)?.posiciones[s.position];
        return <option key={`${s.round}:${s.position}`} value={`${s.round}:${s.position}`}>{s.label}{id ? ` · Intercambiar con ${registrations.find(i => i.id === id)?.nombre ?? 'participante'}` : ' · Libre'}</option>;
      })}</select></label><button type="button" className="boton boton-secundario" disabled={saving} onClick={() => setMoving(null)}>Cancelar movimiento</button></div>}
    {loading && <p role="status"><LoaderCircle size={18} className="girando" /> Cargando armado…</p>}
    {!loadError && <fieldset className="manual-board" disabled={loading || saving || !editable || Boolean(slot || editing || moving)}>
      {layout.grupos.map((group, groupIndex) => <section className="grupo-clasificatoria" key={group.nombre}>
        <div className="cabecera-armado"><h3>Clasi {group.nombre}</h3>
          {groupIndex === layout.grupos.length - 1 && group.tandas.every(t => t.posiciones.every(p => p === null)) &&
            <button type="button" className="boton boton-secundario" aria-label={`Quitar Clasi ${group.nombre}`} onClick={() => save(layout.grupos.slice(0, -1))}><Trash2 size={16} />Quitar clasi vacía</button>}
        </div>
        <div className="grilla-tandas-clasi">
          {group.tandas.map((round, roundIndex) => <article className="tanda-clasi" key={round.id}>
            <div className="cabecera-tanda-clasi"><h4>Ronda {roundIndex + 1}</h4><span>{round.posiciones.filter(Boolean).length}/{limit} inscriptos</span>
              {round.posiciones.every(p => p === null) && <button type="button" className="boton-icono-armado" aria-label={`Quitar ronda ${roundIndex + 1} de Clasi ${group.nombre}`} onClick={() => save(layout.grupos.map(g => g.nombre === group.nombre ? { ...g, tandas: g.tandas.filter(t => t.id !== round.id) } : g))}><Trash2 size={16} /></button>}
            </div>
            <ol className="lugares-armado">
              {round.posiciones.map((id, position) => {
                const entry = registrations.find(i => i.id === id);
                const current = { round: round.id, position, label: `Clasi ${group.nombre} · Ronda ${roundIndex + 1} · Lugar ${position + 1}` };
                return <li key={position}><span className="numero-lugar">{position + 1}</span>{entry ? <div className="contenido-lugar"><strong>{entry.nombre}</strong>
                  <div className="acciones-lugar"><button type="button" onClick={() => setMoving(current)}>Mover</button><button type="button" onClick={() => setEditing(entry)}>Editar</button>
                    <button type="button" aria-label={`Retirar a ${entry.nombre}`} onClick={() => {
                      if (window.confirm(`¿Retirar a ${entry.nombre} de la fecha? Se liberará su lugar.`)) void execute(() => modificarInscripcion(entry, 'retirar'), 'Participante retirado.');
                    }}>Retirar</button></div></div> : <button type="button" className="agregar-en-lugar" aria-label={`Inscribir en ${current.label}`} onClick={() => { setSlot(current); setError(''); }}><Plus size={16} />Inscribir acá</button>}</li>;
              })}
            </ol>
          </article>)}
        </div>
        <button type="button" className="boton boton-secundario acciones-armado" onClick={() => save(layout.grupos.map(g => g.nombre === group.nombre ? { ...g, tandas: [...g.tandas, { id: crypto.randomUUID(), posiciones: Array(limit).fill(null) }] } : g))}><Plus size={17} />Agregar ronda a Clasi {group.nombre}</button>
      </section>)}
      {layout.grupos.length < GROUP_NAMES.length && <button type="button" className="boton boton-principal acciones-armado" onClick={() => save([...layout.grupos, { nombre: GROUP_NAMES[layout.grupos.length], tandas: [] }])}><Plus size={17} />Agregar clasi {GROUP_NAMES[layout.grupos.length]}</button>}
    </fieldset>}
    {!loadError && !loading && registrations.filter(i => i.activa).length >= 2 && <div className="acciones-armado">
      <p className="texto-secundario">{registrations.filter(i => i.activa).length} inscriptos</p>
      <button type="button" className="boton boton-principal" disabled={saving || Boolean(slot || editing || moving)} onClick={onContinue}>Continuar a clasificatorias</button>
    </div>}
  </section>;
}
