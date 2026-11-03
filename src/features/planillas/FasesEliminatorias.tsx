import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { LoaderCircle, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import type { Fecha } from "../fechas/fechasService";
import {
  guardarPlanillaFase,
  obtenerPlanillaFase,
} from "./fasesService";
import type {
  ConfiguracionFase,
  FaseEliminatoria,
  RondaPlanilla,
} from "./fasesService";
import "./fases.css";

type EstadoEditor = {
  version: number;
  configuracion: ConfiguracionFase;
};

type SeccionRondas = "rondas" | "replica";

const FASES: { id: FaseEliminatoria; nombre: string }[] = [
  { id: "octavos", nombre: "Octavos" },
  { id: "cuartos", nombre: "Cuartos" },
  { id: "semifinal", nombre: "Semifinal" },
  { id: "final", nombre: "Final" },
];

function nuevaRonda(nombre: string): RondaPlanilla {
  return {
    nombre,
    casillas: ["Casilla 1"],
  };
}

function configuracionInicial(): EstadoEditor {
  return {
    version: 0,
    configuracion: {
      rondas: [nuevaRonda("Ronda 1")],
      replica: [nuevaRonda("Réplica")],
    },
  };
}

function esListaRondas(valor: unknown): valor is RondaPlanilla[] {
  return (
    Array.isArray(valor) &&
    valor.length > 0 &&
    valor.every(
      (ronda: unknown) =>
        typeof ronda === "object" &&
        ronda !== null &&
        "nombre" in ronda &&
        typeof ronda.nombre === "string" &&
        "casillas" in ronda &&
        Array.isArray(ronda.casillas) &&
        ronda.casillas.length > 0 &&
        ronda.casillas.every((casilla) => typeof casilla === "string"),
    )
  );
}

function cargarBorrador(clave: string): EstadoEditor | null {
  try {
    const guardado = localStorage.getItem(clave);
    if (!guardado) return null;

    const datos: unknown = JSON.parse(guardado);

    if (
      typeof datos !== "object" ||
      datos === null ||
      !("version" in datos) ||
      typeof datos.version !== "number" ||
      !Number.isInteger(datos.version) ||
      datos.version < 0 ||
      !("configuracion" in datos) ||
      typeof datos.configuracion !== "object" ||
      datos.configuracion === null
    ) {
      return null;
    }

    const configuracion = datos.configuracion;

    if (
      !("rondas" in configuracion) ||
      !("replica" in configuracion) ||
      !esListaRondas(configuracion.rondas) ||
      !esListaRondas(configuracion.replica)
    ) {
      return null;
    }

    return {
      version: datos.version,
      configuracion: {
        rondas: configuracion.rondas,
        replica: configuracion.replica,
      },
    };
  } catch {
    return null;
  }
}

function sonIguales(a: EstadoEditor, b: EstadoEditor): boolean {
  return (
    a.version === b.version &&
    JSON.stringify(a.configuracion) === JSON.stringify(b.configuracion)
  );
}

function EditorFase({
  fecha,
  fase,
}: {
  fecha: Fecha;
  fase: FaseEliminatoria;
}) {
  const clave = `iconic:planilla-fase:${fecha.id}:${fase}`;
  const permiteCambios =
    fecha.estado === "borrador" || fecha.estado === "inscripciones";

  const [guardada, setGuardada] = useState<EstadoEditor | null>(null);
  const [editor, setEditor] = useState<EstadoEditor | null>(null);
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
        const datos = await obtenerPlanillaFase(fecha.id, fase);
        if (cancelado) return;

        const estado = datos
          ? {
              version: datos.version,
              configuracion: datos.configuracion,
            }
          : configuracionInicial();

        setGuardada(estado);
        setEditor((actual) => actual ?? cargarBorrador(clave) ?? estado);
      } catch (error) {
        if (!cancelado) {
          setErrorCarga(
            error instanceof Error
              ? error.message
              : "No pudimos cargar esta fase.",
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
  }, [fecha.id, fase, clave, intento]);

  useEffect(() => {
    if (!editor || !guardada || cargando || errorCarga) return;

    try {
      if (sonIguales(editor, guardada)) {
        localStorage.removeItem(clave);
      } else {
        localStorage.setItem(clave, JSON.stringify(editor));
      }
      setErrorBorrador(false);
    } catch {
      setErrorBorrador(true);
    }
  }, [editor, guardada, cargando, errorCarga, clave]);

  const pendiente =
    editor !== null && guardada !== null && !sonIguales(editor, guardada);

  const desactualizada =
    editor !== null &&
    guardada !== null &&
    editor.version !== guardada.version;

  function modificarSeccion(
    seccion: SeccionRondas,
    modificar: (rondas: RondaPlanilla[]) => RondaPlanilla[],
  ) {
    setAviso("");
    setErrorFormulario("");

    setEditor((actual) =>
      actual
        ? {
            ...actual,
            configuracion: {
              ...actual.configuracion,
              [seccion]: modificar(actual.configuracion[seccion]),
            },
          }
        : actual,
    );
  }

  function modificarRonda(
    seccion: SeccionRondas,
    indice: number,
    modificar: (ronda: RondaPlanilla) => RondaPlanilla,
  ) {
    modificarSeccion(seccion, (rondas) =>
      rondas.map((ronda, posicion) =>
        posicion === indice ? modificar(ronda) : ronda,
      ),
    );
  }

  function descartar() {
    if (!guardada) return;

    if (
      pendiente &&
      !window.confirm(
        "¿Descartar los cambios pendientes de esta fase y usar la configuración cargada de la base?",
      )
    ) {
      return;
    }

    setEditor(guardada);
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

    const normalizar = (rondas: RondaPlanilla[]) =>
      rondas.map((ronda) => ({
        nombre: ronda.nombre.trim(),
        casillas: ronda.casillas.map((casilla) => casilla.trim()),
      }));

    const configuracion: ConfiguracionFase = {
      rondas: normalizar(editor.configuracion.rondas),
      replica: normalizar(editor.configuracion.replica),
    };

    const todasLasRondas = [
      ...configuracion.rondas,
      ...configuracion.replica,
    ];

    if (
      todasLasRondas.some(
        (ronda) =>
          !ronda.nombre ||
          ronda.casillas.some((casilla) => !casilla),
      )
    ) {
      setErrorFormulario("Completá los nombres de las rondas y las casillas.");
      return;
    }

    guardadoEnCurso.current = true;
    setGuardando(true);

    try {
      await guardarPlanillaFase(
        fecha.id,
        fase,
        configuracion,
        editor.version,
      );

      const estado: EstadoEditor = {
        version: editor.version + 1,
        configuracion,
      };

      setGuardada(estado);
      setEditor(estado);
      setAviso("Configuración guardada.");
    } catch (error) {
      setErrorFormulario(
        error instanceof Error
          ? error.message
          : "No pudimos confirmar el guardado.",
      );

      setCargando(true);
      setIntento((actual) => actual + 1);
    } finally {
      guardadoEnCurso.current = false;
      setGuardando(false);
    }
  }

  const visible = permiteCambios ? editor : guardada;

  return (
    <div className="contenido-fase">
      <button
        type="button"
        className="boton boton-secundario"
        disabled={cargando || guardando}
        onClick={() => {
          setAviso("");
          setCargando(true);
          setIntento((actual) => actual + 1);
        }}
      >
        <RefreshCw size={17} aria-hidden="true" />
        Actualizar esta fase
      </button>

      {errorCarga ? (
        <p className="mensaje-error" role="alert">
          {errorCarga} Usá “Actualizar esta fase” para reintentar.
        </p>
      ) : cargando ? (
        <div className="carga-planilla" role="status">
          <LoaderCircle size={20} className="girando" aria-hidden="true" />
          Cargando configuración…
        </div>
      ) : visible && guardada ? (
        <>
          <p className="estado-planilla">
            {guardada.version === 0
              ? "Esta fase todavía no tiene una configuración guardada."
              : "Configuración guardada."}

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
              La configuración base ya no se puede modificar.
            </p>
          )}

          <form onSubmit={guardar}>
            <fieldset
              disabled={guardando || !permiteCambios || desactualizada}
            >
              {(["rondas", "replica"] as const).map((seccion) => (
                <section className="seccion-rondas" key={seccion}>
                  <h4>
                    {seccion === "rondas"
                      ? "Rondas de la batalla"
                      : "Rondas de réplica"}
                  </h4>

                  {visible.configuracion[seccion].map((ronda, indice) => (
                    <div className="tarjeta-ronda" key={indice}>
                      <div className="cabecera-ronda">
                        <div className="campo">
                          <label
                            htmlFor={`${fecha.id}-${fase}-${seccion}-${indice}-nombre`}
                          >
                            Nombre de la ronda {indice + 1}
                          </label>

                          <input
                            id={`${fecha.id}-${fase}-${seccion}-${indice}-nombre`}
                            value={ronda.nombre}
                            onChange={(event) =>
                              modificarRonda(seccion, indice, (actual) => ({
                                ...actual,
                                nombre: event.target.value,
                              }))
                            }
                            required
                          />
                        </div>

                        {permiteCambios && (
                          <button
                            type="button"
                            className="boton boton-secundario"
                            disabled={
                              visible.configuracion[seccion].length === 1
                            }
                            onClick={() =>
                              modificarSeccion(seccion, (rondas) =>
                                rondas.filter((_, posicion) => posicion !== indice),
                              )
                            }
                            aria-label={`Quitar ronda ${indice + 1} de ${
                              seccion === "rondas" ? "la batalla" : "réplica"
                            }`}
                          >
                            <Trash2 size={17} aria-hidden="true" />
                            Quitar ronda
                          </button>
                        )}
                      </div>

                      <ol className="lista-casillas">
                        {ronda.casillas.map((casilla, posicion) => (
                          <li key={posicion}>
                            <div className="campo">
                              <label
                                htmlFor={`${fecha.id}-${fase}-${seccion}-${indice}-${posicion}`}
                              >
                                Casilla {posicion + 1}
                              </label>

                              <input
                                id={`${fecha.id}-${fase}-${seccion}-${indice}-${posicion}`}
                                value={casilla}
                                onChange={(event) =>
                                  modificarRonda(seccion, indice, (actual) => ({
                                    ...actual,
                                    casillas: actual.casillas.map((nombre, numero) =>
                                      numero === posicion
                                        ? event.target.value
                                        : nombre,
                                    ),
                                  }))
                                }
                                required
                              />
                            </div>

                            <span className="rango-casilla">0–4</span>

                            {permiteCambios && (
                              <button
                                type="button"
                                className="boton boton-secundario quitar-casilla"
                                disabled={ronda.casillas.length === 1}
                                onClick={() =>
                                  modificarRonda(seccion, indice, (actual) => ({
                                    ...actual,
                                    casillas: actual.casillas.filter(
                                      (_, numero) => numero !== posicion,
                                    ),
                                  }))
                                }
                                aria-label={`Quitar casilla ${posicion + 1} de ${
                                  ronda.nombre || `la ronda ${indice + 1}`
                                }`}
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
                          onClick={() =>
                            modificarRonda(seccion, indice, (actual) => ({
                              ...actual,
                              casillas: [
                                ...actual.casillas,
                                `Casilla ${actual.casillas.length + 1}`,
                              ],
                            }))
                          }
                        >
                          <Plus size={17} aria-hidden="true" />
                          Agregar casilla
                        </button>
                      )}
                    </div>
                  ))}

                  {permiteCambios && (
                    <button
                      type="button"
                      className="boton boton-secundario"
                      onClick={() =>
                        modificarSeccion(seccion, (rondas) => [
                          ...rondas,
                          nuevaRonda(`Ronda ${rondas.length + 1}`),
                        ])
                      }
                    >
                      <Plus size={17} aria-hidden="true" />
                      Agregar ronda
                    </button>
                  )}
                </section>
              ))}
            </fieldset>

            {permiteCambios && errorBorrador && (
              <p className="mensaje-error" role="alert">
                El navegador no pudo guardar el borrador. Guardá esta fase
                antes de cerrar la pantalla.
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
                  {guardando ? "Guardando…" : "Guardar esta fase"}
                </button>

                {pendiente && (
                  <button
                    type="button"
                    className="boton boton-secundario"
                    disabled={guardando}
                    onClick={descartar}
                  >
                    Descartar cambios
                  </button>
                )}
              </div>
            )}
          </form>
        </>
      ) : null}
    </div>
  );
}

export default function FasesEliminatorias({ fecha }: { fecha: Fecha }) {
  return (
    <div className="fases-eliminatorias">
      <h3>Eliminatorias</h3>
      <p className="texto-secundario">
        Cada fase tiene sus propias rondas, casillas y configuración de réplica.
      </p>

      {FASES.map((fase) => (
        <details className="desplegable-fase" key={`${fecha.id}:${fase.id}`}>
          <summary>{fase.nombre}</summary>
          <EditorFase fecha={fecha} fase={fase.id} />
        </details>
      ))}
    </div>
  );
}