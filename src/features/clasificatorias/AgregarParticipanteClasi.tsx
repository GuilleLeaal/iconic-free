import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Plus, LoaderCircle } from "lucide-react";
import { agregarParticipanteClasi, ErrorAltaClasi } from "./juradoService";
import type { GrupoJuradoConTandas, SolicitudAltaClasi } from "./juradoService";

type Formulario = { nombre: string; integrantes: string[]; destino: string };

export default function AgregarParticipanteClasi({
  datos,
  tandaId,
  juradoId,
  bloqueado,
  onOcupado,
  onActualizar,
  onSeleccionar,
}: {
  datos: GrupoJuradoConTandas;
  tandaId: string;
  juradoId: string;
  bloqueado: boolean;
  onOcupado: (ocupado: boolean) => void;
  onActualizar: () => void;
  onSeleccionar: (tandaId: string) => void;
}) {
  const { grupo, tandas } = datos;
  const cantidad = grupo.clasificatoria.fecha.integrantes_por_equipo;
  const habilitadas = tandas.filter(
    (t) =>
      t.estado === "en_curso" &&
      !t.participantes_bloqueados &&
      t.entradas.length < 5,
  );
  const clave = `iconic:alta-clasi:${juradoId}:${grupo.id}`;
  const claveFormulario = `${clave}:formulario`;
  const [pendiente, setPendiente] = useState<SolicitudAltaClasi | null>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(clave) ?? "null");
      return p &&
        p.grupoId === grupo.id &&
        typeof p.solicitudId === "string" &&
        Array.isArray(p.integrantes) &&
        p.integrantes.length === cantidad &&
        p.integrantes.every((a: unknown) => typeof a === "string") &&
        typeof p.nombre === "string" &&
        (p.tandaId === null || typeof p.tandaId === "string")
        ? p
        : null;
    } catch {
      return null;
    }
  });
  const [abierto, setAbierto] = useState(Boolean(pendiente));
  const [formulario, setFormulario] = useState<Formulario>(() => {
    if (pendiente)
      return {
        nombre: pendiente.nombre,
        integrantes: pendiente.integrantes,
        destino: pendiente.tandaId ?? "nueva",
      };
    try {
      const f = JSON.parse(localStorage.getItem(claveFormulario) ?? "null");
      if (
        f &&
        typeof f.nombre === "string" &&
        typeof f.destino === "string" &&
        Array.isArray(f.integrantes) &&
        f.integrantes.length === cantidad &&
        f.integrantes.every((a: unknown) => typeof a === "string")
      )
        return f;
    } catch {
      /* Usar campos vacíos. */
    }
    return {
      nombre: "",
      integrantes: Array<string>(cantidad).fill(""),
      destino: habilitadas.some((t) => t.id === tandaId)
        ? tandaId
        : (habilitadas[0]?.id ?? "nueva"),
    };
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const enCurso = useRef(false);
  const activa =
    grupo.clasificatoria.estado === "en_curso" &&
    grupo.clasificatoria.fecha.estado === "en_curso";
  const deshabilitado = bloqueado || guardando;

  function editar(nueva: Formulario) {
    if (pendiente || deshabilitado) return;
    setFormulario(nueva);
    setError("");
    try {
      localStorage.setItem(claveFormulario, JSON.stringify(nueva));
    } catch {
      setError(
        "El navegador no pudo conservar este formulario. No cierres antes de registrar el alta.",
      );
    }
  }

  async function agregar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deshabilitado || enCurso.current) return;
    const solicitud = pendiente ?? {
      solicitudId: crypto.randomUUID(),
      grupoId: grupo.id,
      tandaId: formulario.destino === "nueva" ? null : formulario.destino,
      nombre: formulario.nombre.trim(),
      integrantes: formulario.integrantes.map((a) => a.trim()),
    };
    // Guardar la solicitud antes de enviarla permite recuperar una respuesta
    // perdida incluso después de recargar, sin duplicar la inscripción.
    try {
      localStorage.setItem(clave, JSON.stringify(solicitud));
    } catch {
      setError(
        "El navegador no pudo conservar la solicitud. Liberá espacio antes de agregar al participante.",
      );
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    onOcupado(true);
    setPendiente(solicitud);
    setError("");
    setAviso("");
    try {
      const resultado = await agregarParticipanteClasi(solicitud);
      try {
        localStorage.removeItem(clave);
        localStorage.removeItem(claveFormulario);
      } catch {
        /* Una solicitud conservada se recupera por id, sin repetir el alta. */
      }
      setPendiente(null);
      setFormulario({
        nombre: "",
        integrantes: Array<string>(cantidad).fill(""),
        destino: resultado.tanda_id,
      });
      setAbierto(false);
      setAviso(`Participante registrado en la tanda ${resultado.numero}.`);
      onActualizar();
      onSeleccionar(resultado.tanda_id);
    } catch (e) {
      const incierto = !(e instanceof ErrorAltaClasi) || e.incierto;
      if (!incierto) {
        try {
          localStorage.removeItem(clave);
        } catch {
          /* Reintentar mismo id sigue siendo seguro. */
        }
        setPendiente(null);
      }
      setError(
        e instanceof Error
          ? e.message
          : "No recibimos confirmación. Reintentá la misma solicitud.",
      );
      onActualizar();
    } finally {
      enCurso.current = false;
      setGuardando(false);
      onOcupado(false);
    }
  }

  if (!activa && !pendiente) return null;
  return (
    <div className="alta-participante-clasi">
      {!abierto ? (
        <button
          type="button"
          className="boton boton-secundario"
          disabled={deshabilitado}
          onClick={() => {
            setAbierto(true);
            setAviso("");
          }}
        >
          <Plus size={17} aria-hidden="true" />
          Agregar participante
        </button>
      ) : (
        <form onSubmit={(event) => void agregar(event)}>
          <h3>Agregar participante</h3>
          <p className="texto-secundario">
            Se registra en esta fecha y queda disponible para todos los jurados
            del grupo.
          </p>
          {pendiente && (
            <p className="ayuda-planilla-jurado">
              Hay un alta pendiente de confirmación. Reintentá para comprobar si
              quedó registrada; no se duplicará.
            </p>
          )}
          <fieldset disabled={deshabilitado || Boolean(pendiente)}>
            <div className="campo">
              <label htmlFor={`destino-${tandaId}`}>Tanda de destino</label>
              <select
                id={`destino-${tandaId}`}
                value={formulario.destino}
                onChange={(e) =>
                  editar({ ...formulario, destino: e.target.value })
                }
              >
                {habilitadas.map((t) => (
                  <option key={t.id} value={t.id}>
                    Tanda {t.numero} · {t.entradas.length}/5 inscripciones
                  </option>
                ))}
                {!habilitadas.some((t) => t.id === formulario.destino) &&
                  formulario.destino !== "nueva" && (
                    <option value={formulario.destino}>
                      Tanda seleccionada (actualizá o elegí otra)
                    </option>
                  )}
                <option value="nueva">Crear una nueva tanda</option>
              </select>
            </div>
            {cantidad > 1 && (
              <div className="campo">
                <label htmlFor={`nombre-alta-${tandaId}`}>
                  Nombre del equipo
                </label>
                <input
                  id={`nombre-alta-${tandaId}`}
                  value={formulario.nombre}
                  required
                  onChange={(e) =>
                    editar({ ...formulario, nombre: e.target.value })
                  }
                />
              </div>
            )}
            <div className="integrantes-alta-clasi">
              {formulario.integrantes.map((alias, i) => (
                <div className="campo" key={i}>
                  <label htmlFor={`alias-alta-${tandaId}-${i}`}>
                    {cantidad === 1 ? "Alias" : `Integrante ${i + 1}`}
                  </label>
                  <input
                    id={`alias-alta-${tandaId}-${i}`}
                    value={alias}
                    required
                    autoComplete="off"
                    onChange={(e) =>
                      editar({
                        ...formulario,
                        integrantes: formulario.integrantes.map((a, n) =>
                          n === i ? e.target.value : a,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>
          {error && (
            <p className="mensaje-error" role="alert">
              {error}
            </p>
          )}
          <div className="acciones-planilla-jurado">
            <button
              type="submit"
              className="boton boton-principal"
              disabled={deshabilitado || (!activa && !pendiente)}
            >
              {guardando && (
                <LoaderCircle
                  size={17}
                  className="girando"
                  aria-hidden="true"
                />
              )}
              {guardando
                ? "Registrando…"
                : pendiente
                  ? "Confirmar alta pendiente"
                  : "Registrar participante"}
            </button>
            <button
              type="button"
              className="boton boton-secundario"
              disabled={deshabilitado || Boolean(pendiente)}
              onClick={() => setAbierto(false)}
            >
              Cerrar
            </button>
          </div>
          <p className="ayuda-planilla-jurado">
            Si la tanda tiene cinco inscripciones o alguna planilla finalizada,
            elegí otra o creá una nueva.
          </p>
        </form>
      )}
      {aviso && (
        <p className="mensaje-guardado" role="status">
          {aviso}
        </p>
      )}
    </div>
  );
}
