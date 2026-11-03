import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ChevronDown,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";

import type { Fecha } from "../fechas/fechasService";
import {
  anotarInscripcion,
  listarInscripciones,
  modificarInscripcion,
} from "./inscripcionesService";
import type { Inscripcion } from "./inscripcionesService";
import EditarInscripcion from "./EditarInscripcion";
import "./inscripciones.css";

const TAMANO_PAGINA = 10;

type Borrador = {
  nombre: string;
  integrantes: string[];
};

function normalizarBusqueda(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cargarBorrador(clave: string, cantidad: number): Borrador {
  const vacio = {
    nombre: "",
    integrantes: Array.from({ length: cantidad }, () => ""),
  };

  try {
    const guardado = localStorage.getItem(clave);

    if (!guardado) return vacio;

    const datos: unknown = JSON.parse(guardado);

    if (
      typeof datos === "object" &&
      datos !== null &&
      "nombre" in datos &&
      "integrantes" in datos &&
      typeof datos.nombre === "string" &&
      Array.isArray(datos.integrantes) &&
      datos.integrantes.length === cantidad &&
      datos.integrantes.every((alias) => typeof alias === "string")
    ) {
      return {
        nombre: datos.nombre,
        integrantes: datos.integrantes,
      };
    }
  } catch {
    // Si el borrador no está disponible, se abre un formulario vacío.
  }

  return vacio;
}

export default function InscripcionesPanel({
  fecha,
  bloqueado = false,
}: {
  fecha: Fecha;
  bloqueado?: boolean;
}) {
  const cantidad = fecha.integrantes_por_equipo;
  const esIndividual = cantidad === 1;
  const claveBorrador = `iconic:inscripcion:${fecha.id}:${cantidad}`;
  const admiteInscripciones =
    !bloqueado &&
    (fecha.estado === "borrador" || fecha.estado === "inscripciones");

  const [borrador, setBorrador] = useState(() =>
    cargarBorrador(claveBorrador, cantidad),
  );
  const [inscripciones, setInscripciones] = useState<Inscripcion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");
  const [errorFormulario, setErrorFormulario] = useState("");
  const [aviso, setAviso] = useState("");
  const [errorBorrador, setErrorBorrador] = useState(false);
  const [intento, setIntento] = useState(0);
  const [editando, setEditando] = useState<Inscripcion | null>(null);
  const [cambiandoEstado, setCambiandoEstado] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState("");
  const [mostrarRetirados, setMostrarRetirados] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [cantidadVisible, setCantidadVisible] = useState(TAMANO_PAGINA);

  const cambioEstadoEnCurso = useRef(false);
  const guardadoEnCurso = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(claveBorrador, JSON.stringify(borrador));
      setErrorBorrador(false);
    } catch {
      setErrorBorrador(true);
    }
  }, [claveBorrador, borrador]);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setCargando(true);
      setErrorCarga("");

      try {
        const datos = await listarInscripciones(fecha.id);

        if (!cancelado) {
          setInscripciones(datos);

          setEditando((actual) =>
            actual
              ? (datos.find((item) => item.id === actual.id) ?? null)
              : null,
          );
        }
      } catch {
        if (!cancelado) {
          setErrorCarga("No pudimos cargar las inscripciones.");
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    }

    void cargar();

    return () => {
      cancelado = true;
    };
  }, [fecha.id, intento]);

  function cambiarIntegrante(indice: number, alias: string) {
    setBorrador((actual) => ({
      ...actual,
      integrantes: actual.integrantes.map((valor, posicion) =>
        posicion === indice ? alias : valor,
      ),
    }));
  }

  function cambiarBusqueda(valor: string) {
    setBusqueda(valor);
    setCantidadVisible(TAMANO_PAGINA);
  }

  function cambiarFiltroRetirados(valor: boolean) {
    setMostrarRetirados(valor);
    setCantidadVisible(TAMANO_PAGINA);
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (guardadoEnCurso.current || !admiteInscripciones) return;

    setErrorFormulario("");
    setAviso("");

    if (borrador.integrantes.some((alias) => !alias.trim())) {
      setErrorFormulario("Completá todos los alias.");
      return;
    }

    if (!esIndividual && !borrador.nombre.trim()) {
      setErrorFormulario("Ingresá el nombre del equipo.");
      return;
    }

    guardadoEnCurso.current = true;
    setGuardando(true);

    try {
      await anotarInscripcion(fecha.id, borrador.nombre, borrador.integrantes);

      setBorrador({
        nombre: "",
        integrantes: Array.from({ length: cantidad }, () => ""),
      });

      setAviso(esIndividual ? "Participante anotado." : "Equipo anotado.");
      setIntento((actual) => actual + 1);
    } catch (error) {
      setErrorFormulario(
        error instanceof Error
          ? error.message
          : "No pudimos confirmar el guardado. Actualizá el listado antes de reintentar.",
      );
    } finally {
      guardadoEnCurso.current = false;
      setGuardando(false);
    }
  }

  const activas = inscripciones.filter((item) => item.activa);
  const retiradas = inscripciones.filter((item) => !item.activa);
  const disponibles = mostrarRetirados ? inscripciones : activas;

  const terminos = normalizarBusqueda(busqueda).split(/\s+/).filter(Boolean);
  const hayBusqueda = terminos.length > 0;

  const filtradas = disponibles.filter((inscripcion) => {
    if (!hayBusqueda) return true;

    const texto = normalizarBusqueda(
      [
        inscripcion.nombre,
        ...inscripcion.integrantes.map((integrante) => integrante.alias),
      ].join(" "),
    );

    return terminos.every((termino) => texto.includes(termino));
  });

  const visibles = filtradas.slice(0, cantidadVisible);
  const hayMas = visibles.length < filtradas.length;
  const operacionEnCurso = guardando || cambiandoEstado !== null;
  const idListado = `lista-inscripciones-${fecha.id}`;

  async function cambiarEstado(inscripcion: Inscripcion) {
    if (
      cambioEstadoEnCurso.current ||
      guardando ||
      editando ||
      !admiteInscripciones
    ) {
      return;
    }

    const accion = inscripcion.activa ? "retirar" : "reactivar";

    if (
      accion === "retirar" &&
      !window.confirm(
        `¿Retirar a "${inscripcion.nombre}" de esta fecha? Sus datos se conservarán.`,
      )
    ) {
      return;
    }

    cambioEstadoEnCurso.current = true;
    setCambiandoEstado(inscripcion.id);
    setErrorAccion("");

    try {
      await modificarInscripcion(inscripcion, accion);
      setIntento((actual) => actual + 1);
    } catch (error) {
      setErrorAccion(
        error instanceof Error
          ? error.message
          : "No pudimos confirmar el cambio.",
      );
    } finally {
      cambioEstadoEnCurso.current = false;
      setCambiandoEstado(null);
    }
  }

  return (
    <section className="panel inscripciones-panel">
      <div className="cabecera-inscripciones">
        <div>
          <h2>{esIndividual ? "Participantes" : "Equipos"}</h2>
          <p className="texto-secundario">
            {cargando
              ? "Cargando inscripciones…"
              : `${activas.length} ${
                  esIndividual ? "participantes" : "equipos"
                } activos`}
          </p>
        </div>

        <button
          type="button"
          className="boton boton-secundario"
          onClick={() => setIntento((actual) => actual + 1)}
          disabled={cargando || operacionEnCurso}
          aria-label="Actualizar inscripciones"
        >
          <RefreshCw size={17} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {admiteInscripciones && !editando && (
        <form className="formulario-inscripcion" onSubmit={guardar}>
          <fieldset disabled={operacionEnCurso}>
            <div className="campos-inscripcion">
              {!esIndividual && (
                <div className="campo campo-ancho">
                  <label htmlFor={`equipo-${fecha.id}`}>
                    Nombre del equipo
                  </label>
                  <input
                    id={`equipo-${fecha.id}`}
                    value={borrador.nombre}
                    onChange={(event) =>
                      setBorrador((actual) => ({
                        ...actual,
                        nombre: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              )}

              {borrador.integrantes.map((alias, indice) => (
                <div className="campo" key={indice}>
                  <label htmlFor={`alias-${fecha.id}-${indice}`}>
                    {esIndividual
                      ? "Alias del participante"
                      : `Alias del integrante ${indice + 1}`}
                  </label>
                  <input
                    id={`alias-${fecha.id}-${indice}`}
                    value={alias}
                    onChange={(event) =>
                      cambiarIntegrante(indice, event.target.value)
                    }
                    autoComplete="off"
                    required
                  />
                </div>
              ))}
            </div>

            {errorBorrador && (
              <p className="mensaje-error" role="alert">
                El navegador no pudo guardar el borrador. Completá la
                inscripción antes de cerrar esta pantalla.
              </p>
            )}

            {errorFormulario && (
              <p className="mensaje-error" role="alert">
                {errorFormulario}
              </p>
            )}

            {aviso && (
              <p className="mensaje-guardado" role="status">
                {aviso}
              </p>
            )}

            <button type="submit" className="boton boton-principal">
              {guardando ? (
                <LoaderCircle
                  size={17}
                  className="girando"
                  aria-hidden="true"
                />
              ) : (
                <Plus size={17} aria-hidden="true" />
              )}
              {guardando
                ? "Guardando…"
                : esIndividual
                  ? "Anotar participante"
                  : "Anotar equipo"}
            </button>
          </fieldset>
        </form>
      )}

      {editando && admiteInscripciones && (
        <EditarInscripcion
          key={editando.id}
          inscripcion={editando}
          esIndividual={esIndividual}
          onCancelar={() => setEditando(null)}
          onGuardada={() => {
            setEditando(null);
            setIntento((actual) => actual + 1);
          }}
        />
      )}

      {errorAccion && (
        <p className="mensaje-error" role="alert">
          {errorAccion}
        </p>
      )}

      <div className="filtros-inscripciones">
        <div className="campo campo-busqueda-inscripciones">
          <label htmlFor={`buscar-inscripcion-${fecha.id}`}>
            {esIndividual ? "Buscar participante" : "Buscar equipo o integrante"}
          </label>

          <div className="buscador-inscripciones">
            <Search
              size={19}
              className="icono-busqueda-inscripciones"
              aria-hidden="true"
            />

            <input
              id={`buscar-inscripcion-${fecha.id}`}
              type="text"
              inputMode="search"
              enterKeyHint="search"
              value={busqueda}
              onChange={(event) => cambiarBusqueda(event.target.value)}
              placeholder={
                esIndividual ? "Escribí un alias…" : "Nombre del equipo o alias…"
              }
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-controls={idListado}
            />

            {busqueda.length > 0 && (
              <button
                type="button"
                className="limpiar-busqueda-inscripciones"
                onClick={() => cambiarBusqueda("")}
                aria-label="Limpiar búsqueda"
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {retiradas.length > 0 && (
          <label className="opcion-retirados">
            <input
              type="checkbox"
              checked={mostrarRetirados}
              onChange={(event) =>
                cambiarFiltroRetirados(event.target.checked)
              }
            />
            Mostrar retirados ({retiradas.length})
          </label>
        )}
      </div>

      <div id={idListado} aria-busy={cargando}>
        {errorCarga ? (
          <p className="mensaje-error" role="alert">
            {errorCarga}
          </p>
        ) : cargando ? (
          <div className="carga-fechas" role="status">
            <LoaderCircle size={20} className="girando" aria-hidden="true" />
            Cargando listado…
          </div>
        ) : filtradas.length === 0 ? (
          <div className="inscripciones-vacias" role="status">
            {hayBusqueda ? (
              <Search size={25} aria-hidden="true" />
            ) : (
              <Users size={25} aria-hidden="true" />
            )}
            <p>
              {hayBusqueda
                ? "No encontramos inscripciones con esa búsqueda."
                : mostrarRetirados
                  ? "Todavía no hay inscripciones."
                  : "No hay inscripciones activas."}
            </p>
          </div>
        ) : (
          <>
            <ol className="lista-inscripciones">
              {visibles.map((inscripcion, indice) => (
                <li
                  key={inscripcion.id}
                  className={
                    !inscripcion.activa ? "inscripcion-retirada" : ""
                  }
                >
                  <span className="numero-inscripcion" aria-hidden="true">
                    {indice + 1}
                  </span>

                  <div className="datos-inscripcion">
                    <h3>{inscripcion.nombre}</h3>

                    {!esIndividual && (
                      <p className="texto-secundario">
                        {inscripcion.integrantes
                          .map((integrante) => integrante.alias)
                          .join(" · ")}
                      </p>
                    )}

                    {!inscripcion.activa && (
                      <span className="texto-retirado">Retirado</span>
                    )}
                  </div>

                  {admiteInscripciones && (
                    <div className="acciones-inscripcion">
                      {inscripcion.activa && (
                        <button
                          className="boton boton-secundario"
                          type="button"
                          disabled={
                            operacionEnCurso || cargando || editando !== null
                          }
                          onClick={() => {
                            setErrorAccion("");
                            setEditando(inscripcion);
                          }}
                          aria-label={`Editar a ${inscripcion.nombre}`}
                        >
                          Editar
                        </button>
                      )}

                      <button
                        className="boton boton-secundario"
                        type="button"
                        disabled={
                          operacionEnCurso || cargando || editando !== null
                        }
                        onClick={() => void cambiarEstado(inscripcion)}
                        aria-label={`${
                          inscripcion.activa ? "Retirar" : "Reactivar"
                        } a ${inscripcion.nombre}`}
                      >
                        {cambiandoEstado === inscripcion.id
                          ? "Guardando…"
                          : inscripcion.activa
                            ? "Retirar"
                            : "Reactivar"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>

            <div className="pie-lista-inscripciones">
              <p
                className="texto-secundario contador-inscripciones"
                role="status"
                aria-atomic="true"
              >
                Mostrando {visibles.length} de {filtradas.length}
                {hayBusqueda ? " resultados" : " inscripciones"}
              </p>

              {hayMas && (
                <button
                  type="button"
                  className="boton boton-secundario boton-mostrar-mas"
                  onClick={() =>
                    setCantidadVisible((actual) => actual + TAMANO_PAGINA)
                  }
                  aria-controls={idListado}
                >
                  <ChevronDown size={18} aria-hidden="true" />
                  Mostrar más
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}