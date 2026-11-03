import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play, RefreshCw } from "lucide-react";

import type { Fecha } from "../fechas/fechasService";
import JuradosPanel from "../jurados/JuradosPanel";
import PlanillasPanel from "../planillas/PlanillasPanel";
import {
  cargarClasificatorias,
  iniciarClasificatorias,
} from "./clasificatoriasService";
import type { EstadoClasificatorias } from "./clasificatoriasService";
import "./clasificatorias.css";

export default function ClasificatoriasPanel({
  fecha,
  onFechaActualizada,
}: {
  fecha: Fecha;
  onFechaActualizada: (fecha: Fecha) => void;
}) {
  const [datos, setDatos] = useState<EstadoClasificatorias | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");
  const [errorAccion, setErrorAccion] = useState("");
  const [aviso, setAviso] = useState("");
  const [intento, setIntento] = useState(0);

  const operacionEnCurso = useRef(false);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setCargando(true);
      setErrorCarga("");

      try {
        const resultado = await cargarClasificatorias(fecha.id);

        if (!cancelado) {
          setDatos(resultado);
          onFechaActualizada(resultado.fecha);
        }
      } catch (error) {
        if (!cancelado) {
          setErrorCarga(
            error instanceof Error
              ? error.message
              : "No pudimos cargar las clasificatorias.",
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
  }, [fecha.id, intento, onFechaActualizada]);

  const necesitaClasis = datos?.sorteo?.plan.tipo === "clasificatorias";

  const permiteInicio =
    necesitaClasis &&
    !datos?.clasificatoria &&
    (datos?.fecha.estado === "borrador" ||
      datos?.fecha.estado === "inscripciones");

  async function ejecutar(operacion: () => Promise<void>, mensaje: string) {
    if (operacionEnCurso.current || cargando || errorCarga) return;

    operacionEnCurso.current = true;
    setGuardando(true);
    setCargando(true);
    setErrorAccion("");
    setAviso("");

    try {
      await operacion();
      setAviso(mensaje);
    } catch (error) {
      setErrorAccion(
        error instanceof Error
          ? error.message
          : "No pudimos confirmar la operación.",
      );
    } finally {
      setIntento((actual) => actual + 1);
      setGuardando(false);
      operacionEnCurso.current = false;
    }
  }

  function comenzar() {
    if (!permiteInicio) return;

    if (
      !window.confirm(
        "¿Comenzar las clasificatorias? Se guardarán los grupos, participantes, jurados y casillas. Todas las tandas quedarán disponibles. Los jurados podrán registrar altas desde sus tarjetas.",
      )
    ) {
      return;
    }

    void ejecutar(
      () => iniciarClasificatorias(fecha.id),
      "Clasificatorias iniciadas.",
    );
  }

  return (
    <>
      <section className="panel clasificatorias-panel">
        <div className="cabecera-clasificatorias">
          <div>
            <h2>Clasificatorias</h2>
            <p className="texto-secundario">
              Grupos, tandas y estado de las votaciones.
            </p>
          </div>

          <button
            type="button"
            className="boton boton-secundario"
            disabled={cargando || guardando}
            onClick={() => {
              setCargando(true);
              setIntento((actual) => actual + 1);
            }}
          >
            <RefreshCw size={17} aria-hidden="true" />
            Actualizar
          </button>
        </div>

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

        {errorCarga ? (
          <p className="mensaje-error" role="alert">
            {errorCarga} Usá “Actualizar” para reintentar.
          </p>
        ) : cargando ? (
          <div className="carga-clasificatorias" role="status">
            <LoaderCircle size={20} className="girando" aria-hidden="true" />
            {guardando ? "Guardando…" : "Cargando…"}
          </div>
        ) : !datos?.clasificatoria ? (
          <div className="inicio-clasificatorias">
            <p className="texto-secundario">
              {!datos?.sorteo
                ? "Generá el sorteo para saber si la fecha necesita clasificatorias."
                : !necesitaClasis
                  ? "Esta fecha pasa directamente a su fase inicial."
                  : permiteInicio
                    ? "Completá los jurados de los grupos necesarios y guardá la planilla antes de comenzar."
                    : "La fecha no admite iniciar clasificatorias."}
            </p>

            {necesitaClasis && (
              <p className="resumen-clasificatorias">
                {datos?.sorteo?.plan.total} inscripciones · Grupos{" "}
                {datos?.sorteo?.plan.grupos
                  ?.map((grupo) => grupo.nombre)
                  .join(", ")}
                {" · "}
                {datos?.sorteo?.plan.clasifican} lugares para eliminatorias
              </p>
            )}

            {permiteInicio && (
              <button
                type="button"
                className="boton boton-principal"
                onClick={comenzar}
              >
                <Play size={17} aria-hidden="true" />
                Comenzar clasificatorias
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="resumen-clasificatorias">
              <p>
                {datos.clasificatoria.estado === "en_curso"
                  ? "Clasificatorias en curso"
                  : "Clasificatorias finalizadas"}
                {" · "}
                {datos.clasificatoria.clasifican} lugares para eliminatorias
              </p>

              <p className="texto-secundario">
                Casillas: {datos.clasificatoria.casillas.join(" · ")}
              </p>
            </div>

            {datos.grupos.map((grupo) => {
              const jurados = datos.jurados.filter(
                (jurado) => jurado.grupo_id === grupo.id,
              );

              const tandas = datos.tandas
                .filter((tanda) => tanda.grupo_id === grupo.id)
                .sort((a, b) => a.numero - b.numero);

              const participantes = tandas.reduce(
                (total, tanda) => total + tanda.entradas.length,
                0,
              );

              const finalizadas = tandas.filter(
                (tanda) => tanda.estado === "finalizada",
              ).length;

              return (
                <section className="grupo-clasificatoria" key={grupo.id}>
                  <h3>Clasis {grupo.nombre}</h3>

                  <p className="texto-secundario">
                    {participantes} inscripciones · {finalizadas} de{" "}
                    {tandas.length} tandas finalizadas
                  </p>

                  <p className="jurados-grupo-clasi">
                    Jurados:{" "}
                    {jurados.map((jurado) => jurado.nombre).join(" · ")}
                  </p>

                  <div className="grilla-tandas-clasi">
                    {tandas.map((tanda) => {
                      const votos = datos.votaciones.filter(
                        (voto) => voto.tanda_id === tanda.id,
                      );

                      const terminados = jurados.filter((jurado) =>
                        votos.some(
                          (voto) =>
                            voto.jurado_id === jurado.jurado_id &&
                            voto.estado === "finalizada",
                        ),
                      ).length;

                      return (
                        <article
                          className={`tanda-clasi ${
                            tanda.estado === "en_curso"
                              ? "tanda-clasi-abierta"
                              : ""
                          }`}
                          key={tanda.id}
                        >
                          <div className="cabecera-tanda-clasi">
                            <h4>Tanda {tanda.numero}</h4>

                            <span>
                              {tanda.estado === "pendiente"
                                ? "Pendiente"
                                : tanda.estado === "en_curso"
                                  ? "Disponible"
                                  : "Finalizada"}
                            </span>
                          </div>

                          <ol className="participantes-tanda-clasi">
                            {tanda.entradas.map((entrada) => (
                              <li key={entrada.id}>
                                <strong>{entrada.nombre}</strong>

                                {entrada.integrantes.length > 1 && (
                                  <p className="texto-secundario">
                                    {entrada.integrantes.join(" · ")}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ol>

                          {tanda.estado !== "pendiente" && (
                            <div className="votaciones-tanda-clasi">
                              <p>
                                {terminados}/{jurados.length} planillas
                                finalizadas
                              </p>

                              <ul>
                                {jurados.map((jurado) => {
                                  const voto = votos.find(
                                    (item) =>
                                      item.jurado_id === jurado.jurado_id,
                                  );

                                  return (
                                    <li key={jurado.jurado_id}>
                                      <span>{jurado.nombre}</span>
                                      <strong>
                                        {voto?.estado === "finalizada"
                                          ? "Finalizada"
                                          : voto
                                            ? "Borrador guardado"
                                            : "Sin guardar"}
                                      </strong>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </>
        )}
      </section>

      {!cargando && !errorCarga && permiteInicio && datos && (
        <details className="configuracion-clasificatorias">
          <summary>Configurar jurados y casillas</summary>
          <JuradosPanel fecha={datos.fecha} />
          <PlanillasPanel fecha={datos.fecha} />
        </details>
      )}
    </>
  );
}
