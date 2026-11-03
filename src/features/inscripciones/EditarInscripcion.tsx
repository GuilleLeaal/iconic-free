import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { modificarInscripcion } from './inscripcionesService';
import type { Inscripcion } from './inscripcionesService';

type Props = {
  inscripcion: Inscripcion;
  esIndividual: boolean;
  onGuardada: () => void;
  onCancelar: () => void;
};

export default function EditarInscripcion({
  inscripcion,
  esIndividual,
  onGuardada,
  onCancelar,
}: Props) {
  const clave = `iconic:editar-inscripcion:${inscripcion.id}`;

  const [datos, setDatos] = useState(() => {
    const originales = {
      nombre: !esIndividual && inscripcion.nombre === inscripcion.integrantes.map(i => i.alias).join(' / ') ? '' : inscripcion.nombre,
      integrantes: inscripcion.integrantes.map((item) => item.alias),
      version: inscripcion.version,
    };

    try {
      const guardado = localStorage.getItem(clave);

      if (!guardado) return originales;

      const borrador: unknown = JSON.parse(guardado);

      if (
        typeof borrador === 'object' &&
        borrador !== null &&
        'nombre' in borrador &&
        'integrantes' in borrador &&
        'version' in borrador &&
        typeof borrador.nombre === 'string' &&
        typeof borrador.version === 'number' &&
        Number.isInteger(borrador.version) &&
        borrador.version >= 1 &&
        Array.isArray(borrador.integrantes) &&
        borrador.integrantes.length === originales.integrantes.length &&
        borrador.integrantes.every((alias) => typeof alias === 'string')
      ) {
        return {
          nombre: borrador.nombre,
          integrantes: borrador.integrantes,
          version: borrador.version,
        };
      }
    } catch {
      // Se usan los datos guardados en la base de datos.
    }

    return originales;
  });

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [errorBorrador, setErrorBorrador] = useState(false);
  const enCurso = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(clave, JSON.stringify(datos));
      setErrorBorrador(false);
    } catch {
      setErrorBorrador(true);
    }
  }, [clave, datos]);

  const desactualizado = datos.version !== inscripcion.version;

  function descartar() {
    if (!window.confirm('¿Descartar el borrador de esta edición?')) return;

    try {
      localStorage.removeItem(clave);
    } catch {
      // No impide cerrar la edición.
    }

    onCancelar();
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (enCurso.current || desactualizado) return;

    if (datos.integrantes.some((alias) => !alias.trim())) {
      setError('Completá todos los alias que correspondan.');
      return;
    }

    enCurso.current = true;
    setGuardando(true);
    setError('');

    try {
      await modificarInscripcion(
        { ...inscripcion, version: datos.version },
        'editar',
        datos.nombre,
        datos.integrantes,
      );

      try {
        localStorage.removeItem(clave);
      } catch {
        // El cambio ya quedó confirmado en la base de datos.
      }

      onGuardada();
    } catch (errorGuardado) {
      setError(
        errorGuardado instanceof Error
          ? errorGuardado.message
          : 'No pudimos confirmar el cambio.',
      );
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  }

  return (
    <section className="editor-inscripcion">
      <h3>Editar {inscripcion.nombre}</h3>

      {desactualizado && (
        <p className="mensaje-error" role="alert">
          Este borrador corresponde a una versión anterior.
          Descartalo para abrir los datos actuales.
        </p>
      )}

      <form onSubmit={guardar}>
        <fieldset disabled={guardando || desactualizado}>
          <div className="campos-inscripcion">
            {!esIndividual && (
              <div className="campo campo-ancho">
                <label htmlFor={`editar-nombre-${inscripcion.id}`}>
                  Nombre del equipo (opcional)
                </label>
                <input
                  id={`editar-nombre-${inscripcion.id}`}
                  value={datos.nombre}
                  onChange={(event) =>
                    setDatos((actual) => ({
                      ...actual,
                      nombre: event.target.value,
                    }))
                  }
                />
                <span className="ayuda-campo">Si queda vacío, se mostrarán los alias de los integrantes.</span>
              </div>
            )}

            {datos.integrantes.map((alias, indice) => (
              <div className="campo" key={indice}>
                <label htmlFor={`editar-alias-${inscripcion.id}-${indice}`}>
                  {esIndividual ? 'Alias' : `Integrante ${indice + 1}`}
                </label>
                <input
                  id={`editar-alias-${inscripcion.id}-${indice}`}
                  value={alias}
                  onChange={(event) =>
                    setDatos((actual) => ({
                      ...actual,
                      integrantes: actual.integrantes.map((valor, posicion) =>
                        posicion === indice ? event.target.value : valor,
                      ),
                    }))
                  }
                  required
                />
              </div>
            ))}
          </div>

          {error && (
            <p className="mensaje-error" role="alert">{error}</p>
          )}

          {errorBorrador && (
            <p className="mensaje-error" role="alert">
              No pudimos guardar el borrador en este navegador.
              Guardá los cambios antes de salir.
            </p>
          )}

          <button className="boton boton-principal" type="submit">
            {guardando && (
              <LoaderCircle
                size={17}
                className="girando"
                aria-hidden="true"
              />
            )}
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </fieldset>

        <button
          className="boton boton-secundario"
          type="button"
          disabled={guardando}
          onClick={descartar}
        >
          Descartar edición
        </button>
      </form>
    </section>
  );
}
