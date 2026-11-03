import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, Shuffle } from 'lucide-react';
import type { Fecha } from '../fechas/fechasService';
import {
  deshacerSorteo,
  generarSorteo,
  obtenerSorteo,
} from './sorteosService';
import type { CruceSorteo, Sorteo } from './sorteosService';
import './sorteos.css';
import { supabase } from '../../lib/supabase';

function TarjetaCruce({
  cruce,
  clasificatoria = false,
}: {
  cruce: CruceSorteo;
  clasificatoria?: boolean;
}) {
  const cantidad = cruce.inscripciones.length;

  const formato = clasificatoria
    ? `${cantidad} inscripciones`
    : cantidad === 0
      ? 'Vacante'
      : cantidad === 1
        ? 'Pase libre'
        : cantidad === 2
          ? 'Duelo'
          : cantidad === 3
            ? 'Triangular'
            : 'Cuadrangular';

  return (
    <article className="tarjeta-cruce">
      <div className="cabecera-cruce">
        <h4>
          {clasificatoria ? 'Tanda' : 'Cruce'} {cruce.numero}
        </h4>
        <span>{formato}</span>
      </div>

      {cantidad === 0 ? (
        <p className="texto-secundario">Sin inscripción asignada.</p>
      ) : (
        <ul>
          {cruce.inscripciones.map((entrada) => (
            <li key={entrada.id}>
              <strong>{entrada.nombre}</strong>

              {entrada.integrantes.length > 1 && (
                <span>{entrada.integrantes.join(' · ')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function SorteoPanel({
  fecha,
  onBloqueoChange,
}: {
  fecha: Fecha;
  onBloqueoChange: (bloqueado: boolean) => void;
}) {
  const [sorteo, setSorteo] = useState<Sorteo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);
  const [cantidad, setCantidad] = useState<number | null>(null);
  const operacionEnCurso = useRef(false);

  const admiteCambios =
    fecha.estado === 'borrador' || fecha.estado === 'inscripciones';

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setCargando(true);
      setError('');
      onBloqueoChange(true);

      try {
        const [actual, conteo] = await Promise.all([obtenerSorteo(fecha.id), supabase.from('inscripciones').select('id', { count: 'exact', head: true }).eq('fecha_id', fecha.id).eq('activa', true)]);

        if (!cancelado) {
          setSorteo(actual);
          setCantidad(conteo.count);
          onBloqueoChange(actual !== null);
        }
      } catch (errorCarga) {
        if (!cancelado) {
          setError(
            errorCarga instanceof Error
              ? errorCarga.message
              : 'No pudimos cargar el sorteo.',
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
  }, [fecha.id, intento, onBloqueoChange]);

  async function ejecutar(accion: 'generar' | 'deshacer') {
    if (operacionEnCurso.current || cargando) return;

    const mensaje =
      accion === 'generar'
        ? `¿Generar el sorteo? ${cantidad ?? 'Cantidad sin verificar'} inscripciones · Clasifican ${fecha.cupos ?? 'según configuración histórica'} · Inicio en ${fecha.fase_inicial ?? 'octavos'}. ${cantidad !== null && fecha.cupos && cantidad < fecha.cupos ? 'Se conservará la fase elegida con pases libres y vacantes. ' : ''}Quedarán bloqueadas las inscripciones hasta deshacer el sorteo.`
        : '¿Deshacer este sorteo? Se conservará en el historial y podrás modificar las inscripciones.';

    if (!window.confirm(mensaje)) return;

    operacionEnCurso.current = true;
    setGuardando(true);
    setError('');
    onBloqueoChange(true);

    try {
      if (accion === 'generar') {
        const generado = await generarSorteo(fecha.id);
        setSorteo(generado);
      } else if (sorteo) {
        await deshacerSorteo(sorteo.id);
        setSorteo(null);
        onBloqueoChange(false);
      }
    } catch (errorOperacion) {
      setError(
        errorOperacion instanceof Error
          ? errorOperacion.message
          : 'No pudimos confirmar la operación.',
      );
    } finally {
      operacionEnCurso.current = false;
      setGuardando(false);
    }
  }

  return (
    <section className="panel sorteo-panel">
      <div className="cabecera-sorteo">
        <div>
          <h2>Sorteo</h2>
          <p className="texto-secundario">
            Clasificatorias y cuadro según la configuración de la fecha.
          </p>
        </div>

        <button
          className="boton boton-secundario"
          disabled={cargando || guardando}
          onClick={() => setIntento((actual) => actual + 1)}
        >
          <RefreshCw size={17} aria-hidden="true" />
          Actualizar
        </button>
      </div>
      {!sorteo && cantidad !== null && fecha.cupos && <p className="texto-secundario">Estimación, sin sorteo guardado: {cantidad} inscripciones · Clasifican {fecha.cupos} · Inicio en {fecha.fase_inicial} · {cantidad > fecha.cupos ? `Clasis en ${fecha.grupos_clasi ?? Math.min(3, Math.max(1, Math.ceil(cantidad / 50)))} grupos` : 'Sin clasis'} · Tandas de hasta {fecha.maximo_tanda ?? 5}.</p>}
      {!sorteo && cantidad !== null && fecha.cupos && cantidad < fecha.cupos && <p className="aviso-formato">Hay {cantidad} inscripciones para {fecha.cupos} cupos. Podés cambiar el formato.</p>}

      {error && (
        <p className="mensaje-error" role="alert">{error}</p>
      )}

      {cargando ? (
        <div className="carga-fechas" role="status">
          <LoaderCircle
            size={20}
            className="girando"
            aria-hidden="true"
          />
          Cargando sorteo…
        </div>
      ) : sorteo ? (
        <>
          <div className="resumen-sorteo">
            <span className="estado-fecha">Sorteo guardado</span>
            <span>{sorteo.plan.total} inscripciones</span>
            <span>
              {sorteo.plan.tipo !== 'clasificatorias'
                ? `Inicio en ${sorteo.plan.tipo}`
                : `Clasificatorias · Clasifican ${sorteo.plan.clasifican}`}
            </span>
          </div>

          {sorteo.plan.tipo !== 'clasificatorias' ? (
            <>
              {sorteo.plan.total < (fecha.cupos ?? 16) && (
                <p className="texto-secundario nota-sorteo">
                  El cuadro incluye pases libres y, si corresponde,
                  posiciones vacantes.
                </p>
              )}

              <div className="grilla-cruces">
                {(sorteo.plan.cruces ?? []).map((cruce) => (
                  <TarjetaCruce key={cruce.numero} cruce={cruce} />
                ))}
              </div>
            </>
          ) : (
            (sorteo.plan.grupos ?? []).map((grupo) => (
              <section className="grupo-clasi" key={grupo.nombre}>
                <h3>
                  Clasi {grupo.nombre}
                  <span>{grupo.total} inscripciones</span>
                </h3>

                <div className="grilla-cruces">
                  {grupo.tandas.map((tanda) => (
                    <TarjetaCruce
                      key={tanda.numero}
                      cruce={tanda}
                      clasificatoria
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          {admiteCambios && (
            <button
              className="boton boton-secundario accion-sorteo"
              disabled={guardando}
              onClick={() => void ejecutar('deshacer')}
            >
              {guardando ? 'Guardando…' : 'Deshacer sorteo'}
            </button>
          )}
        </>
      ) : (
        <>
          <p className="texto-secundario nota-sorteo">
            Todavía no hay un sorteo guardado para esta fecha.
          </p>

          {admiteCambios && (
            <button
              className="boton boton-principal"
              disabled={guardando || Boolean(error)}
              onClick={() => void ejecutar('generar')}
            >
              {guardando ? (
                <LoaderCircle
                  size={17}
                  className="girando"
                  aria-hidden="true"
                />
              ) : (
                <Shuffle size={17} aria-hidden="true" />
              )}
              {guardando ? 'Guardando…' : 'Generar sorteo'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
