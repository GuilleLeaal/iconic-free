import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  LoaderCircle,
  Plus,
  Search,
  Trophy,
  UsersRound,
  Trash2,
} from "lucide-react";
import { crearFecha, eliminarFecha, listarFechas } from "./fechasService";
import type { EstadoFecha, Fecha } from "./fechasService";
import "./fechas.css";
import GestionFecha from "./GestionFecha";
import { useCompetencia } from "../competencias/ContextoCompetencia";
import { CamposConfiguracion } from "./ConfiguracionFecha";
import { predeterminada } from './configuracionFechaModelo';

const estados: Record<EstadoFecha, string> = {
  borrador: "Borrador",
  inscripciones: "Inscripciones abiertas",
  en_curso: "En curso",
  finalizada: "Finalizada",
  archivada: "Archivada",
};

function mostrarFecha(valor: string | null) {
  if (!valor) return "Fecha por definir";

  // Se interpreta como fecha local para evitar cambios de día por zona horaria.
  const [anio, mes, dia] = valor.split("-").map(Number);

  return new Intl.DateTimeFormat("es-UY", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(anio, mes - 1, dia));
}

function mostrarFormato(integrantes: number) {
  return integrantes === 1 ? 'Individual' : integrantes === 2 ? 'Parejas' : `Equipos de ${integrantes}`;
}

function FormularioFecha({
  onCreada,
  onCancelar,
}: {
  onCreada: (fecha: Fecha) => void;
  onCancelar: () => void;
}) {
  const { competencia } = useCompetencia();
  const [nombre, setNombre] = useState("");
  const [fechaEvento, setFechaEvento] = useState("");
  const [integrantes, setIntegrantes] = useState("1");

  const [juradosClasi, setJuradosClasi] = useState("2");
  const [configuracion, setConfiguracion] = useState(predeterminada);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const guardadoEnCurso = useRef(false);

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (guardadoEnCurso.current) return;

    const cantidadIntegrantes = Number(integrantes);
    const cantidadJuradosClasi = Number(juradosClasi);

    if (!nombre.trim()) {
      setError("Ingresá un nombre para la fecha.");
      return;
    }

    if (!Number.isInteger(cantidadIntegrantes) || cantidadIntegrantes < 1) {
      setError("La cantidad de integrantes debe ser un entero mayor a cero.");
      return;
    }

    if (
      !Number.isInteger(cantidadJuradosClasi) ||
      cantidadJuradosClasi < 1 ||
      cantidadJuradosClasi > 5
    ) {
      setError("Las clasis pueden tener entre uno y cinco jurados por grupo.");
      return;
    }

    guardadoEnCurso.current = true;
    setGuardando(true);
    setError("");

    try {
      const nuevaFecha = await crearFecha({
        ...configuracion,
        nombre,
        fecha_evento: fechaEvento || null,
        integrantes_por_equipo: cantidadIntegrantes,
        jurados_eliminatorias: 3, // Compatibilidad con el esquema histórico; no hay votaciones web de eliminatorias.
        jurados_por_grupo_clasi: cantidadJuradosClasi,
      }, competencia.id);

      onCreada(nuevaFecha);
    } catch (errorGuardado) {
      console.error("Error al crear fecha:", errorGuardado);
      setError(
        "No pudimos confirmar el guardado. Tus datos siguen en el formulario. " +
          "Si se cortó la conexión, revisá el listado antes de volver a crearla.",
      );
    } finally {
      guardadoEnCurso.current = false;
      setGuardando(false);
    }
  }

  return (
    <section className="panel formulario-fecha">
      <div className="titulo-seccion">
        <span className="micro-etiqueta">CREAR FECHA</span>
        <h2>Nueva fecha</h2>
        <p className="texto-secundario">
          Configurá los datos, el formato y los jurados de la fecha.
        </p>
      </div>

      <form onSubmit={guardar}>
        <fieldset disabled={guardando}>
          <div className="seccion-formulario">
          <div className="cabecera-paso"><span>01</span><div><h3>Datos de la fecha</h3><p>Nombre, día y formato de participación.</p></div></div>
          <div className="campos-fecha">
            <div className="campo campo-ancho">
              <label htmlFor="nombre-fecha">Nombre</label>
              <input
                id="nombre-fecha"
                value={nombre}
                onChange={(event) => setNombre(event.target.value)}
                placeholder="Por ejemplo: Primera edición"
                autoFocus
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="dia-fecha">Día del evento</label>
              <input
                id="dia-fecha"
                type="date"
                value={fechaEvento}
                onChange={(event) => setFechaEvento(event.target.value)}
              />
              <span className="ayuda-campo">Podés dejarlo sin definir.</span>
            </div>

            <div className="campo">
              <label htmlFor="integrantes-fecha">Integrantes por equipo</label>
              <input
                id="integrantes-fecha"
                type="number"
                min="1"
                step="1"
                value={integrantes}
                onChange={(event) => setIntegrantes(event.target.value)}
                required
              />
              <span className="ayuda-campo">
                1 para individual, 2 para parejas, etc.
              </span>
            </div>
          </div>
          </div>
          <div className="seccion-formulario">
            <div className="cabecera-paso"><span>02</span><div><h3>El cuadro de competencia</h3><p>Elegí la fase inicial y cuántas inscripciones se enfrentan.</p></div></div>
            <CamposConfiguracion valor={configuracion} onChange={setConfiguracion} />
          </div>
          <details className="acordeon recursos-fecha"><summary><span>Jurados de clasificatorias<small>{juradosClasi} por grupo</small></span></summary>
          <div className="campos-fecha contenido-acordeon">


            <div className="campo">
              <label htmlFor="jurados-clasi">Jurados por grupo de clasis</label>
              <select
                id="jurados-clasi"
                value={juradosClasi}
                onChange={(event) => setJuradosClasi(event.target.value)}
              >
                {[1, 2, 3, 4, 5].map((cantidad) => (
                  <option key={cantidad} value={cantidad}>
                    {cantidad} {cantidad === 1 ? "jurado" : "jurados"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          </details>
          {error && (
            <p className="mensaje-error" role="alert">
              {error}
            </p>
          )}

          <div className="acciones-formulario">
            <button
              className="boton boton-secundario"
              type="button"
              onClick={onCancelar}
            >
              Cancelar
            </button>

            <button className="boton boton-principal" type="submit">
              {guardando && (
                <LoaderCircle
                  size={17}
                  className="girando"
                  aria-hidden="true"
                />
              )}
              {guardando ? "Guardando…" : "Crear fecha"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

export default function FechasPage() {
  const { competencia } = useCompetencia();
  const [params, setParams] = useSearchParams();
  const fechaId = params.get("fecha");

  const [fechas, setFechas] = useState<Fecha[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [intento, setIntento] = useState(0);
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [errorEliminacion, setErrorEliminacion] = useState('');
  const [aviso, setAviso] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const eliminacionEnCurso = useRef(false);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setCargando(true);
      setError("");

      try {
        const datos = await listarFechas(competencia.id);

        if (!cancelado) setFechas(datos);
      } catch (errorCarga) {
        console.error("Error al listar fechas:", errorCarga);

        if (!cancelado) {
          setError("No pudimos cargar las fechas. Intentá nuevamente.");
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    }

    void cargar();

    return () => {
      cancelado = true;
    };
  }, [intento, competencia.id]);

  function seleccionarFecha(id: string | null) {
    setParams((actuales) => {
      const siguientes = new URLSearchParams(actuales);

      if (id) siguientes.set("fecha", id);
      else siguientes.delete("fecha");

      return siguientes;
    });
  }

  function fechaCreada(fecha: Fecha) {
    setFechas((actuales) => [fecha, ...actuales]);
    setMostrarFormulario(false);
    seleccionarFecha(fecha.id);
  }

  async function borrarFecha(fecha: Fecha) {
    if (eliminacionEnCurso.current) return;
    if (!window.confirm(`¿Eliminar "${fecha.nombre}" de ${competencia.nombre}? Dejará de estar disponible y sus jurados no podrán seguir puntuando. Sus inscripciones, planillas y resultados se conservarán en el historial.`)) return;
    eliminacionEnCurso.current = true;
    setEliminando(fecha.id); setErrorEliminacion(''); setAviso('');
    try {
      await eliminarFecha(fecha.id, competencia.id);
      setFechas(actuales => actuales.filter(f => f.id !== fecha.id));
      if (fechaId === fecha.id) seleccionarFecha(null);
      setAviso(`Fecha "${fecha.nombre}" eliminada.`);
    } catch (e) {
      setErrorEliminacion(e instanceof Error ? e.message : 'No pudimos confirmar la eliminación.');
    } finally {
      eliminacionEnCurso.current = false; setEliminando(null);
    }
  }

  const mensajesEliminacion = <>
    {errorEliminacion && <p className="mensaje-error" role="alert">{errorEliminacion}</p>}
    {aviso && <p role="status">{aviso}</p>}
  </>;

  function botonEliminar(fecha: Fecha) {
    return <button type="button" className="boton boton-icono eliminar-fecha" title="Eliminar fecha"
      disabled={eliminando !== null} aria-label={`Eliminar ${fecha.nombre}`}
      onClick={() => void borrarFecha(fecha)}>
      {eliminando === fecha.id ? <LoaderCircle size={17} className="girando" aria-hidden="true" /> : <Trash2 size={17} aria-hidden="true" />}
      <span className="solo-lectores">{eliminando === fecha.id ? 'Eliminando…' : 'Eliminar fecha'}</span>
    </button>;
  }

  if (cargando) {
    return (
      <div className="carga-fechas" role="status">
        <LoaderCircle size={22} className="girando" aria-hidden="true" />
        Cargando fechas…
      </div>
    );
  }

  if (error) {
    return (
      <section className="panel">
        <p className="mensaje-error" role="alert">
          {error}
        </p>
        <button
          className="boton boton-principal"
          onClick={() => setIntento((actual) => actual + 1)}
        >
          Reintentar
        </button>
      </section>
    );
  }

  const seleccionada = fechas.find((fecha) => fecha.id === fechaId);

  if (fechaId) {
    return (
      <>
        {mensajesEliminacion}
        <button
          className="boton boton-secundario volver-fechas"
          onClick={() => seleccionarFecha(null)}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          Todas las fechas
        </button>

        {seleccionada ? (
          <>
            <div className="encabezado-pagina encabezado-detalle">
              <div>
              <span className="etiqueta">FECHA</span>
              <h1>{seleccionada.nombre}</h1>
              <p className="texto-secundario">
                {mostrarFecha(seleccionada.fecha_evento)}
              </p>
              </div>
              <div className="acciones-detalle"><span className={`estado-fecha estado-fecha-${seleccionada.estado}`}>{estados[seleccionada.estado]}</span>{botonEliminar(seleccionada)}</div>
            </div>

            <section className="resumen-detalle" aria-label="Resumen de la fecha">
              <dl className="datos-fecha">
                <div>
                  <dt>Formato</dt>
                  <dd>{mostrarFormato(seleccionada.integrantes_por_equipo)}</dd>
                </div>
                <div>
                  <dt>Cuadro inicial</dt>
                  <dd>{seleccionada.fase_inicial ?? 'Configuración histórica'}</dd>
                </div>
                <div>
                  <dt>Cupo de clasificación</dt>
                  <dd>{seleccionada.cupos ?? 'Según sorteo'}<small> inscripciones</small></dd>
                </div>
              </dl>
            </section>
            <GestionFecha key={`${seleccionada.id}:${seleccionada.configuracion_version}`} fecha={seleccionada} onConfiguracionActualizada={() => setIntento(i => i + 1)} />
          </>
        ) : (
          <section className="panel">
            <h2>Fecha no disponible</h2>
            <p className="texto-secundario">
              No encontramos esta fecha entre las que podés consultar.
            </p>
          </section>
        )}
      </>
    );
  }

  const fechasFiltradas = fechas.filter(f => (!filtroEstado || f.estado === filtroEstado) && f.nombre.toLocaleLowerCase('es').includes(busqueda.trim().toLocaleLowerCase('es')));
  return (
    <>
      {mensajesEliminacion}
      <div className="cabecera-fechas">
        <div className="encabezado-pagina">
          <span className="etiqueta">EL CALENDARIO DE {competencia.nombre.toUpperCase()}</span>
          <h1>Fechas</h1>
          <p className="texto-secundario">
            Consultá y administrá las fechas de esta competencia.
          </p>
        </div>

        {!mostrarFormulario && (
          <button
            className="boton boton-principal"
            onClick={() => setMostrarFormulario(true)}
          >
            <Plus size={18} aria-hidden="true" />
            Nueva fecha
          </button>
        )}
      </div>

      {!mostrarFormulario && fechas.length > 0 && <>
        <div className="metricas-fechas" aria-label="Resumen de fechas">
          <div><span className="metrica-icono"><CalendarDays size={19} /></span><div><strong>{fechas.length}</strong><span>Fechas creadas</span></div></div>
          <div><span className="metrica-icono metrica-en-vivo"><span className="punto-vivo" /></span><div><strong>{fechas.filter(f => f.estado === 'en_curso').length}</strong><span>En curso</span></div></div>
          <div><span className="metrica-icono"><Trophy size={19} /></span><div><strong>{fechas.filter(f => f.estado === 'finalizada').length}</strong><span>Finalizadas</span></div></div>
        </div>
        <div className="barra-filtros filtros-fechas">
          <label className="campo"><span className="solo-lectores">Buscar fecha</span><span className="entrada-con-icono"><Search size={18} /><input type="search" placeholder="Buscar una fecha…" value={busqueda} onChange={e => setBusqueda(e.target.value)} /></span></label>
          <label className="campo"><span className="solo-lectores">Estado de las fechas</span><select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}><option value="">Todos los estados</option>{Object.entries(estados).map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}</select></label>
        </div>
      </>}

      {mostrarFormulario && (
        <FormularioFecha
          onCreada={fechaCreada}
          onCancelar={() => setMostrarFormulario(false)}
        />
      )}

      {!mostrarFormulario && (fechas.length === 0 ? (
        <section className="panel vacio-fechas">
          <CalendarDays size={32} aria-hidden="true" />
          <h2>Todavía no hay fechas</h2>
          <p className="texto-secundario">Creá la primera fecha de {competencia.nombre}.</p>
          <button type="button" className="boton boton-principal" onClick={() => setMostrarFormulario(true)}><Plus size={17} />Crear primera fecha</button>
        </section>
      ) : (
        <div className="lista-fechas">
          {fechasFiltradas.map((fecha) => (
            <article className={`panel tarjeta-fecha tarjeta-fecha-${fecha.estado}`} key={fecha.id}>
              <div className="tarjeta-fecha-superior">
                <span className="icono-tarjeta-fecha"><CalendarDays size={21} aria-hidden="true" /></span>
                <span className={`estado-fecha estado-fecha-${fecha.estado}`}>{estados[fecha.estado]}</span>
              </div>

              <h2>{fecha.nombre}</h2>
              <p className="texto-secundario">
                {mostrarFecha(fecha.fecha_evento)}
              </p>

              <div className="resumen-fecha">
                <span><UsersRound size={15} />{mostrarFormato(fecha.integrantes_por_equipo)}</span>
                <span><Trophy size={15} />{fecha.cupos ?? '—'} cupos</span>
              </div>

              <div className="acciones-tarjeta-fecha"><button
                className="boton boton-secundario"
                onClick={() => seleccionarFecha(fecha.id)}
                aria-label={`Abrir ${fecha.nombre}`}
              >
                Abrir fecha
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              {botonEliminar(fecha)}
              </div>
            </article>
          ))}
          {fechasFiltradas.length === 0 && <div className="panel vacio-fechas"><Search size={26} /><h2>No encontramos esa fecha</h2><p className="texto-secundario">Probá otro nombre o cambiá el filtro de estado.</p></div>}
        </div>
      ))}
    </>
  );
}
