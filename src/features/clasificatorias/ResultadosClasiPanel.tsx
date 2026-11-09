import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw, ArrowRight } from "lucide-react";
import type { Fecha } from "../fechas/fechasService";
import {
  cargarResultadosClasi,
  cerrarClasificatorias,
} from "./resultadosClasiService";
import type { FilaRankingClasi, RankingClasi } from "./resultadosClasiService";
import "./resultadosClasi.css";
import { useCompetencia } from '../competencias/ContextoCompetencia';
import InitialCrossesEditor from '../eliminatorias/InitialCrossesEditor';
import { buildInitialCrosses, confirmableCrosses } from '../eliminatorias/initialCrosses';
import type { ConfirmedCross, InitialCross, InitialDrawMode } from '../eliminatorias/initialCrosses';

const TAMANO_PAGINA = 20;
const formatoPuntos = new Intl.NumberFormat("es-UY", {
  maximumFractionDigits: 20,
});

function estadoFila(fila: FilaRankingClasi, ranking: RankingClasi): string {
  if (fila.sin_puntuar) return "Sin puntuar";
  if (ranking.cierre)
    return ranking.cierre.clasificados.some((e) => e.id === fila.inscripcion_id)
      ? "Clasificado"
      : "No clasificó";
  if (!fila.completa) return "Faltan planillas";
  if (!ranking.lista_para_cerrar) return "Provisional";
  if (ranking.corte.directos.includes(fila.inscripcion_id))
    return "Dentro del cupo";
  if (ranking.corte.empatados.includes(fila.inscripcion_id))
    return ranking.corte.requiere_desempate ? "Repechaje" : "Dentro del cupo";
  return "Fuera del cupo";
}

function CierreClasificatorias({
  ranking,
  bloqueado,
  onConfirmar,
}: {
  ranking: RankingClasi;
  bloqueado: boolean;
  onConfirmar: (ganadores: string[], nota: string, mode: InitialDrawMode, crosses: ConfirmedCross[]) => Promise<void>;
}) {
  const { usuarioId } = useCompetencia();
  const clave = `iconic:repechaje:${usuarioId}:${ranking.clasificatoria_id}:${ranking.version}`;
  const [borrador, setBorrador] = useState<{
    ganadores: string[];
    nota: string;
  }>(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(clave) ?? "null");
      if (
        guardado &&
        Array.isArray(guardado.ganadores) &&
        typeof guardado.nota === "string"
      ) {
        const ids = [
          ...new Set<string>(
            guardado.ganadores.filter(
              (id: unknown) =>
                typeof id === "string" && ranking.corte.empatados.includes(id),
            ),
          ),
        ];
        return {
          ganadores: ids.slice(0, ranking.corte.cupos),
          nota: guardado.nota,
        };
      }
    } catch {
      /* Usar una selección vacía si no existe un borrador válido. */
    }
    return { ganadores: [], nota: "" };
  });
  const { ganadores, nota } = borrador;
  const [errorBorrador, setErrorBorrador] = useState(false);
  function guardarBorrador(nuevo: { ganadores: string[]; nota: string }) {
    setBorrador(nuevo);
    try {
      localStorage.setItem(clave, JSON.stringify(nuevo));
      setErrorBorrador(false);
    } catch {
      setErrorBorrador(true);
    }
  }
  const requiere = ranking.corte.requiere_desempate;
  const candidatos = ranking.filas.filter((f) =>
    ranking.corte.empatados.includes(f.inscripcion_id),
  );
  const seleccionValida =
    !requiere ||
    (ganadores.length === ranking.corte.cupos && nota.trim().length > 0);
  const [mode, setMode] = useState<InitialDrawMode>('sorteo');
  const [manual, setManual] = useState<{ key: string; crosses: InitialCross[] } | null>(null);
  const selected = new Set([...ranking.corte.directos, ...(requiere ? ganadores : ranking.corte.empatados)]);
  const finalists = ranking.filas.filter(f => selected.has(f.inscripcion_id));
  const signature = finalists.map(f => f.inscripcion_id).join(',');
  const ids = useMemo(() => signature ? signature.split(',') : [], [signature]);
  const crossCount = ranking.fase_inicial === 'dieciseisavos' ? 16 : 8;
  const perCross = Math.ceil(ranking.clasifican / crossCount);
  const initial = useMemo(() => buildInitialCrosses(ids, mode, perCross, crossCount), [ids, mode, perCross, crossCount]);
  const manualKey = `${ranking.version}:${mode}:${signature}`;
  const preview = manual?.key === manualKey ? manual.crosses : initial;
  const allAssigned = preview.flatMap(c => c.inscripciones).filter(Boolean).length === ranking.efectivos;
  return (
    <section className="cierre-clasis" aria-label="Confirmar clasificación">
      <h3>
        {requiere ? "Desempate por los últimos cupos" : "Clasificación lista"}
      </h3>
      {requiere ? (
        <>
          <p>
            Hay {candidatos.length} inscripciones empatadas por{" "}
            {ranking.corte.cupos} cupos. Después del repechaje, marcá únicamente
            a quienes avanzaron.
          </p>
          <fieldset disabled={bloqueado}>
            <legend>
              Ganadores del repechaje: {ganadores.length}/{ranking.corte.cupos}
            </legend>
            <div className="opciones-repechaje">
              {candidatos.map((fila) => (
                <label key={fila.inscripcion_id}>
                  <input
                    type="checkbox"
                    checked={ganadores.includes(fila.inscripcion_id)}
                    disabled={
                      !ganadores.includes(fila.inscripcion_id) &&
                      ganadores.length >= ranking.corte.cupos
                    }
                    onChange={(e) =>
                      guardarBorrador({
                        nota,
                        ganadores: e.target.checked
                          ? [...ganadores, fila.inscripcion_id]
                          : ganadores.filter(
                              (id) => id !== fila.inscripcion_id,
                            ),
                      })
                    }
                  />
                  <span>
                    {fila.entrada.nombre}
                    <small>
                      Clasis {fila.grupo} ·{" "}
                      {formatoPuntos.format(fila.puntos ?? 0)} puntos
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <div className="campo">
              <label htmlFor="nota-repechaje">Registro del repechaje</label>
              <textarea
                id="nota-repechaje"
                value={nota}
                rows={3}
                placeholder="Por ejemplo: repechaje resuelto por el jurado del grupo A."
                onChange={(e) =>
                  guardarBorrador({ ganadores, nota: e.target.value })
                }
              />
            </div>
          </fieldset>
        </>
      ) : (
        <p>
          Ya están definidos los {ranking.efectivos ?? ranking.clasifican} clasificados. No hay
          empate entre quienes entran y quienes quedan afuera.
        </p>
      )}
      {errorBorrador && (
        <p className="mensaje-error" role="alert">
          El navegador no pudo guardar el borrador del repechaje. Conservá esta
          pantalla abierta hasta confirmar el cierre.
        </p>
      )}
      {seleccionValida && ranking.efectivos >= 2 && <InitialCrossesEditor mode={mode} crosses={preview} finalists={finalists} disabled={bloqueado}
        onMode={value => { setMode(value); setManual(null); }} onShuffle={() => setManual({ key: manualKey, crosses: buildInitialCrosses(ids, 'sorteo', perCross, crossCount) })}
        onChange={crosses => setManual({ key: manualKey, crosses })}
        onFill={() => setManual({ key: manualKey, crosses: buildInitialCrosses(ids, 'puntaje', perCross, crossCount) })} />}
      <button
        type="button"
        className="boton boton-principal"
        disabled={bloqueado || !seleccionValida || !allAssigned || ranking.efectivos < 2}
        onClick={() => {
          if (bloqueado || !seleccionValida || !allAssigned) return;
          if (
            !window.confirm(
              `¿Confirmar los ${ranking.efectivos ?? ranking.clasifican} clasificados (de ${ranking.clasifican} cupos) e iniciar ${ranking.fase_inicial ?? "octavos"}? Se cerrarán las clasis y las altas. La clasificación y los cruces quedarán guardados.`,
            )
          )
            return;
          void onConfirmar(requiere ? ganadores : [], requiere ? nota : "", mode, confirmableCrosses(preview));
        }}
      >
        <Check size={17} aria-hidden="true" />
        Cerrar clasis e iniciar eliminatorias
      </button>
      {ranking.efectivos < 2 && <p className="mensaje-error">Se necesitan al menos dos inscripciones puntuadas para iniciar eliminatorias. Las planillas pueden finalizarse igualmente.</p>}
      <p className="ayuda-resultados-clasi">
        La confirmación guarda los resultados y estos cruces en una sola operación.
        Revisá el corte y la vista previa antes de confirmar.
      </p>
    </section>
  );
}

export default function ResultadosClasiPanel({
  fecha,
  onIrEliminatorias,
}: {
  fecha: Fecha;
  onIrEliminatorias: () => void;
}) {
  const { usuarioId } = useCompetencia();
  const [ranking, setRanking] = useState<RankingClasi | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");
  const [errorAccion, setErrorAccion] = useState("");
  const [intento, setIntento] = useState(0);
  const [busqueda, setBusqueda] = useState("");
  const [visibles, setVisibles] = useState(TAMANO_PAGINA);
  const enCurso = useRef(false);

  useEffect(() => {
    let cancelado = false;
    void cargarResultadosClasi(fecha.id)
      .then((datos) => {
        if (!cancelado) setRanking(datos);
      })
      .catch((e: unknown) => {
        if (!cancelado)
          setErrorCarga(
            e instanceof Error
              ? e.message
              : "No pudimos cargar los resultados.",
          );
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [fecha.id, intento]);

  function actualizar() {
    setErrorCarga("");
    setCargando(true);
    setIntento((i) => i + 1);
  }

  async function confirmar(ganadores: string[], nota: string, mode: InitialDrawMode, crosses: ConfirmedCross[]) {
    if (!ranking || cargando || errorCarga || enCurso.current) return;
    enCurso.current = true;
    setGuardando(true);
    setErrorAccion("");
    try {
      await cerrarClasificatorias(ranking, ganadores, nota, mode, crosses);
      try {
        localStorage.removeItem(
          `iconic:repechaje:${usuarioId}:${ranking.clasificatoria_id}:${ranking.version}`,
        );
      } catch {
        /* El cierre confirmado ya está guardado en la base. */
      }
    } catch (e) {
      setErrorAccion(
        e instanceof Error ? e.message : "No pudimos confirmar el cierre.",
      );
    } finally {
      enCurso.current = false;
      setGuardando(false);
      actualizar();
    }
  }

  const texto = busqueda.trim().toLocaleLowerCase("es");
  const filas =
    ranking?.filas.filter(
      (f) =>
        !texto ||
        [f.entrada.nombre, ...f.entrada.integrantes].some((nombre) =>
          nombre.toLocaleLowerCase("es").includes(texto),
        ),
    ) ?? [];
  const bloqueado = cargando || guardando || Boolean(errorCarga);

  return (
    <section className="panel resultados-clasi-panel">
      <div className="cabecera-resultados-clasi">
        <div>
          <h2>Resultados de clasificatorias</h2>
          <p className="texto-secundario">
            Una tabla global para todos los grupos.
          </p>
        </div>
        <button
          type="button"
          className="boton boton-secundario"
          disabled={cargando || guardando}
          onClick={actualizar}
        >
          <RefreshCw size={17} aria-hidden="true" />
          Actualizar tabla
        </button>
      </div>
      {cargando && (
        <p className="carga-resultados-clasi" role="status">
          <LoaderCircle size={18} className="girando" aria-hidden="true" />
          Actualizando resultados…
        </p>
      )}
      {errorCarga && (
        <p className="mensaje-error" role="alert">
          {errorCarga}
        </p>
      )}
      {errorAccion && (
        <p className="mensaje-error" role="alert">
          {errorAccion}
        </p>
      )}
      {!cargando && !errorCarga && !ranking && (
        <p className="texto-secundario">
          Esta fecha todavía no tiene clasificatorias iniciadas. Si pasa
          directamente a su fase inicial, podés continuar desde Eliminatorias.
        </p>
      )}
      {ranking && (
        <>
          <div className="resumen-resultados-clasi">
            <span>
              {ranking.puntuados ?? ranking.completos}/{ranking.total} inscripciones con puntuación
            </span>
            <span>
              {ranking.tandas_finalizadas}/{ranking.tandas_total} tandas
              finalizadas
            </span>
            <span>{ranking.completos}/{ranking.total} con planillas entregadas</span>
            <span>{ranking.clasifican} cupos para {ranking.fase_inicial ?? 'octavos'}</span>
          </div>
          {!ranking.cierre && ranking.puntuados < ranking.clasifican && <p className="aviso-formato">Hay {ranking.puntuados} inscripciones puntuadas para {ranking.clasifican} cupos. Podés ajustar el formato antes de confirmar el cierre o conservarlo con pases libres.</p>}
          <p className="ayuda-resultados-clasi">
            Se suman los puntos de todos los jurados. Solo cuentan las planillas
            finalizadas.
            {ranking.cierre
              ? " La clasificación está confirmada."
              : " La tabla es provisional hasta cerrar las clasis."}
          </p>
          {!ranking.jurados_consistentes && (
            <p className="mensaje-error" role="alert">
              Los grupos no tienen la misma cantidad de jurados asignados. No se
              puede confirmar la clasificación con esta configuración.
            </p>
          )}
          <div className="campo buscador-resultados-clasi">
            <label htmlFor="busqueda-ranking">
              Buscar participante o equipo
            </label>
            <input
              id="busqueda-ranking"
              type="search"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setVisibles(TAMANO_PAGINA);
              }}
              placeholder="Nombre o alias"
            />
          </div>
          <div
            className="tabla-resultados-clasi"
            role="region"
            aria-label="Tabla global"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Puesto</th>
                  <th scope="col">Participante</th>
                  <th scope="col">Grupo</th>
                  <th scope="col">Puntos</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, visibles).map((fila) => (
                  <tr
                    key={fila.inscripcion_id}
                    className={
                      estadoFila(fila, ranking) === "Repechaje"
                        ? "fila-repechaje"
                        : undefined
                    }
                  >
                    <td className="puesto-ranking">{fila.puesto ?? "—"}</td>
                    <th scope="row" className="participante-ranking">
                      <span>{fila.entrada.nombre}</span>
                      {fila.entrada.integrantes.length > 1 && fila.entrada.nombre !== fila.entrada.integrantes.join(' / ') && (
                        <small>{fila.entrada.integrantes.join(" · ")}</small>
                      )}
                      <details>
                        <summary>Ver jurados</summary>
                        <ul>
                          {fila.detalle_jurados.map((j) => (
                            <li key={j.jurado_id}>
                              <span>{j.nombre}</span>
                              <strong>{j.total === null
                                ? j.estado === "borrador"
                                  ? "Borrador"
                                  : j.estado === "finalizada" ? "Sin puntuar" : "Pendiente"
                                : formatoPuntos.format(j.total)}</strong>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </th>
                    <td className="grupo-ranking">
                      <span className="etiqueta-grupo-ranking" aria-hidden="true">Grupo </span>{fila.grupo}
                      <small>Tanda {fila.tanda}</small>
                    </td>
                    <td className="puntos-ranking">
                      <span className="etiqueta-puntos-ranking" aria-hidden="true">Puntos</span>
                      {fila.puntos === null
                        ? "—"
                        : formatoPuntos.format(fila.puntos)}
                    </td>
                    <td className="estado-ranking">
                      <span className="estado-ranking-texto">{estadoFila(fila, ranking)}</span>
                      {fila.casillas_vacias && fila.puntos !== null && <small>Hay casillas sin puntuar</small>}
                      <small>
                        {fila.jurados_finalizados}/{fila.jurados_esperados}{" "}
                        planillas
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filas.length === 0 && (
            <p className="texto-secundario">
              No encontramos inscripciones con esa búsqueda.
            </p>
          )}
          <div className="pie-tabla-clasi">
            <p className="texto-secundario">
              Mostrando {Math.min(visibles, filas.length)} de {filas.length}{" "}
              inscripciones.
            </p>
            {visibles < filas.length && (
              <button
                type="button"
                className="boton boton-secundario"
                onClick={() => setVisibles((n) => n + TAMANO_PAGINA)}
              >
                Mostrar más
              </button>
            )}
          </div>
          {ranking.cierre ? (
            <div className="clasificacion-confirmada" role="status">
              <h3>Clasificación confirmada</h3>
              <p>
                Se guardaron los {ranking.cierre.clasificados.length} clasificados y el cuadro.
              </p>
              {ranking.cierre.nota_desempate && (
                <p>Repechaje: {ranking.cierre.nota_desempate}</p>
              )}
              <button
                type="button"
                className="boton boton-principal"
                disabled={bloqueado}
                onClick={onIrEliminatorias}
              >
                Ver eliminatorias
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          ) : ranking.estado === "en_curso" &&
            ranking.fecha_estado === "en_curso" &&
            ranking.lista_para_cerrar ? (
            <CierreClasificatorias
              key={ranking.version}
              ranking={ranking}
              bloqueado={bloqueado}
              onConfirmar={confirmar}
            />
          ) : (
            <p className="ayuda-resultados-clasi">
              Para confirmar el corte deben estar finalizadas todas las
              planillas de todas las tandas.
            </p>
          )}
        </>
      )}
    </section>
  );
}
