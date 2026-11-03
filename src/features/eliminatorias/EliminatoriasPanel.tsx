import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Play, RefreshCw, Trophy } from "lucide-react";

import type { Fecha } from "../fechas/fechasService";
import {
  cargarEliminatorias,
  confirmarGanador,
  iniciarEliminatorias,
  sortearFaseEliminatoria,
  deshacerResultado,
} from "./eliminatoriasService";
import type {
  CruceEliminatoria,
  FaseEliminatoria,
} from "./eliminatoriasService";
import "./eliminatorias.css";

const FASES: { id: FaseEliminatoria; nombre: string }[] = [
  { id: "dieciseisavos", nombre: "Dieciseisavos" },
  { id: "octavos", nombre: "Octavos" },
  { id: "cuartos", nombre: "Cuartos" },
  { id: "semifinal", nombre: "Semifinal" },
  { id: "final", nombre: "Final" },
];

type EstadoEliminatorias = Awaited<ReturnType<typeof cargarEliminatorias>>;

function TarjetaCruce({
  cruce,
  puedeConfirmar,
  puedeCorregir,
  onConfirmar,
  onDeshacer,
}: {
  cruce: CruceEliminatoria;
  puedeConfirmar: boolean;
  puedeCorregir: boolean;
  onConfirmar: (cruce: CruceEliminatoria, ganadorId: string) => void;
  onDeshacer: (cruce: CruceEliminatoria) => void;
}) {
  const [seleccion, setSeleccion] = useState("");

  const ganador = cruce.entradas.find(
    (entrada) => entrada.id === cruce.ganador_id,
  );

  const seleccionValida = cruce.entradas.some(
    (entrada) => entrada.id === seleccion,
  );

  const admiteResultado =
    puedeConfirmar &&
    cruce.listo &&
    cruce.estado === "pendiente" &&
    cruce.entradas.length >= 2;

  return (
    <article
      className={`cruce-eliminatoria ${
        cruce.estado === "resuelto" ? "cruce-eliminatoria-resuelto" : ""
      }`}
    >
      <div className="cabecera-cruce-eliminatoria">
        <h4>Cruce {cruce.numero}</h4>
        <span className="estado-cruce-eliminatoria">
          {cruce.estado === "vacante"
            ? "Vacante"
            : cruce.estado === "resuelto"
              ? cruce.resolucion === "automatica"
                ? "Pase libre"
                : "Finalizado"
              : cruce.listo
                ? "Por disputar"
                : "Esperando rivales"}
        </span>
      </div>

      {cruce.entradas.length > 0 ? (
        <ul className="participantes-cruce">
          {cruce.entradas.map((entrada) => (
            <li
              key={entrada.id}
              className={
                entrada.id === cruce.ganador_id ? "participante-ganador" : ""
              }
            >
              <div>
                <strong>{entrada.nombre}</strong>

                {entrada.integrantes.length > 1 && (
                  <p className="texto-secundario">
                    {entrada.integrantes.join(" · ")}
                  </p>
                )}
              </div>

              {entrada.id === cruce.ganador_id && (
                <Check size={19} aria-label="Ganador" />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="texto-secundario detalle-cruce">
          {cruce.estado === "vacante"
            ? "Esta rama no tiene participantes."
            : "Los participantes aparecerán cuando esté preparada esta fase."}
        </p>
      )}

      {ganador && (
        <p className="resultado-cruce">
          {cruce.fase === "final" ? "Campeón: " : "Avanza: "}
          <strong>{ganador.nombre}</strong>
        </p>
      )}

      {puedeCorregir &&
        cruce.estado === "resuelto" &&
        cruce.resolucion === "manual" && (
          <button
            type="button"
            className="boton boton-secundario boton-deshacer-resultado"
            onClick={() => onDeshacer(cruce)}
          >
            Deshacer resultado
          </button>
        )}

      {!cruce.listo && cruce.entradas.length > 0 && (
        <p className="texto-secundario detalle-cruce">
          Falta resolver la otra rama de la llave.
        </p>
      )}

      {admiteResultado && (
        <div className="confirmacion-cruce">
          <label htmlFor={`ganador-${cruce.id}`}>Ganador del cruce</label>

          <select
            id={`ganador-${cruce.id}`}
            value={seleccion}
            onChange={(event) => setSeleccion(event.target.value)}
          >
            <option value="">Seleccioná quién avanza</option>
            {cruce.entradas.map((entrada) => (
              <option key={entrada.id} value={entrada.id}>
                {entrada.nombre}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="boton boton-principal"
            disabled={!seleccionValida}
            onClick={() => onConfirmar(cruce, seleccion)}
          >
            <Check size={17} aria-hidden="true" />
            Confirmar ganador
          </button>
        </div>
      )}
    </article>
  );
}

export default function EliminatoriasPanel({
  fecha,
  onFechaActualizada,
}: {
  fecha: Fecha;
  onFechaActualizada: (fecha: Fecha) => void;
}) {
  const [datos, setDatos] = useState<EstadoEliminatorias | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");
  const [errorAccion, setErrorAccion] = useState("");
  const [aviso, setAviso] = useState("");
  const [intento, setIntento] = useState(0);
  const [faseSeleccionada, setFaseSeleccionada] =
    useState<FaseEliminatoria>(fecha.fase_inicial ?? "octavos");

  const operacionEnCurso = useRef(false);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setCargando(true);
      setErrorCarga("");

      try {
        const resultado = await cargarEliminatorias(fecha.id);

        if (!cancelado) {
          setDatos(resultado);
          onFechaActualizada(resultado.fecha);
        }
      } catch (error) {
        if (!cancelado) {
          setErrorCarga(
            error instanceof Error
              ? error.message
              : "No pudimos cargar las eliminatorias.",
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
      // Consultamos la base también si se perdió la respuesta.
      setIntento((actual) => actual + 1);
      setGuardando(false);
      operacionEnCurso.current = false;
    }
  }

  function comenzar() {
    if (
      !window.confirm(
        "¿Comenzar las eliminatorias con este sorteo? Las inscripciones y el sorteo quedarán cerrados.",
      )
    ) {
      return;
    }

    void ejecutar(
      () => iniciarEliminatorias(fecha.id),
      "Eliminatorias iniciadas.",
    );
  }

  function registrarGanador(cruce: CruceEliminatoria, ganadorId: string) {
    const ganador = cruce.entradas.find((entrada) => entrada.id === ganadorId);
    if (!ganador) return;

    if (
      !window.confirm(
        `¿Confirmar a "${ganador.nombre}" como ganador del cruce ${cruce.numero}?`,
      )
    ) {
      return;
    }

    void ejecutar(
      () => confirmarGanador(cruce, ganadorId),
      `Resultado guardado: ${ganador.nombre}.`,
    );
  }

  const iniciadas = datos !== null && datos.cruces.length > 0;

  const puedeIniciar =
    datos !== null &&
    !iniciadas &&
    (datos.sorteo?.plan.tipo === "octavos" || datos.sorteo?.plan.tipo === "dieciseisavos") &&
    (datos.fecha.estado === "borrador" ||
      datos.fecha.estado === "inscripciones");

  const crucesFase =
    datos?.cruces
      .filter((cruce) => cruce.fase === faseSeleccionada)
      .sort((a, b) => a.numero - b.numero) ?? [];

  const final = datos?.cruces.find((cruce) => cruce.fase === "final");
  const campeon = final?.entradas.find(
    (entrada) => entrada.id === final.ganador_id,
  );

  const faseASortear =
    (faseSeleccionada === "octavos" && fecha.fase_inicial === "dieciseisavos") || faseSeleccionada === "cuartos" || faseSeleccionada === "semifinal"
      ? faseSeleccionada
      : null;

  const faseAnterior = faseASortear === "octavos" ? "dieciseisavos" : faseASortear === "cuartos" ? "octavos" : "cuartos";

  const crucesAnteriores =
    datos?.cruces.filter((cruce) => cruce.fase === faseAnterior) ?? [];

  const cantidadAnteriorEsperada = faseASortear === "octavos" ? 16 : faseASortear === "cuartos" ? 8 : 4;

  const anteriorTerminada =
    crucesAnteriores.length === cantidadAnteriorEsperada &&
    crucesAnteriores.every(
      (cruce) =>
        cruce.listo &&
        (cruce.estado === "resuelto" || cruce.estado === "vacante"),
    );

  const requiereSorteo =
    iniciadas &&
    datos?.sorteo?.eliminatorias_aleatorias === true &&
    faseASortear !== null &&
    crucesFase.length > 0 &&
    crucesFase.every((cruce) => !cruce.listo);

  function sortearFase() {
    if (!faseASortear || !anteriorTerminada || !requiereSorteo) return;

    const nombre = faseASortear ?? "fase";

    if (
      !window.confirm(
        `¿Sortear los cruces de ${nombre}? El sorteo quedará guardado.`,
      )
    ) {
      return;
    }

    void ejecutar(
      () => sortearFaseEliminatoria(fecha.id, faseASortear),
      `Sorteo de ${nombre} guardado.`,
    );
  }

  function anularResultado(cruce: CruceEliminatoria) {
    const ganador = cruce.entradas.find(
      (entrada) => entrada.id === cruce.ganador_id,
    );

    if (
      !window.confirm(
        `¿Deshacer el resultado del cruce ${cruce.numero}? ${
          ganador?.nombre ?? "El ganador"
        } dejará de figurar como ganador y el cruce quedará pendiente.`,
      )
    ) {
      return;
    }

    void ejecutar(
      () => deshacerResultado(cruce),
      "Resultado anulado. Ya podés confirmar el ganador correcto.",
    );
  }

  return (
    <section className="panel eliminatorias-panel">
      <div className="cabecera-eliminatorias">
        <div>
          <h2>Eliminatorias</h2>
          <p className="texto-secundario">
            Organización registra el ganador de cada cruce. Las eliminatorias no se votan en la web.
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
          {errorCarga} Usá “Actualizar” para volver a cargar.
        </p>
      ) : cargando ? (
        <div className="carga-eliminatorias" role="status">
          <LoaderCircle size={20} className="girando" aria-hidden="true" />
          {guardando ? "Guardando…" : "Actualizando eliminatorias…"}
        </div>
      ) : !iniciadas ? (
        <div className="inicio-eliminatorias">
          <p className="texto-secundario">
            {!datos?.sorteo
              ? "Generá el sorteo para preparar los cruces."
              : datos.sorteo.plan.tipo === "clasificatorias"
                ? "Esta fecha necesita resolver las clasificatorias antes de armar su fase inicial."
                : puedeIniciar
                  ? "El sorteo está listo. Al comenzar se crearán las cuatro fases."
                  : "La fecha no admite iniciar eliminatorias."}
          </p>

          {puedeIniciar && (
            <button
              type="button"
              className="boton boton-principal"
              onClick={comenzar}
            >
              <Play size={17} aria-hidden="true" />
              Comenzar eliminatorias
            </button>
          )}
        </div>
      ) : (
        <>
          {campeon && (
            <div className="campeon-eliminatorias" role="status">
              <Trophy size={25} aria-hidden="true" />
              <div>
                <span>Campeón</span>
                <strong>{campeon.nombre}</strong>
              </div>
            </div>
          )}

          <div className="selector-fases" aria-label="Fases de eliminatorias">
            {FASES.filter(f => f.id !== 'dieciseisavos' || fecha.fase_inicial === 'dieciseisavos').map((fase) => (
              <button
                type="button"
                key={fase.id}
                className={
                  faseSeleccionada === fase.id ? "fase-seleccionada" : ""
                }
                aria-pressed={faseSeleccionada === fase.id}
                onClick={() => setFaseSeleccionada(fase.id)}
              >
                {fase.nombre}
              </button>
            ))}
          </div>

          <h3 className="titulo-fase-eliminatorias">
            {FASES.find((fase) => fase.id === faseSeleccionada)?.nombre}
          </h3>

          {requiereSorteo && (
            <div className="aviso-sorteo-fase">
              <p className="texto-secundario">
                {anteriorTerminada
                  ? "La fase anterior terminó. Ya podés sortear estos cruces."
                  : "Terminá todos los cruces de la fase anterior para habilitar el sorteo."}
              </p>

              {anteriorTerminada && datos?.fecha.estado === "en_curso" && (
                <button
                  type="button"
                  className="boton boton-principal"
                  onClick={sortearFase}
                >
                  <RefreshCw size={17} aria-hidden="true" />
                  Sortear {faseASortear}
                </button>
              )}
            </div>
          )}

          <div className="grilla-cruces-eliminatorias">
            {crucesFase.map((cruce) => (
              <TarjetaCruce
                key={`${cruce.id}:${cruce.version}`}
                cruce={cruce}
                puedeConfirmar={datos?.fecha.estado === "en_curso"}
                puedeCorregir={
                  datos?.fecha.estado === "en_curso" ||
                  datos?.fecha.estado === "finalizada"
                }
                onConfirmar={registrarGanador}
                onDeshacer={anularResultado}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
