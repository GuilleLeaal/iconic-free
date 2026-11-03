import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Competencia } from './ContextoCompetencia';
import { ArrowUpRight, Building2, CircleUserRound, Mail, Plus, Search, Send, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import Paginacion from '../../components/Paginacion';

type Vinculo = { competencia_id: string; competencia: string; rol: string; estado: string };
type Cuenta = { id: string; nombre: string; email: string | null; vinculos: Vinculo[] };
type InvitacionPendiente = { id: string; email: string; rol: string; entrega: string; vence_en: string; vencida: boolean; competencia_id: string; competencia: string };
export default function Administracion({ global, competencia, usuarioActualId, onElegir, onActualizar, onCompetenciaEliminada }: {
  global: boolean; competencia: Competencia | null; usuarioActualId: string; onElegir: (c: Competencia) => void; onActualizar: () => void; onCompetenciaEliminada: (id: string) => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(0);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [mas, setMas] = useState(false);
  const [compBusqueda, setCompBusqueda] = useState('');
  const [compPagina, setCompPagina] = useState(0);
  const [competencias, setCompetencias] = useState<{ id: string; nombre: string; activa: boolean }[]>([]);
  const [compMas, setCompMas] = useState(false);
  const [compEstado, setCompEstado] = useState('');
  const [alcance, setAlcance] = useState(global ? 'global' : 'competencia');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState('jurado');
  const [nombre, setNombre] = useState('');
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [revision, setRevision] = useState(0);
  const [invitacion, setInvitacion] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState<InvitacionPendiente[]>([]);
  const [pendBusqueda, setPendBusqueda] = useState('');
  const [pendPagina, setPendPagina] = useState(0);
  const [pendMas, setPendMas] = useState(false);
  useEffect(() => {
    let vigente = true;
    const timer = window.setTimeout(() => {
      void supabase.rpc('buscar_invitaciones', { p_competencia: alcance === 'global' && global ? null : competencia?.id ?? null, p_busqueda: pendBusqueda, p_pagina: pendPagina }).then(({ data, error }) => {
        if (!vigente) return;
        if (error) { setError(error.message); return; }
        setPendientes(data.filas); setPendMas(data.hay_mas);
      });
    }, 250);
    return () => { vigente = false; clearTimeout(timer); };
  }, [competencia?.id, alcance, global, pendBusqueda, pendPagina, revision]);
  useEffect(() => {
    let vigente = true;
    const timer = window.setTimeout(() => {
      void supabase.rpc('buscar_cuentas', { p_competencia: alcance === 'global' && global ? null : competencia?.id ?? null, p_busqueda: busqueda, p_estado: estado || null, p_pagina: pagina }).then(({ data, error }) => {
        if (!vigente) return;
        if (error) { setError(error.message); return; }
        setCuentas(data.filas); setMas(data.hay_mas);
      });
    }, 250);
    return () => { vigente = false; clearTimeout(timer); };
  }, [competencia?.id, busqueda, estado, pagina, revision, alcance, global]);
  useEffect(() => {
    if (!global) return;
    let vigente = true;
    const timer = window.setTimeout(() => {
      void supabase.rpc('buscar_competencias', { p_busqueda: compBusqueda, p_pagina: compPagina, p_activa: compEstado === '' ? null : compEstado === 'activa' }).then(({ data, error }) => {
        if (!vigente) return;
        if (error) { setError(error.message); return; }
        setCompetencias(data.filas); setCompMas(data.hay_mas);
      });
    }, 250);
    return () => { vigente = false; clearTimeout(timer); };
  }, [global, compBusqueda, compPagina, revision, compEstado]);
  async function operar(accion: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(true); setError(''); setAviso('');
    try { await accion(); setRevision(x => x + 1); onActualizar(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No pudimos confirmar la operación. Actualizá antes de reintentar.'); }
    finally { setOcupado(false); }
  }
  async function rpc(nombre: string, args: Record<string, unknown>) {
    const { data, error } = await supabase.rpc(nombre, args);
    if (error) throw new Error(error.message);
    return data;
  }
  async function enviar(id: string, reenviar = false) {
    const { data, error } = await supabase.functions.invoke('gestionar-invitacion', { body: { invitacion_id: id, reenviar } });
    if (error || !data?.enviada) throw new Error('El vínculo quedó pendiente, pero no pudimos confirmar el correo. Usá Reintentar envío. La persona también puede ingresar con su cuenta y aceptar desde la web.');
    setAviso(data.reutilizada ? 'El envío anterior ya está registrado. Si el enlace venció, usá Reintentar / reenviar correo.' : 'Correo enviado. La persona debe abrir el enlace, ingresar con su cuenta y aceptar el vínculo.');
  }
  return <div className="administracion">
    <header className="encabezado-pagina">
      <span className="etiqueta">{global ? 'ADMINISTRACIÓN GLOBAL' : competencia?.nombre.toUpperCase()}</span>
      <h1>Cuentas y permisos</h1>
      <p className="texto-secundario">Administrá cuentas, permisos y vínculos por competencia.</p>
    </header>
    {error && <p role="alert" className="mensaje-error">{error}</p>}
    {aviso && <p role="status" className="mensaje-guardado">{aviso}</p>}

    <div className="admin-herramientas">
      {global && <details className="acordeon admin-herramienta" open={!competencia}>
        <summary><Building2 size={21} /><span>Competencias<small>Creá, activá o desactivá competencias</small></span></summary>
        <div className="contenido-acordeon">
          <form className="formulario-alta-competencia" onSubmit={e => { e.preventDefault(); void operar(async () => { await rpc('crear_competencia', { p_nombre: nombre }); setNombre(''); }); }}>
            <label>Nombre de nueva competencia<input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre de la competencia" required maxLength={120} /></label>
            <button className="boton boton-principal" disabled={ocupado}><Plus size={16} />Crear competencia</button>
          </form>
          <div className="barra-filtros filtros-competencias">
            <label>Buscar competencias<input type="search" value={compBusqueda} onChange={e => { setCompBusqueda(e.target.value); setCompPagina(0); }} placeholder="Buscar por nombre…" /></label>
            <label>Estado de competencias<select value={compEstado} onChange={e => { setCompEstado(e.target.value); setCompPagina(0); }}><option value="">Todas</option><option value="activa">Activas</option><option value="inactiva">Inactivas</option></select></label>
          </div>
          <ul className="lista-registros lista-competencias">{competencias.map(c => <li key={c.id}>
            <div className="registro-identidad"><span className="avatar-registro"><Building2 size={18} /></span><div><strong>{c.nombre}</strong><span className={'etiqueta-estado ' + (c.activa ? 'etiqueta-activa' : '')}>{c.activa ? 'Activa' : 'Inactiva'}</span></div></div>
            <div className="registro-acciones">
              {c.activa && <button className="boton boton-secundario" onClick={() => onElegir({ ...c, organizacion: true, jurado: false })}>Administrar<ArrowUpRight size={15} /></button>}
              <button className="boton boton-texto" disabled={ocupado} onClick={() => {
                const nuevo = window.prompt('Nombre de la competencia', c.nombre);
                if (nuevo?.trim()) void operar(async () => { await rpc('cambiar_competencia', { p_id: c.id, p_nombre: nuevo, p_activa: c.activa }); });
              }}>Renombrar</button>
              <button className="boton boton-texto accion-cautela" disabled={ocupado} onClick={() => {
                if (!window.confirm((c.activa ? 'Desactivar ' : 'Reactivar ') + c.nombre + '. Esto afecta todos sus accesos y conserva el historial.')) return;
                void operar(async () => { await rpc('cambiar_competencia', { p_id: c.id, p_nombre: c.nombre, p_activa: !c.activa }); });
              }}>{c.activa ? 'Desactivar' : 'Reactivar'}</button>
              <button className="boton boton-texto accion-cautela" disabled={ocupado} aria-label={`Eliminar definitivamente competencia ${c.nombre}`} onClick={() => {
                const confirmacion = window.prompt(`Eliminar definitivamente ${c.nombre} borrará de la base sus fechas, inscripciones, sorteos, votos y resultados. Las cuentas personales seguirán existiendo. Esta acción no se puede deshacer. Escribí el nombre de la competencia para confirmar:`);
                if (confirmacion === null) return;
                if (confirmacion.trim() !== c.nombre) { setError('El nombre de confirmación no coincide.'); return; }
                void operar(async () => {
                  await rpc('eliminar_competencia_definitiva', { p_competencia: c.id, p_confirmacion: confirmacion.trim() });
                  setCompetencias(actuales => actuales.filter(item => item.id !== c.id));
                  onCompetenciaEliminada(c.id);
                  setAviso('Competencia y sus datos eliminados definitivamente.');
                });
              }}><Trash2 size={15} />Eliminar definitivamente</button>
            </div>
          </li>)}</ul>
          {competencias.length === 0 && <p className="estado-vacio-simple">No hay competencias para esta búsqueda.</p>}
          <Paginacion pagina={compPagina} hayMas={compMas} onCambiar={setCompPagina} nombre="Páginas de competencias" />
        </div>
      </details>}

      {competencia && <details className="acordeon admin-herramienta">
        <summary><Send size={21} /><span>Invitar o vincular una cuenta personal<small>Sumá una persona al equipo de {competencia.nombre}</small></span></summary>
        <div className="contenido-acordeon">
          <p className="texto-secundario">La persona recibe un enlace y acepta el vínculo con su cuenta. Después podés asignarla a una fecha.</p>
          <form onSubmit={e => { e.preventDefault(); void operar(async () => {
            const id = await rpc('preparar_invitacion', { p_competencia: competencia.id, p_email: email, p_rol: rol });
            setInvitacion(id); await enviar(id);
          }); }}>
            <label>Correo<input type="email" required value={email} placeholder="persona@correo.com" onChange={e => { setEmail(e.target.value); setInvitacion(null); }} /></label>
            {global && <label>Permiso<select value={rol} onChange={e => setRol(e.target.value)}><option value="jurado">Jurado</option><option value="organizacion">Organizador</option></select></label>}
            <button className="boton boton-principal" disabled={ocupado}><Mail size={16} />{ocupado ? 'Preparando acceso…' : 'Preparar vínculo y enviar acceso'}</button>
          </form>
          {invitacion && <button className="boton boton-secundario reintentar-invitacion" disabled={ocupado} onClick={() => void operar(() => enviar(invitacion, true))}>Reintentar / reenviar correo</button>}
        </div>
      </details>}
    </div>

    <section className="panel directorio-cuentas">
      <div className="cabecera-seccion"><span className="icono-seccion"><UsersRound size={21} /></span><div>
        <h2>{alcance === 'global' && global ? 'Directorio global' : 'Vínculos de ' + competencia?.nombre}</h2>
        <p className="texto-secundario">Buscá personas y administrá sus accesos.</p>
      </div></div>
      <div className="barra-filtros filtros-cuentas">
        <label>Buscar cuentas<span className="entrada-con-icono"><Search size={17} /><input type="search" placeholder="Nombre o correo…" value={busqueda} onChange={e => { setBusqueda(e.target.value); setPagina(0); }} /></span></label>
        <label>Estado<select value={estado} onChange={e => { setEstado(e.target.value); setPagina(0); }}><option value="">Todos</option><option value="activo">Activos</option><option value="inactivo">Inactivos</option></select></label>
        {global && competencia && <label>Alcance de cuentas<select value={alcance} onChange={e => { setAlcance(e.target.value); setPagina(0); }}><option value="global">Todas las competencias</option><option value="competencia">Solo {competencia.nombre}</option></select></label>}
      </div>
      <ul className="lista-registros lista-cuentas">{cuentas.map(c => <li key={c.id}>
        <div className="registro-identidad"><span className="avatar-registro"><CircleUserRound size={21} /></span><div><strong>{c.nombre}</strong>{c.email && <span className="registro-correo">{c.email}</span>}</div></div>
        <ul className="lista-vinculos">{c.vinculos.map(v => <li key={v.competencia_id + ':' + v.rol}>
          <div className="vinculo-descripcion"><span className="vinculo-rol"><ShieldCheck size={13} />{v.rol === 'jurado' ? 'Jurado' : 'Organizador'}</span><span>{v.competencia}</span><span className={'etiqueta-estado ' + (v.estado === 'activo' ? 'etiqueta-activa' : '')}>{v.estado === 'activo' ? 'Activo' : v.estado === 'inactivo' ? 'Inactivo' : 'Pendiente'}</span></div>
          {(global || v.rol === 'jurado') && <button className="boton boton-texto" disabled={ocupado} onClick={() => void operar(async () => {
            await rpc('cambiar_vinculo', { p_competencia: v.competencia_id, p_usuario: c.id, p_rol: v.rol, p_estado: v.estado === 'activo' ? 'inactivo' : 'activo' });
            setAviso('Vínculo actualizado. Sus actuaciones se conservan.');
          })}>{v.estado === 'activo' ? 'Desactivar vínculo' : 'Reactivar vínculo'}</button>}
        </li>)}</ul>
        {global && <div className="registro-acciones"><button className="boton boton-texto accion-cautela" disabled={ocupado || c.id === usuarioActualId || !c.email} aria-label={`Eliminar definitivamente usuario ${c.nombre}`} onClick={() => {
          const confirmacion = window.prompt(`Eliminar definitivamente la cuenta de ${c.nombre} (${c.email}) borrará su acceso, vínculos, asignaciones y votos en todas las competencias. Sus fechas y resultados se conservarán sin atribuirlos a esa cuenta. Podrás invitar al mismo correo como una cuenta nueva. Esta acción no se puede deshacer. Escribí el correo para confirmar:`);
          if (confirmacion === null) return;
          if (confirmacion.trim().toLowerCase() !== c.email?.toLowerCase()) { setError('El correo de confirmación no coincide.'); return; }
          void operar(async () => {
            const { data, error } = await supabase.functions.invoke('administrar-borrados', { body: { usuario_id: c.id, confirmacion: confirmacion.trim() } });
            if (error || !data?.eliminado) {
              let mensaje = data?.error;
              if (!mensaje && error && 'context' in error && error.context instanceof Response) {
                try { mensaje = (await error.context.json()).error; } catch { /* Mostrar el mensaje general. */ }
              }
              throw new Error(mensaje || 'No pudimos confirmar el borrado. Actualizá el directorio antes de reintentar.');
            }
            setCuentas(actuales => actuales.filter(item => item.id !== c.id));
            setAviso('Cuenta eliminada definitivamente. Podés invitar nuevamente al mismo correo.');
          });
        }}><Trash2 size={15} />Eliminar cuenta definitivamente</button></div>}
      </li>)}</ul>
      {cuentas.length === 0 && <div className="estado-vacio"><UsersRound size={28} /><h3>No hay cuentas para mostrar</h3><p>Probá otra búsqueda o invitá a alguien a tu competencia.</p></div>}
      <Paginacion pagina={pagina} hayMas={mas} onCambiar={setPagina} nombre="Páginas de cuentas" />
    </section>

    <details className="acordeon pendientes-acceso">
      <summary><Mail size={20} /><span>Invitaciones pendientes y problemas de acceso<small>Revisá envíos, vencimientos y enlaces de acceso</small></span></summary>
      <div className="contenido-acordeon">
        <label>Buscar invitaciones por correo<input type="search" value={pendBusqueda} placeholder="persona@correo.com" onChange={e => { setPendBusqueda(e.target.value); setPendPagina(0); }} /></label>
        {pendientes.length === 0 && <p className="estado-vacio-simple">No hay invitaciones pendientes para esta búsqueda.</p>}
        <ul className="lista-registros">{pendientes.map(i => <li key={i.id}>
          <div className="registro-identidad"><span className="avatar-registro"><Mail size={18} /></span><div><strong>{i.email}</strong><span className="registro-correo">{i.competencia} · {i.rol === 'jurado' ? 'Jurado' : 'Organizador'}</span></div></div>
          <div className="invitacion-estados"><span className="etiqueta-estado">{i.entrega === 'enviada' ? 'Correo enviado' : i.entrega === 'error' ? 'Error de envío' : 'Envío pendiente'}</span><span>{i.vencida ? 'Enlace vencido' : 'Vence ' + new Date(i.vence_en).toLocaleDateString('es-UY')}</span></div>
          {(global || i.rol === 'jurado') && <div className="registro-acciones"><button className="boton boton-secundario" disabled={ocupado} onClick={() => void operar(async () => {
            const id = await rpc('preparar_invitacion', { p_competencia: i.competencia_id, p_email: i.email, p_rol: i.rol }); await enviar(id, true);
          })}>Renovar y reenviar</button><button className="boton boton-texto accion-cautela" disabled={ocupado} onClick={() => void operar(async () => { await rpc('cancelar_invitacion', { p_id: i.id }); setAviso('Invitación cancelada. La cuenta personal se conserva.'); })}>Cancelar invitación</button></div>}
        </li>)}</ul>
        <Paginacion pagina={pendPagina} hayMas={pendMas} onCambiar={setPendPagina} nombre="Páginas de invitaciones" />
      </div>
    </details>
  </div>;
}
