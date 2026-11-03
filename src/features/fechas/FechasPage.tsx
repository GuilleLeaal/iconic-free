import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { crearFecha, listarFechas } from "./fechasService";
import type { EstadoFecha, Fecha } from "./fechasService";
import "./fechas.css";
import GestionFecha from "./GestionFecha";

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
  return `${integrantes} vs ${integrantes}`;
}

function FormularioFecha({
  onCreada,
  onCancelar,
}: {
  onCreada: (fecha: Fecha) => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [fechaEvento, setFechaEvento] = useState("");
  const [integrantes, setIntegrantes] = useState("1");
  const [jurados, setJurados] = useState("3");
  const [juradosClasi, setJuradosClasi] = useState("2");
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
        nombre,
        fecha_evento: fechaEvento || null,
        integrantes_por_equipo: cantidadIntegrantes,
        jurados_eliminatorias: jurados === "5" ? 5 : 3,
        jurados_por_grupo_clasi: cantidadJuradosClasi,
      });

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
        <h2>Nueva fecha</h2>
        <p className="texto-secundario">
          Configurá el formato y la cantidad de jurados.
        </p>
      </div>

      <form onSubmit={guardar}>
        <fieldset disabled={guardando}>
          <div className="campos-fecha">
            <div className="campo campo-ancho">
              <label htmlFor="nombre-fecha">Nombre</label>
              <input
                id="nombre-fecha"
                value={nombre}
                onChange={(event) => setNombre(event.target.value)}
                placeholder="Por ejemplo: ICONIC — Primera edición"
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

            <div className="campo">
              <label htmlFor="jurados-fecha">Jurados desde octavos</label>
              <select
                id="jurados-fecha"
                value={jurados}
                onChange={(event) => setJurados(event.target.value)}
              >
                <option value="3">3 jurados</option>
                <option value="5">5 jurados</option>
              </select>
            </div>

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
  const [params, setParams] = useSearchParams();
  const fechaId = params.get("fecha");

  const [fechas, setFechas] = useState<Fecha[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setCargando(true);
      setError("");

      try {
        const datos = await listarFechas();

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
  }, [intento]);

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
        <button
          className="boton boton-secundario volver-fechas"
          onClick={() => seleccionarFecha(null)}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          Todas las fechas
        </button>

        {seleccionada ? (
          <>
            <div className="encabezado-pagina">
              <span className="etiqueta">FECHA</span>
              <h1>{seleccionada.nombre}</h1>
              <p className="texto-secundario">
                {mostrarFecha(seleccionada.fecha_evento)}
              </p>
            </div>

            <section className="panel">
              <div className="titulo-seccion titulo-configuracion">
                <h2>Configuración</h2>
                <span className="estado-fecha">
                  {estados[seleccionada.estado]}
                </span>
              </div>

              <dl className="datos-fecha">
                <div>
                  <dt>Formato</dt>
                  <dd>{mostrarFormato(seleccionada.integrantes_por_equipo)}</dd>
                </div>
                <div>
                  <dt>Jurados desde octavos</dt>
                  <dd>{seleccionada.jurados_eliminatorias}</dd>
                </div>
                <div>
                  <dt>Jurados por grupo de clasis</dt>
                  <dd>{seleccionada.jurados_por_grupo_clasi}</dd>
                </div>
              </dl>
            </section>
            <GestionFecha key={seleccionada.id} fecha={seleccionada} />
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

  return (
    <>
      <div className="cabecera-fechas">
        <div className="encabezado-pagina">
          <span className="etiqueta">ORGANIZACIÓN</span>
          <h1>Fechas</h1>
          <p className="texto-secundario">
            Creá una edición o abrí una existente.
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

      {mostrarFormulario && (
        <FormularioFecha
          onCreada={fechaCreada}
          onCancelar={() => setMostrarFormulario(false)}
        />
      )}

      {fechas.length === 0 ? (
        <section className="panel vacio-fechas">
          <CalendarDays size={32} aria-hidden="true" />
          <h2>Todavía no hay fechas</h2>
          <p className="texto-secundario">Creá la primera edición de ICONIC.</p>
        </section>
      ) : (
        <div className="lista-fechas">
          {fechas.map((fecha) => (
            <article className="panel tarjeta-fecha" key={fecha.id}>
              <div className="tarjeta-fecha-superior">
                <CalendarDays size={23} aria-hidden="true" />
                <span className="estado-fecha">{estados[fecha.estado]}</span>
              </div>

              <h2>{fecha.nombre}</h2>
              <p className="texto-secundario">
                {mostrarFecha(fecha.fecha_evento)}
              </p>

              <div className="resumen-fecha">
                <span>{mostrarFormato(fecha.integrantes_por_equipo)}</span>
                <span>{fecha.jurados_eliminatorias} jurados</span>
              </div>

              <button
                className="boton boton-secundario"
                onClick={() => seleccionarFecha(fecha.id)}
                aria-label={`Abrir ${fecha.nombre}`}
              >
                Abrir fecha
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
