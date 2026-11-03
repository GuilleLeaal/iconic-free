import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { supabase } from "../../lib/supabase";
import type { Fecha } from "./fechasService";

import InscripcionesPanel from "../inscripciones/InscripcionesPanel";
import SorteoPanel from "../sorteos/SorteoPanel";
import ClasificatoriasPanel from "../clasificatorias/ClasificatoriasPanel";
import EliminatoriasPanel from "../eliminatorias/EliminatoriasPanel";
import ResultadosClasiPanel from "../clasificatorias/ResultadosClasiPanel";
import "./gestionFecha.css";

const SECCIONES = [
  { id: "inscripciones", nombre: "Inscripciones" },
  { id: "sorteos", nombre: "Sorteos" },
  { id: "clasificatorias", nombre: "Clasificatorias" },
  { id: "resultados", nombre: "Resultados clasis" },
  { id: "eliminatorias", nombre: "Eliminatorias" },
] as const;

type Seccion = (typeof SECCIONES)[number]["id"];

function esSeccion(valor: string | null): valor is Seccion {
  return SECCIONES.some((seccion) => seccion.id === valor);
}

export default function GestionFecha({ fecha }: { fecha: Fecha }) {
  const [parametros, setParametros] = useSearchParams();

  const vista = parametros.get("vista");
  const seccion: Seccion = esSeccion(vista) ? vista : "inscripciones";

  const [fechaActual, setFechaActual] = useState(fecha);
  const [bloqueado, setBloqueado] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setCargando(true);
      setBloqueado(true);
      setError("");

      try {
        const [resultadoFecha, resultadoSorteo] = await Promise.all([
          supabase
            .from("fechas")
            .select("*")
            .eq("id", fecha.id)
            .single<Fecha>(),

          supabase
            .from("sorteos")
            .select("id")
            .eq("fecha_id", fecha.id)
            .eq("vigente", true)
            .maybeSingle<{ id: string }>(),
        ]);

        if (resultadoFecha.error || resultadoSorteo.error) {
          throw new Error("No pudimos actualizar el estado de la fecha.");
        }

        if (!cancelado) {
          setFechaActual(resultadoFecha.data);
          setBloqueado(resultadoSorteo.data !== null);
        }
      } catch (errorCarga) {
        if (!cancelado) {
          setError(
            errorCarga instanceof Error
              ? errorCarga.message
              : "No pudimos cargar esta sección.",
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
  }, [fecha.id, seccion, intento]);

  function cambiarSeccion(destino: Seccion) {
    if (destino === seccion) return;

    setCargando(true);
    setBloqueado(true);

    setParametros((actuales) => {
      const nuevos = new URLSearchParams(actuales);
      nuevos.set("vista", destino);
      return nuevos;
    });
  }

  return (
    <div className="gestion-fecha">
      <nav className="navegacion-fecha" aria-label="Organización de la fecha">
        {SECCIONES.map((item) => (
          <button
            type="button"
            key={item.id}
            className={seccion === item.id ? "seccion-fecha-activa" : ""}
            aria-current={seccion === item.id ? "page" : undefined}
            onClick={() => cambiarSeccion(item.id)}
          >
            {item.nombre}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="panel estado-gestion-fecha">
          <p className="mensaje-error" role="alert">
            {error}
          </p>

          <button
            type="button"
            className="boton boton-secundario"
            onClick={() => setIntento((actual) => actual + 1)}
          >
            <RefreshCw size={17} aria-hidden="true" />
            Reintentar
          </button>
        </div>
      ) : cargando ? (
        <div className="estado-gestion-fecha" role="status">
          <LoaderCircle size={20} className="girando" aria-hidden="true" />
          Cargando sección…
        </div>
      ) : (
        <>
          {seccion === "inscripciones" && (
            <InscripcionesPanel
              key={fechaActual.id}
              fecha={fechaActual}
              bloqueado={bloqueado}
            />
          )}

          {seccion === "sorteos" && (
            <SorteoPanel
              key={`${fechaActual.id}:${fechaActual.estado}`}
              fecha={fechaActual}
              onBloqueoChange={setBloqueado}
            />
          )}

          {seccion === "clasificatorias" && (
            <ClasificatoriasPanel
              key={fechaActual.id}
              fecha={fechaActual}
              onFechaActualizada={setFechaActual}
            />
          )}

          {seccion === "resultados" && (
            <ResultadosClasiPanel
              key={fechaActual.id}
              fecha={fechaActual}
              onIrEliminatorias={() => cambiarSeccion("eliminatorias")}
            />
          )}
          {seccion === "eliminatorias" && (
            <EliminatoriasPanel
              key={fechaActual.id}
              fecha={fechaActual}
              onFechaActualizada={setFechaActual}
            />
          )}
        </>
      )}
    </div>
  );
}
