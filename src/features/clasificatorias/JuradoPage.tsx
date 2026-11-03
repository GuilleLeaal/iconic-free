import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw, Save, UserMinus } from "lucide-react";

import {
  cargarGruposJurado,
  guardarPuntuaciones,
  retirarParticipanteClasi,
} from "./juradoService";
import type {
  GrupoJuradoConTanda,
  GrupoJuradoConTandas,
  PuntuacionClasi,
} from "./juradoService";
import AgregarParticipanteClasi from "./AgregarParticipanteClasi";
import {
  leerBorrador,
  reconciliarPlanilla,
  mismosPuntos,
} from "./borradoresClasi";
import type { EstadoPlanilla } from "./borradoresClasi";
import "./jurado.css";

function puntuacionesIniciales(
  grupo: GrupoJuradoConTanda["grupo"],
  tanda: GrupoJuradoConTanda["tanda"],
): PuntuacionClasi[] {
  return (
    tanda?.entradas.map((entrada) => ({
      inscripcion_id: entrada.id,
      casillas: grupo.clasificatoria.casillas.map(() => null),
    })) ?? []
  );
}

function PlanillaJurado({
  datos,
  juradoId,
  bloqueado,
  onActualizar,
  onOcupado,
  onBorradorSeguro,
}: {
  datos: GrupoJuradoConTanda;
  juradoId: string;
  bloqueado: boolean;
  onActualizar: () => void;
  onOcupado: (ocupado: boolean) => void;
  onBorradorSeguro: (seguro: boolean) => void;
}) {
  const { grupo, tanda, voto } = datos;
  const estructura = puntuacionesIniciales(grupo, tanda);
  const clave = `iconic:voto-clasi:${juradoId}:${tanda?.id}`;

  const [planilla, setPlanilla] = useState<EstadoPlanilla>(() => {
    const remota = {
      version: voto?.version ?? 0,
      puntuaciones: voto?.puntuaciones ?? estructura,
    };
    let local = null;
    try {
      local = leerBorrador(
        localStorage.getItem(clave),
        estructura,
        tanda?.retirados?.map((e) => e.id) ?? [],
      );
    } catch {
      /* aviso abajo */
    }
    if (voto?.estado === "finalizada" || !local) {
      return { editor: remota, guardada: remota, origen: remota };
    }
    return reconciliarPlanilla(
      { ...local, guardada: remota },
      remota,
      estructura,
    );
  });
  const { editor, guardada } = planilla;
  const [finalizada, setFinalizada] = useState(voto?.estado === "finalizada");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [errorBorrador, setErrorBorrador] = useState(false);
  const [aviso, setAviso] = useState("");

  const guardadoEnCurso = useRef(false);

  // Persistir también de forma síncrona en cada edición: pasar de tarjeta
  // no depende de que React alcance a ejecutar un efecto antes del desmontaje.
  const persistir = useCallback(
    (estado: EstadoPlanilla) => {
      try {
        localStorage.setItem(
          clave,
          JSON.stringify({ ...estado.editor, base: estado.origen }),
        );
        setErrorBorrador(false);
        return true;
      } catch {
        setErrorBorrador(true);
        return false;
      }
    },
    [clave],
  );

  useEffect(() => {
    const remota = {
      version: voto?.version ?? 0,
      puntuaciones: voto?.puntuaciones ?? puntuacionesIniciales(grupo, tanda),
    };
    setPlanilla((actual) =>
      voto?.estado === "finalizada"
        ? { editor: remota, guardada: remota, origen: remota }
        : reconciliarPlanilla(
            actual,
            remota,
            puntuacionesIniciales(grupo, tanda),
          ),
    );
    setFinalizada(voto?.estado === "finalizada");
  }, [voto, tanda, grupo]);

  useEffect(() => {
    if (bloqueado) return;
    if (finalizada) {
      // No borrar una copia local diferente: puede ser útil para revisar
      // un conflicto, aunque la planilla finalizada ya no se puede modificar.
      return;
    }
    persistir(planilla);
  }, [planilla, finalizada, bloqueado, persistir]);

  useEffect(() => {
    onBorradorSeguro(
      !errorBorrador ||
        mismosPuntos(editor.puntuaciones, guardada.puntuaciones),
    );
    return () => onBorradorSeguro(true);
  }, [errorBorrador, editor, guardada, onBorradorSeguro]);

  const pendiente =
    editor.version !== guardada.version ||
    !mismosPuntos(editor.puntuaciones, guardada.puntuaciones);
  const desactualizada = editor.version !== guardada.version;

  const puedeEditar =
    !bloqueado &&
    !guardando &&
    !finalizada &&
    !desactualizada &&
    tanda?.estado === "en_curso" &&
    grupo.clasificatoria.estado === "en_curso";

  const visibles = finalizada ? guardada.puntuaciones : editor.puntuaciones;

  function cambiarPunto(participante: string, casilla: number, texto: string) {
    const valor = texto === "" ? null : Number(texto);

    if (valor !== null && !Number.isFinite(valor)) return;

    setAviso("");
    setError("");

    const nueva = {
      ...planilla,
      editor: {
        ...editor,
        puntuaciones: editor.puntuaciones.map((fila) =>
          fila.inscripcion_id === participante
            ? {
                ...fila,
                casillas: fila.casillas.map((punto, posicion) =>
                  posicion === casilla ? valor : punto,
                ),
              }
            : fila,
        ),
      },
    };
    persistir(nueva);
    setPlanilla(nueva);
  }

  function usarGuardada() {
    if (
      pendiente &&
      !window.confirm(
        "¿Descartar los cambios de este navegador y cargar la planilla guardada?",
      )
    ) {
      return;
    }

    const nueva = { editor: guardada, guardada, origen: guardada };
    persistir(nueva);
    setPlanilla(nueva);
    setError("");
    setAviso("");
  }

  async function guardar(finalizar: boolean) {
    if (!puedeEditar || !tanda || guardadoEnCurso.current) return;

    setError("");
    setAviso("");

    const puntos = editor.puntuaciones.flatMap((fila) => fila.casillas);

    if (
      puntos.some(
        (punto) =>
          punto !== null && (!Number.isFinite(punto) || punto < 0 || punto > 4),
      )
    ) {
      setError("Las puntuaciones deben estar entre 0 y 4.");
      return;
    }

    if (
      finalizar &&
      !window.confirm(
        `¿Finalizar tu planilla? Quedan ${puntos.filter(p => p === null).length} casillas vacías. Sin puntuar: ${tanda.entradas.filter(e => editor.puntuaciones.find(f => f.inscripcion_id === e.id)?.casillas.every(p => p === null)).map(e => e.nombre).join(", ") || "nadie"}. Después no podrás cambiar las puntuaciones.`,
      )
    ) {
      return;
    }

    guardadoEnCurso.current = true;
    setGuardando(true);
    onOcupado(true);

    try {
      const version = await guardarPuntuaciones(
        tanda.id,
        editor.puntuaciones,
        editor.version,
        finalizar,
      );

      const estado = {
        version,
        puntuaciones: editor.puntuaciones,
      };

      const nueva = { editor: estado, guardada: estado, origen: estado };
      persistir(nueva);
      setPlanilla(nueva);
      setFinalizada(finalizar);
      setAviso(finalizar ? "Planilla finalizada." : "Borrador guardado.");
    } catch (errorGuardado) {
      setError(
        errorGuardado instanceof Error
          ? errorGuardado.message
          : "No pudimos confirmar el guardado.",
      );
    } finally {
      guardadoEnCurso.current = false;
      setGuardando(false);
      onOcupado(false);
      onActualizar();
    }
  }

  async function retirar(inscripcionId: string, nombre: string) {
    if (!puedeEditar || !tanda || tanda.participantes_bloqueados || guardadoEnCurso.current) return;
    if (!window.confirm(`¿Retirar a ${nombre} por ausencia de esta tanda? El cambio se aplica a todos los jurados del grupo. Las notas de los demás participantes se conservan.`)) return;
    if (!persistir(planilla)) {
      setError('No se pudieron conservar tus cambios en este navegador. Guardá el borrador antes de retirar al participante.');
      return;
    }
    guardadoEnCurso.current = true;
    setGuardando(true);
    onOcupado(true);
    setError('');
    setAviso('');
    try {
      await retirarParticipanteClasi(tanda.id, inscripcionId, tanda.version);
      setAviso('Participante retirado por ausencia.');
    } catch (errorRetiro) {
      setError(errorRetiro instanceof Error ? errorRetiro.message : 'No pudimos confirmar el retiro.');
    } finally {
      guardadoEnCurso.current = false;
      setGuardando(false);
      onOcupado(false);
      onActualizar();
    }
  }

  if (!tanda) return <p className="espera-jurado">Seleccioná una tanda para puntuar.</p>;
  return (
    <div className="planilla-jurado">
      <p className="estado-planilla-jurado">
        Tanda {tanda.numero}
        {" · "}
        {finalizada
          ? "Tu planilla está finalizada"
          : tanda.estado === "en_curso"
            ? "Abierta para puntuar"
            : "Tanda finalizada"}
      </p>

      {!finalizada && desactualizada && (
        <p className="mensaje-error" role="alert">
          La versión guardada es diferente a tu borrador. Conservamos tus
          cambios. Cargá la planilla guardada antes de seguir.
        </p>
      )}

      {(tanda.retirados?.length ?? 0) > 0 && (
        <p className="ayuda-planilla-jurado" role="status">
          Retirados por ausencia:{" "}
          {tanda.retirados?.map((e) => e.nombre).join(" · ")}. No participan del
          ranking.
        </p>
      )}
      {tanda.entradas.length === 0 && (
        <p className="espera-jurado">
          Esta tanda quedó sin participantes y está cerrada.
        </p>
      )}
      {tanda.entradas.map((entrada) => {
        const puntos =
          visibles.find((f) => f.inscripcion_id === entrada.id)?.casillas ?? [];
        const completadas = puntos.filter((punto) => punto !== null).length;
        const total = puntos.reduce<number>(
          (suma, punto) => suma + (punto ?? 0),
          0,
        );

        return (
          <section className="participante-planilla-jurado" key={entrada.id}>
            <h3>{entrada.nombre}</h3>

            {!finalizada && !tanda.participantes_bloqueados && tanda.estado === 'en_curso' && grupo.clasificatoria.estado === 'en_curso' && (
              <button type="button" className="boton boton-secundario retirar-participante-clasi" disabled={!puedeEditar} aria-label={`Retirar por ausencia a ${entrada.nombre}`} onClick={() => void retirar(entrada.id, entrada.nombre)}>
                <UserMinus size={16} aria-hidden="true" />Retirar por ausencia
              </button>
            )}

            {entrada.integrantes.length > 1 && (
              <p className="texto-secundario">
                {entrada.integrantes.join(" · ")}
              </p>
            )}

            <div className="casillas-planilla-jurado">
              {grupo.clasificatoria.casillas.map((nombre, posicion) => (
                <div className="campo" key={posicion}>
                  <label htmlFor={`${tanda.id}-${entrada.id}-${posicion}`}>
                    {nombre}
                  </label>

                  <input
                    id={`${tanda.id}-${entrada.id}-${posicion}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="4"
                    step="any"
                    placeholder="—"
                    value={puntos[posicion] ?? ""}
                    disabled={!puedeEditar}
                    onChange={(event) =>
                      cambiarPunto(entrada.id, posicion, event.target.value)
                    }
                  />
                </div>
              ))}
            </div>

            <p className="total-planilla-jurado">
              {completadas}/{puntos.length} casillas completas
              {" · "}
              {completadas === 0 ? 'Sin puntuar' : `${completadas === puntos.length ? 'Total' : 'Parcial'}: ${total}`}
            </p>
          </section>
        );
      })}

      {error && (
        <p className="mensaje-error" role="alert">
          {error}
        </p>
      )}

      {!finalizada && errorBorrador && (
        <p className="mensaje-error" role="alert">
          El navegador no pudo guardar los cambios pendientes. Guardá el
          borrador en la web antes de cerrar.
        </p>
      )}

      {aviso && (
        <p className="mensaje-guardado" role="status">
          {aviso}
        </p>
      )}

      {!finalizada && tanda.entradas.length > 0 && (
        <>
          <div className="acciones-planilla-jurado">
            <button
              type="button"
              className="boton boton-secundario"
              disabled={!puedeEditar}
              onClick={() => void guardar(false)}
            >
              <Save size={17} aria-hidden="true" />
              Guardar borrador
            </button>

            <button
              type="button"
              className="boton boton-principal"
              disabled={!puedeEditar}
              onClick={() => void guardar(true)}
            >
              {guardando ? (
                <LoaderCircle
                  size={17}
                  className="girando"
                  aria-hidden="true"
                />
              ) : (
                <Check size={17} aria-hidden="true" />
              )}
              {guardando ? "Guardando…" : "Finalizar planilla"}
            </button>

            {pendiente && (
              <button
                type="button"
                className="boton boton-secundario"
                disabled={bloqueado || guardando}
                onClick={usarGuardada}
              >
                Cargar guardada
              </button>
            )}
          </div>

          <p className="ayuda-planilla-jurado">
            Los cambios pendientes se conservan en este navegador. Guardar
            borrador los guarda en la web.
          </p>
        </>
      )}
    </div>
  );
}

export default function JuradoPage({
  juradoId,
  nombre,
  competenciaId,
}: {
  juradoId: string;
  nombre: string;
  competenciaId: string;
}) {
  const [grupos, setGrupos] = useState<GrupoJuradoConTandas[]>([]);
  const [grupoId, setGrupoId] = useState("");
  const [tandaId, setTandaId] = useState("");
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [borradorSeguro, setBorradorSeguro] = useState(true);
  const [error, setError] = useState("");
  const [intento, setIntento] = useState(0);
  const claveSeleccion = `iconic:seleccion-clasi:${juradoId}:${competenciaId}`;

  function actualizar() {
    setCargando(true);
    setIntento((actual) => actual + 1);
  }
  function recordar(grupo: string, tanda: string) {
    try {
      localStorage.setItem(
        claveSeleccion,
        JSON.stringify({ grupoId: grupo, tandaId: tanda }),
      );
    } catch {
      /* La selección no afecta los votos. */
    }
  }

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setError("");
      try {
        const datos = await cargarGruposJurado(juradoId, competenciaId);
        if (!cancelado) setGrupos(datos);
      } catch (e) {
        if (!cancelado)
          setError(
            e instanceof Error
              ? e.message
              : "No pudimos cargar tus clasificatorias.",
          );
      } finally {
        if (!cancelado) setCargando(false);
      }
    }
    void cargar();
    return () => {
      cancelado = true;
    };
  }, [juradoId, competenciaId, intento]);

  useEffect(() => {
    if (cargando || error || !grupos.length) return;
    let anterior: { grupoId?: string; tandaId?: string } = {};
    try {
      anterior = JSON.parse(localStorage.getItem(claveSeleccion) ?? "{}") ?? {};
    } catch {
      /* usar primera */
    }
    const grupo =
      grupos.find((g) => g.grupo.id === grupoId) ??
      grupos.find((g) => g.grupo.id === anterior.grupoId) ??
      grupos[0];
    const tanda =
      grupo.tandas.find((t) => t.id === tandaId) ??
      grupo.tandas.find((t) => t.id === anterior.tandaId) ??
      grupo.tandas.find(
        (t) =>
          !grupo.votos.some(
            (v) => v.tanda_id === t.id && v.estado === "finalizada",
          ),
      ) ??
      grupo.tandas[0];
    setGrupoId(grupo.grupo.id);
    setTandaId(tanda?.id ?? "");
  }, [grupos, grupoId, tandaId, claveSeleccion, cargando, error]);

  const seleccion = grupos.find((g) => g.grupo.id === grupoId);
  const tanda = seleccion?.tandas.find((t) => t.id === tandaId);
  const indice = seleccion?.tandas.findIndex((t) => t.id === tandaId) ?? -1;
  const bloqueado = cargando || ocupado || Boolean(error);
  const puedeNavegar = !bloqueado && borradorSeguro;
  function cambiarTanda(id: string) {
    if (!puedeNavegar) return;
    setTandaId(id);
    recordar(grupoId, id);
  }

  return (
    <div className="pagina-jurado">
      <section className="panel">
        <div className="cabecera-pagina-jurado">
          <div>
            <span className="etiqueta">JURADO</span>
            <h1>Hola, {nombre}</h1>
            <p className="texto-secundario">Tus clasificatorias asignadas.</p>
          </div>
          <button
            type="button"
            className="boton boton-secundario"
            disabled={cargando || ocupado}
            onClick={actualizar}
          >
            <RefreshCw size={17} aria-hidden="true" />
            Actualizar
          </button>
        </div>
        {cargando && (
          <p className="carga-pagina-jurado" role="status">
            <LoaderCircle size={18} className="girando" aria-hidden="true" />
            Actualizando…
          </p>
        )}
        {error && (
          <p className="mensaje-error" role="alert">
            {error} Usá “Actualizar” para reintentar.
          </p>
        )}
        {!cargando && !error && !grupos.length && (
          <p className="espera-jurado">
            No tenés grupos asignados en fechas en curso. Actualizá cuando
            comiencen tus clasis.
          </p>
        )}
        {grupos.length > 1 && (
          <div className="campo selector-grupo-jurado">
            <label htmlFor="grupo-jurado">Clasificatoria</label>
            <select
              id="grupo-jurado"
              value={grupoId}
              disabled={!puedeNavegar}
              onChange={(e) => {
                const nueva = grupos.find((g) => g.grupo.id === e.target.value);
                const primera = nueva?.tandas[0]?.id ?? "";
                setGrupoId(e.target.value);
                setTandaId(primera);
                recordar(e.target.value, primera);
              }}
            >
              {grupos.map(({ grupo }) => (
                <option key={grupo.id} value={grupo.id}>
                  {grupo.clasificatoria.fecha.nombre} · Clasis {grupo.nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>
      {seleccion && (
        <section className="panel grupo-pagina-jurado">
          <h2>
            {seleccion.grupo.clasificatoria.fecha.nombre} · Clasis{" "}
            {seleccion.grupo.nombre}
          </h2>
          {tanda ? (
            <>
              <nav className="navegacion-tandas-jurado" aria-label="Tandas">
                <button
                  type="button"
                  className="boton boton-secundario"
                  disabled={!puedeNavegar || indice <= 0}
                  onClick={() => cambiarTanda(seleccion.tandas[indice - 1].id)}
                >
                  Anterior
                </button>
                <div className="campo">
                  <label htmlFor="tanda-jurado">Tanda</label>
                  <select
                    id="tanda-jurado"
                    value={tandaId}
                    disabled={!puedeNavegar}
                    onChange={(e) => cambiarTanda(e.target.value)}
                  >
                    {seleccion.tandas.map((t) => (
                      <option key={t.id} value={t.id}>
                        Tanda {t.numero} · {t.entradas.length} inscripciones
                        {seleccion.votos.some(
                          (v) =>
                            v.tanda_id === t.id && v.estado === "finalizada",
                        )
                          ? " · Finalizada"
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="boton boton-secundario"
                  disabled={
                    !puedeNavegar || indice >= seleccion.tandas.length - 1
                  }
                  onClick={() => cambiarTanda(seleccion.tandas[indice + 1].id)}
                >
                  Siguiente
                </button>
              </nav>
              <p className="ayuda-planilla-jurado">
                {indice + 1} de {seleccion.tandas.length} tandas. Podés
                puntuarlas en el orden que necesites.
              </p>
              <AgregarParticipanteClasi
                key={`alta:${juradoId}:${tanda.id}`}
                datos={seleccion}
                tandaId={tanda.id}
                juradoId={juradoId}
                bloqueado={bloqueado}
                onOcupado={setOcupado}
                onActualizar={actualizar}
                onSeleccionar={(id) => {
                  setTandaId(id);
                  recordar(grupoId, id);
                }}
              />
              <PlanillaJurado
                key={`planilla:${juradoId}:${tanda.id}`}
                datos={{
                  grupo: seleccion.grupo,
                  tanda,
                  voto:
                    seleccion.votos.find((v) => v.tanda_id === tanda.id) ??
                    null,
                }}
                juradoId={juradoId}
                bloqueado={bloqueado}
                onActualizar={actualizar}
                onOcupado={setOcupado}
                onBorradorSeguro={setBorradorSeguro}
              />
            </>
          ) : (
            <p className="espera-jurado">Este grupo no tiene tandas.</p>
          )}
        </section>
      )}
    </div>
  );
}
