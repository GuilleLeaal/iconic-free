import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { LoaderCircle, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import type { Fecha } from "../fechas/fechasService";
import { guardarPlanilla, obtenerPlanilla } from "./planillasService";
import type { TipoPlanilla } from "./planillasService";
import "./planillas.css";

type Configuracion = {
  version: number;
  casillas: string[];
};

function cargarBorrador(clave: string): Configuracion | null {
  try {
    const guardado = localStorage.getItem(clave);

    if (!guardado) return null;

    const datos: unknown = JSON.parse(guardado);

    if (
      typeof datos === "object" &&
      datos !== null &&
      "version" in datos &&
      "casillas" in datos &&
      typeof datos.version === "number" &&
      Number.isInteger(datos.version) &&
      datos.version >= 0 &&
      Array.isArray(datos.casillas) &&
      datos.casillas.length > 0 &&
      datos.casillas.every((casilla) => typeof casilla === "string")
    ) {
      return {
        version: datos.version,
        casillas: datos.casillas,
      };
    }
  } catch {
    // El formulario puede usarse aunque no haya almacenamiento local.
  }

  return null;
}

function sonIguales(a: Configuracion, b: Configuracion): boolean {
  return (
    a.version === b.version &&
    a.casillas.length === b.casillas.length &&
    a.casillas.every((casilla, indice) => casilla === b.casillas[indice])
  );
}

function EditorPlanilla({
  fecha,
  tipo,
  titulo,
  descripcion,
}: {
  fecha: Fecha;
  tipo: TipoPlanilla;
  titulo: string;
  descripcion: string;
}) {
  const claveBorrador = `iconic:planilla:${fecha.id}:${tipo}`;
  const permiteCambios =
    fecha.estado === "borrador" || fecha.estado === "inscripciones";

  const [guardada, setGuardada] = useState<Configuracion | null>(null);
  const [editor, setEditor] = useState<Configuracion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");
  const [errorFormulario, setErrorFormulario] = useState("");
  const [errorBorrador, setErrorBorrador] = useState(false);
  const [aviso, setAviso] = useState("");
  const [intento, setIntento] = useState(0);

  const guardadoEnCurso = useRef(false);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setCargando(true);
      setErrorCarga("");

      try {
        const datos = await obtenerPlanilla(fecha.id, tipo);

        if (cancelado) return;

        const configuracion: Configuracion = datos
          ? { version: datos.version, casillas: datos.casillas }
          : { version: 0, casillas: ["Casilla 1"] };

        setGuardada(configuracion);

        // Actualizar consulta la base sin borrar el trabajo pendiente.
        setEditor(
          (actual) => actual ?? cargarBorrador(claveBorrador) ?? configuracion,
        );
      } catch (error) {
        if (!cancelado) {
          setErrorCarga(
            error instanceof Error
              ? error.message
              : "No pudimos cargar la planilla.",
          );
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    }

    void cargar();

    return () => {
      cancelado = true;
    };
  }, [fecha.id, tipo, claveBorrador, intento]);

  useEffect(() => {
    if (!editor || !guardada || cargando || errorCarga) return;

    try {
      if (sonIguales(editor, guardada)) {
        localStorage.removeItem(claveBorrador);
      } else {
        localStorage.setItem(claveBorrador, JSON.stringify(editor));
      }

      setErrorBorrador(false);
    } catch {
      setErrorBorrador(true);
    }
  }, [editor, guardada, cargando, errorCarga, claveBorrador]);

  const pendiente =
    editor !== null && guardada !== null && !sonIguales(editor, guardada);

  const desactualizada =
    editor !== null && guardada !== null && editor.version !== guardada.version;

  function cambiarCasilla(indice: number, nombre: string) {
    setAviso("");
    setErrorFormulario("");

    setEditor((actual) =>
      actual
        ? {
            ...actual,
            casillas: actual.casillas.map((casilla, posicion) =>
              posicion === indice ? nombre : casilla,
            ),
          }
        : actual,
    );
  }

  function agregarCasilla() {
    setAviso("");
    setErrorFormulario("");

    setEditor((actual) =>
      actual
        ? {
            ...actual,
            casillas: [
              ...actual.casillas,
              `Casilla ${actual.casillas.length + 1}`,
            ],
          }
        : actual,
    );
  }

  function quitarCasilla(indice: number) {
    setAviso("");
    setErrorFormulario("");

    setEditor((actual) =>
      actual && actual.casillas.length > 1
        ? {
            ...actual,
            casillas: actual.casillas.filter(
              (_, posicion) => posicion !== indice,
            ),
          }
        : actual,
    );
  }

  function usarGuardada() {
    if (!guardada) return;

    if (
      pendiente &&
      !window.confirm(
        "¿Descartar los cambios pendientes y usar la configuración cargada de la base?",
      )
    ) {
      return;
    }

    setEditor({
      version: guardada.version,
      casillas: [...guardada.casillas],
    });
    setErrorFormulario("");
    setAviso("");
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !editor ||
      !guardada ||
      guardadoEnCurso.current ||
      cargando ||
      errorCarga ||
      desactualizada ||
      !permiteCambios
    ) {
      return;
    }

    setErrorFormulario("");
    setAviso("");

    const casillas = editor.casillas.map((nombre) => nombre.trim());

    if (casillas.some((nombre) => !nombre)) {
      setErrorFormulario("Todas las casillas deben tener un nombre.");
      return;
    }

    guardadoEnCurso.current = true;
    setGuardando(true);

    try {
      await guardarPlanilla(fecha.id, tipo, casillas, editor.version);

      const configuracion: Configuracion = {
        version: editor.version + 1,
        casillas,
      };

      setGuardada(configuracion);
      setEditor(configuracion);
      setAviso("Configuración guardada.");
    } catch (error) {
      setErrorFormulario(
        error instanceof Error
          ? error.message
          : "No pudimos confirmar el guardado.",
      );

      // Conservamos el borrador y consultamos la versión actual.
      setCargando(true);
      setIntento((actual) => actual + 1);
    } finally {
      guardadoEnCurso.current = false;
      setGuardando(false);
    }
  }

  const configuracionVisible = permiteCambios ? editor : guardada;

  return (
    <section className="editor-planilla">
      <div className="cabecera-editor-planilla">
        <div>
          <h3>{titulo}</h3>
          <p className="texto-secundario">{descripcion}</p>
        </div>

        <button
          type="button"
          className="boton boton-secundario"
          disabled={cargando || guardando}
          onClick={() => {
            setAviso("");
            setCargando(true);
            setIntento((actual) => actual + 1);
          }}
          aria-label={`Actualizar planilla de ${titulo.toLowerCase()}`}
        >
          <RefreshCw size={17} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {errorCarga ? (
        <p className="mensaje-error" role="alert">
          {errorCarga} Usá “Actualizar” para volver a cargar.
        </p>
      ) : cargando ? (
        <div className="carga-planilla" role="status">
          <LoaderCircle size={20} className="girando" aria-hidden="true" />
          Cargando configuración…
        </div>
      ) : configuracionVisible && guardada ? (
        <>
          <p className="estado-planilla">
            {guardada.version === 0
              ? "Todavía no se guardó una configuración."
              : `Configuración guardada · ${guardada.casillas.length} ${
                  guardada.casillas.length === 1 ? "casilla" : "casillas"
                }`}

            {permiteCambios && pendiente && (
              <span className="planilla-pendiente">Cambios pendientes</span>
            )}
          </p>

          {permiteCambios && desactualizada && (
            <p className="mensaje-error" role="alert">
              La configuración guardada tiene otra versión. Conservamos tus
              cambios, pero no se pueden guardar sobre esa versión. Usá
              “Descartar cambios” para cargar la configuración consultada.
            </p>
          )}

          {!permiteCambios && (
            <p className="texto-secundario">
              La planilla base ya no se puede modificar.
            </p>
          )}

          <form onSubmit={guardar}>
            <fieldset disabled={guardando || !permiteCambios || desactualizada}>
              <ol className="lista-casillas">
                {configuracionVisible.casillas.map((nombre, indice) => (
                  <li key={indice}>
                    <div className="campo">
                      <label htmlFor={`casilla-${fecha.id}-${tipo}-${indice}`}>
                        Casilla {indice + 1}
                      </label>
                      <input
                        id={`casilla-${fecha.id}-${tipo}-${indice}`}
                        value={nombre}
                        onChange={(event) =>
                          cambiarCasilla(indice, event.target.value)
                        }
                        autoComplete="off"
                        required
                      />
                    </div>

                    <span className="rango-casilla">0–4</span>

                    {permiteCambios && (
                      <button
                        type="button"
                        className="boton boton-secundario quitar-casilla"
                        disabled={configuracionVisible.casillas.length === 1}
                        onClick={() => quitarCasilla(indice)}
                        aria-label={`Quitar casilla ${indice + 1}`}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ol>

              {permiteCambios && (
                <button
                  type="button"
                  className="boton boton-secundario agregar-casilla"
                  onClick={agregarCasilla}
                >
                  <Plus size={17} aria-hidden="true" />
                  Agregar casilla
                </button>
              )}
            </fieldset>

            {permiteCambios && errorBorrador && (
              <p className="mensaje-error" role="alert">
                El navegador no pudo guardar el borrador. Guardá la
                configuración antes de cerrar esta pantalla.
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

            {permiteCambios && (
              <div className="acciones-planilla">
                <button
                  type="submit"
                  className="boton boton-principal"
                  disabled={
                    guardando ||
                    desactualizada ||
                    (!pendiente && guardada.version > 0)
                  }
                >
                  {guardando ? (
                    <LoaderCircle
                      size={17}
                      className="girando"
                      aria-hidden="true"
                    />
                  ) : (
                    <Save size={17} aria-hidden="true" />
                  )}
                  {guardando ? "Guardando…" : "Guardar configuración"}
                </button>

                {pendiente && (
                  <button
                    type="button"
                    className="boton boton-secundario"
                    disabled={guardando}
                    onClick={usarGuardada}
                  >
                    Descartar cambios
                  </button>
                )}
              </div>
            )}
          </form>
        </>
      ) : null}
    </section>
  );
}

export default function PlanillasPanel({ fecha }: { fecha: Fecha }) {
  return (
    <section className="panel planillas-panel">
      <h2>Planilla de clasificatorias</h2>
      <p className="texto-secundario">
        Configurá las casillas que van a puntuar los jurados si hay
        clasificatorias. Cada casilla se valora de 0 a 4.
      </p>

      <EditorPlanilla
        key={`${fecha.id}:clasificatorias`}
        fecha={fecha}
        tipo="clasificatorias"
        titulo="Clasificatorias"
        descripcion="La misma configuración para todos los grupos."
      />
    </section>
  );
}
