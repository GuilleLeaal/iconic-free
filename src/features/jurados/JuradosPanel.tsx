import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";

import type { Fecha } from "../fechas/fechasService";
import {
  configurarJurado,
  listarAsignaciones,
  listarJurados,
} from "./juradosService";
import type {
  ApartadoJurado,
  AsignacionJurado,
  JuradoDisponible,
} from "./juradosService";
import "./jurados.css";

const APARTADOS: {
  id: ApartadoJurado;
  nombre: string;
}[] = [
  { id: "clasi_a", nombre: "Clasis A" },
  { id: "clasi_b", nombre: "Clasis B" },
  { id: "clasi_c", nombre: "Clasis C" },
];

export default function JuradosPanel({ fecha }: { fecha: Fecha }) {
  const [jurados, setJurados] = useState<JuradoDisponible[]>([]);
  const [asignaciones, setAsignaciones] = useState<AsignacionJurado[]>([]);
  const [selecciones, setSelecciones] = useState<
    Partial<Record<ApartadoJurado, string>>
  >({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<ApartadoJurado | null>(null);
  const [errorCarga, setErrorCarga] = useState("");
  const [errorAccion, setErrorAccion] = useState("");
  const [aviso, setAviso] = useState("");
  const [intento, setIntento] = useState(0);
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(0);
  const [hayMas, setHayMas] = useState(false);

  const operacionEnCurso = useRef(false);

  const permiteCambios =
    fecha.estado === "borrador" || fecha.estado === "inscripciones";

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setCargando(true);
      setErrorCarga("");

      try {
        const [cuentas, asignados] = await Promise.all([
          listarJurados(fecha.competencia_id, busqueda, pagina),
          listarAsignaciones(fecha.id),
        ]);

        if (!cancelado) {
          setJurados(cuentas.filas);
          setHayMas(cuentas.hay_mas);
          setAsignaciones(asignados);
        }
      } catch (error) {
        if (!cancelado) {
          setErrorCarga(
            error instanceof Error
              ? error.message
              : "No pudimos cargar los jurados.",
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
  }, [fecha.id, fecha.competencia_id, intento, busqueda, pagina]);

  async function cambiarAsignacion(
    apartado: ApartadoJurado,
    juradoId: string,
    asignar: boolean,
  ) {
    if (
      operacionEnCurso.current ||
      cargando ||
      errorCarga ||
      !permiteCambios ||
      !juradoId
    ) {
      return;
    }

    operacionEnCurso.current = true;
    setGuardando(apartado);
    setErrorAccion("");
    setAviso("");

    // Se mantienen bloqueadas las acciones hasta releer la base.
    setCargando(true);

    try {
      await configurarJurado(fecha.id, juradoId, apartado, asignar);

      setSelecciones((actual) => ({
        ...actual,
        [apartado]: "",
      }));

      setAviso(asignar ? "Jurado asignado." : "Asignación quitada.");
    } catch (error) {
      setErrorAccion(
        error instanceof Error
          ? error.message
          : "No pudimos confirmar el cambio.",
      );
    } finally {
      // También actualizamos después de un error: la operación
      // podría haberse guardado antes de perder la conexión.
      setIntento((actual) => actual + 1);
      setGuardando(null);
      operacionEnCurso.current = false;
    }
  }

  return (
    <section className="panel jurados-panel">
      <div className="cabecera-jurados">
        <div>
          <h2>Jurados de clasificatorias</h2>
          <p className="texto-secundario">
            Asigná los jurados de cada grupo si la fecha necesita
            clasificatorias.
          </p>
        </div>

        <button
          type="button"
          className="boton boton-secundario"
          disabled={cargando || guardando !== null}
          onClick={() => setIntento((actual) => actual + 1)}
        >
          <RefreshCw size={17} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {!permiteCambios && (
        <p className="aviso-jurados">
          Las asignaciones quedan bloqueadas desde el inicio de clasis para conservar sus jurados y puntuaciones. Podés preparar vínculos para próximas fechas desde Administrar cuentas.
        </p>
      )}

      {errorAccion && (
        <p className="mensaje-error" role="alert">
          {errorAccion}
        </p>
      )}

      {aviso && (
        <p className="mensaje-guardado" role="status">
          {aviso}
        </p>
      )}

      <label className="campo">Buscar jurados vinculados<input type="search" value={busqueda} onChange={e => { setBusqueda(e.target.value); setPagina(0); }} /></label>
      <div className="acciones-formulario"><button className="boton boton-secundario" disabled={pagina === 0 || cargando} onClick={() => setPagina(p => p - 1)}>Anterior</button><span>Página {pagina + 1}</span><button className="boton boton-secundario" disabled={!hayMas || cargando} onClick={() => setPagina(p => p + 1)}>Siguiente</button></div>
      {errorCarga ? (
        <p className="mensaje-error" role="alert">
          {errorCarga} Usá “Actualizar” para volver a cargar.
        </p>
      ) : cargando ? (
        <div className="carga-jurados" role="status">
          <LoaderCircle size={20} className="girando" aria-hidden="true" />
          {guardando !== null
            ? "Guardando asignación…"
            : "Actualizando jurados…"}
        </div>
      ) : (
        <>
          {jurados.length === 0 && (
            <p className="aviso-jurados">
              No hay jurados para esta búsqueda. Invitá o vinculá una cuenta desde Administrar cuentas y pedile que acepte el vínculo antes de asignarla.
            </p>
          )}

          <div className="grilla-jurados">
            {APARTADOS.map((apartado) => {
              const asignados = asignaciones.filter(
                (item) => item.apartado === apartado.id,
              );

              const disponibles = jurados.filter(
                (jurado) =>
                  !asignados.some((item) => item.jurado_id === jurado.id),
              );

              const limite = fecha.jurados_por_grupo_clasi;

              const completo = asignados.length === limite;
              const excedido = asignados.length > limite;
              const seleccion = selecciones[apartado.id] ?? "";

              const seleccionValida = disponibles.some(
                (jurado) => jurado.id === seleccion,
              );

              return (
                <section className="apartado-jurados" key={apartado.id}>
                  <div className="titulo-apartado-jurados">
                    <h3>{apartado.nombre}</h3>

                    <span
                      className={`contador-jurados ${
                        excedido
                          ? "contador-jurados-excedido"
                          : completo
                            ? "contador-jurados-completo"
                            : ""
                      }`}
                    >
                      {asignados.length}/{limite}
                    </span>
                  </div>

                  <p className="texto-secundario descripcion-apartado-jurados">
                    Completá este grupo si la fecha lo necesita.
                  </p>

                  {excedido && (
                    <p className="mensaje-error">
                      Hay más jurados que los configurados. Quitá las
                      asignaciones sobrantes antes de comenzar.
                    </p>
                  )}

                  {asignados.length === 0 ? (
                    <p className="jurados-sin-asignar">
                      Sin jurados asignados.
                    </p>
                  ) : (
                    <ul className="lista-jurados">
                      {asignados.map((asignacion) => {
                        const cuenta = jurados.find(
                          (jurado) => jurado.id === asignacion.jurado_id,
                        );

                        const nombre = cuenta?.nombre || asignacion.perfil?.nombre || "Cuenta no disponible";

                        return (
                          <li key={asignacion.id}>
                            <span>{nombre}</span>

                            {permiteCambios && (
                              <button
                                type="button"
                                className="boton boton-secundario"
                                onClick={() =>
                                  void cambiarAsignacion(
                                    apartado.id,
                                    asignacion.jurado_id,
                                    false,
                                  )
                                }
                                aria-label={`Quitar a ${nombre} de ${apartado.nombre}`}
                              >
                                Quitar
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {permiteCambios && asignados.length < limite && (
                    <div className="asignar-jurado">
                      <label htmlFor={`jurado-${fecha.id}-${apartado.id}`}>
                        Agregar jurado
                      </label>

                      <select
                        id={`jurado-${fecha.id}-${apartado.id}`}
                        value={seleccionValida ? seleccion : ""}
                        disabled={disponibles.length === 0}
                        onChange={(event) =>
                          setSelecciones((actual) => ({
                            ...actual,
                            [apartado.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">
                          {disponibles.length === 0
                            ? "No hay cuentas disponibles"
                            : "Seleccioná una cuenta"}
                        </option>

                        {disponibles.map((jurado) => (
                          <option key={jurado.id} value={jurado.id}>
                            {jurado.nombre}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        className="boton boton-secundario"
                        disabled={!seleccionValida}
                        onClick={() =>
                          void cambiarAsignacion(apartado.id, seleccion, true)
                        }
                      >
                        <Plus size={17} aria-hidden="true" />
                        Asignar
                      </button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
