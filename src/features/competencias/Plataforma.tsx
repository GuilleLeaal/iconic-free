import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router';
import { supabase } from '../../lib/supabase';
import FechasPage from '../fechas/FechasPage';
import JuradoPage from '../clasificatorias/JuradoPage';
import Administracion from './Administracion';
import { ContextoCompetencia } from './ContextoCompetencia';
import type { Competencia } from './ContextoCompetencia';
import './competencias.css';
import { ArrowLeft, CalendarDays, ClipboardList, ShieldCheck, UserRound, UsersRound } from 'lucide-react';

type Accesos = { administrador: boolean; competencias: Competencia[] };
type Invitacion = { id: string; competencia: string; rol: string; vence_en: string };
export default function Plataforma({ usuarioId, nombre }: { usuarioId: string; nombre: string }) {
  const [accesos, setAccesos] = useState<Accesos | null>(null);
  const [seleccion, setSeleccion] = useState<Competencia | null>(null);
  const [rol, setRol] = useState<'organizacion' | 'jurado'>('organizacion');
  const [admin, setAdmin] = useState(false);
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let vigente = true;
    void Promise.all([supabase.rpc('mis_contextos'), supabase.rpc('mis_invitaciones')]).then(([contextos, invitaciones]) => {
      if (!vigente) return;
      if (contextos.error || invitaciones.error) { setError('No pudimos verificar tus accesos. Actualizá; comprobá que la instalación de la plataforma esté completa.'); setAccesos(null); return; }
      setError(''); setAccesos(contextos.data); setInvitaciones(invitaciones.data);
      setSeleccion(actual => {
        const autorizado = contextos.data.competencias.find((c: Competencia) => c.id === actual?.id);
        return autorizado ?? (contextos.data.administrador && actual ? actual : contextos.data.competencias[0] ?? null);
      });
    });
    return () => { vigente = false; };
  }, [revision]);
  useEffect(() => {
    const refrescar = () => setRevision(r => r + 1);
    const timer = window.setInterval(refrescar, 30000);
    window.addEventListener('focus', refrescar);
    return () => { clearInterval(timer); window.removeEventListener('focus', refrescar); };
  }, []);
  if (!accesos) return <section className="panel"><p role={error ? 'alert' : 'status'}>{error || 'Verificando competencias autorizadas…'}</p><button className="boton boton-secundario" onClick={() => setRevision(r => r + 1)}>Actualizar accesos</button></section>;
  const rolActual = seleccion?.organizacion && (rol === 'organizacion' || !seleccion.jurado) ? 'organizacion' : 'jurado';
  return <div className="workspace">
    <aside className="workspace-sidebar" aria-label="Navegación principal">
      <div className="identidad-competencia">
        <span className="avatar-competencia" aria-hidden="true">{seleccion?.nombre.slice(0, 2).toUpperCase() ?? 'UY'}</span>
        <div><span className="micro-etiqueta">COMPETENCIA</span><h2>{seleccion?.nombre ?? 'Competencias'}</h2></div>
      </div>
      <label className="campo selector-contexto"><span>Competencia activa</span><select value={seleccion?.id ?? ''} onChange={e => { setSeleccion(accesos.competencias.find(c => c.id === e.target.value) ?? null); setAdmin(false); }}>
        {!seleccion && <option value="">Elegí una competencia</option>}
        {seleccion && !accesos.competencias.some(c => c.id === seleccion.id) && <option value={seleccion.id}>{seleccion.nombre}</option>}
        {accesos.competencias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select></label>
      {seleccion?.organizacion && seleccion.jurado && <label className="campo selector-rol"><span>Actuar como</span><select value={rolActual} onChange={e => setRol(e.target.value as 'organizacion' | 'jurado')}><option value="organizacion">Organización</option><option value="jurado">Jurado</option></select></label>}
      <nav className="workspace-nav" aria-label="Navegación principal">
        {seleccion && <button type="button" className={!admin ? 'workspace-nav-activa' : ''} aria-current={!admin ? 'page' : undefined} onClick={() => setAdmin(false)}>
          {rolActual === 'organizacion' ? <CalendarDays size={19} /> : <ClipboardList size={19} />}<span>{rolActual === 'organizacion' ? 'Fechas' : 'Mis planillas'}<small>{rolActual === 'organizacion' ? 'Ediciones y organización' : 'Tus grupos asignados'}</small></span>
        </button>}
        {(accesos.administrador || seleccion?.organizacion) && <button type="button" className={admin ? 'workspace-nav-activa' : ''} aria-current={admin ? 'page' : undefined} aria-label={accesos.administrador ? 'Administración global' : 'Administrar cuentas'} onClick={() => setAdmin(true)}>
          {accesos.administrador ? <ShieldCheck size={19} /> : <UsersRound size={19} />}<span>{accesos.administrador ? 'Administración global' : 'Administrar cuentas'}<small>Personas y permisos</small></span>
        </button>}
      </nav>
      <div className="workspace-cuenta"><span className="avatar-usuario"><UserRound size={17} /></span><div><strong>{nombre}</strong><span>Cuenta personal</span></div></div>
    </aside>
    <div className="workspace-main">
      <div className="workspace-ubicacion"><span>COMPETENCIAS <span aria-hidden="true">/</span> {seleccion?.nombre ?? 'Plataforma'}</span><span className="insignia-acceso">{accesos.administrador ? 'Administrador' : rolActual === 'organizacion' ? 'Organización' : 'Jurado'}</span></div>
      {admin && seleccion && <button type="button" className="boton boton-texto volver-competencia" onClick={() => setAdmin(false)}><ArrowLeft size={16} />Volver a la competencia</button>}
    {invitaciones.length > 0 && <section className="panel invitaciones-personales"><div className="titulo-seccion"><h2>Tenés una invitación</h2><p className="texto-secundario">Aceptá para acceder con tu cuenta personal.</p></div>{invitaciones.map(i => <div className="invitacion-personal" key={i.id}><div><strong>{i.competencia}</strong><p className="texto-secundario">{i.rol === 'organizacion' ? 'Organización' : 'Jurado'} · Vence {new Date(i.vence_en).toLocaleDateString('es-UY')}</p></div><button className="boton boton-principal" onClick={async () => {
      const { error } = await supabase.rpc('aceptar_invitacion', { p_id: i.id });
      if (error) setError(error.message); else setRevision(r => r + 1);
    }}>Aceptar vínculo</button></div>)}</section>}
    {error && <p className="mensaje-error" role="alert">{error}</p>}
    {admin ? <Administracion key={`${seleccion?.id}:admin`} global={accesos.administrador} competencia={seleccion} onElegir={c => { setSeleccion(c); setAdmin(false); }} onActualizar={() => setRevision(r => r + 1)} />
      : seleccion ? <ContextoCompetencia.Provider key={`${usuarioId}:${seleccion.id}:${rolActual}`} value={{ competencia: seleccion, usuarioId }}>
        {rolActual === 'organizacion' ? <BrowserRouter><FechasPage /></BrowserRouter> : <JuradoPage juradoId={usuarioId} nombre={nombre} competenciaId={seleccion.id} />}
      </ContextoCompetencia.Provider> : <section className="panel"><p>No tenés vínculos activos. Aceptá una invitación o solicitá acceso a organización.</p>{accesos.administrador && <button className="boton boton-principal" onClick={() => setAdmin(true)}>Gestionar competencias</button>}</section>}
    </div>
  </div>;
}
