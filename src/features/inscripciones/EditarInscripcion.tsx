import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { modificarInscripcion } from './inscripcionesService';
import type { Inscripcion } from './inscripcionesService';

type Props = {
  inscripcion: Inscripcion;
  esIndividual: boolean;
  maximoIntegrantes: number;
  onGuardada: () => void;
  onCancelar: () => void;
};

export default function EditarInscripcion({
  inscripcion,
  esIndividual,
  maximoIntegrantes,
  onGuardada,
  onCancelar,
}: Props) {
  const clave = `iconic:editar-inscripcion:${inscripcion.id}`;

  const [datos, setDatos] = useState(() => {
    const originales = {
      nombre: !esIndividual && inscripcion.nombre === inscripcion.integrantes.map(i => i.alias).join(' / ') ? '' : inscripcion.nombre,
      integrantes: Array.from({ length: maximoIntegrantes }, (_, i) => inscripcion.integrantes[i]?.alias ?? ''),
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
        borrador.integrantes.length >= 1 &&
        borrador.integrantes.length <= maximoIntegrantes &&
        borrador.integrantes.every((alias) => typeof alias === 'string')
      ) {
        const integrantes = borrador.integrantes;
        return {
          nombre: borrador.nombre,
          integrantes: Array.from({ length: maximoIntegrantes }, (_, i) => integrantes[i] ?? ''),
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

    const integrantes = datos.integrantes.map(alias => alias.trim()).filter(Boolean);
    if (integrantes.length === 0) {
      setError('Ingresá al menos un alias.');
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
        integrantes,
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
                <span className="ayuda-campo">Anotá entre 1 y {maximoIntegrantes} integrantes; dejá vacíos los lugares libres. Si no hay nombre, se mostrarán sus alias.</span>
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
                  required={esIndividual}
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
