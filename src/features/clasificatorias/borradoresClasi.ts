import type { PuntuacionClasi } from "./juradoService";

export type BorradorJurado = {
  version: number;
  puntuaciones: PuntuacionClasi[];
};
export type EstadoPlanilla = {
  editor: BorradorJurado;
  guardada: BorradorJurado;
  origen: BorradorJurado | null;
};

export function mismosPuntos(
  a: PuntuacionClasi[],
  b: PuntuacionClasi[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function alinearPuntos(
  filas: PuntuacionClasi[],
  estructura: PuntuacionClasi[],
): PuntuacionClasi[] {
  const porId = new Map(filas.map((fila) => [fila.inscripcion_id, fila]));
  return estructura.map((fila) => porId.get(fila.inscripcion_id) ?? fila);
}

function leerPlanilla(datos: unknown): BorradorJurado | null {
  if (
    !datos ||
    typeof datos !== "object" ||
    !("version" in datos) ||
    !Number.isInteger(datos.version) ||
    (datos.version as number) < 0 ||
    !("puntuaciones" in datos) ||
    !Array.isArray(datos.puntuaciones)
  )
    return null;
  const filas: PuntuacionClasi[] = [];
  for (const fila of datos.puntuaciones) {
    if (
      !fila ||
      typeof fila.inscripcion_id !== "string" ||
      !Array.isArray(fila.casillas) ||
      !fila.casillas.every(
        (p: unknown) =>
          p === null || (typeof p === "number" && Number.isFinite(p)),
      )
    )
      return null;
    filas.push({
      inscripcion_id: fila.inscripcion_id,
      casillas: fila.casillas,
    });
  }
  if (new Set(filas.map((f) => f.inscripcion_id)).size !== filas.length)
    return null;
  return { version: datos.version as number, puntuaciones: filas };
}

export function leerBorrador(
  texto: string | null,
  estructura: PuntuacionClasi[],
  retirados: string[] = [],
): {
  editor: BorradorJurado;
  origen: BorradorJurado | null;
} | null {
  if (!texto) return null;
  try {
    const datos: unknown = JSON.parse(texto);
    const editor = leerPlanilla(datos);
    if (!editor) return null;
    const validar = (planilla: BorradorJurado) =>
      planilla.puntuaciones.every((fila) => {
        const esperada = estructura.find(
          (e) => e.inscripcion_id === fila.inscripcion_id,
        );
        return esperada
          ? esperada.casillas.length === fila.casillas.length
          : retirados.includes(fila.inscripcion_id);
      });
    if (!validar(editor)) return null;
    const origen =
      typeof datos === "object" && datos !== null && "base" in datos
        ? leerPlanilla(datos.base)
        : null;
    if (origen && !validar(origen)) return null;
    return { editor, origen };
  } catch {
    return null;
  }
}

export function reconciliarPlanilla(
  actual: EstadoPlanilla,
  remota: BorradorJurado,
  estructura: PuntuacionClasi[],
): EstadoPlanilla {
  const puntosEditor = alinearPuntos(actual.editor.puntuaciones, estructura);
  const guardada = {
    ...remota,
    puntuaciones: alinearPuntos(remota.puntuaciones, estructura),
  };
  // Recupera un guardado cuya respuesta se perdió.
  if (mismosPuntos(puntosEditor, guardada.puntuaciones)) {
    return { editor: guardada, guardada, origen: guardada };
  }
  if (actual.editor.version === guardada.version) {
    return {
      editor: { ...actual.editor, puntuaciones: puntosEditor },
      guardada,
      origen: actual.origen
        ? {
            ...actual.origen,
            puntuaciones: alinearPuntos(actual.origen.puntuaciones, estructura),
          }
        : guardada,
    };
  }
  // Rebasar cambios de participantes solo si los puntos remotos de quienes
  // siguen presentes coinciden con la base. Conservar las ediciones locales.
  const base = actual.origen;
  const anteriores = new Map(
    base?.puntuaciones.map((fila) => [fila.inscripcion_id, fila]),
  );
  const idsActuales = new Set(
    guardada.puntuaciones.map((f) => f.inscripcion_id),
  );
  const cambioEstructura =
    base &&
    (base.puntuaciones.some((f) => !idsActuales.has(f.inscripcion_id)) ||
      guardada.puntuaciones.some((f) => !anteriores.has(f.inscripcion_id)));
  const ampliacion =
    base &&
    cambioEstructura &&
    base.version === actual.editor.version &&
    guardada.puntuaciones.every((fila) => {
      const anterior = anteriores.get(fila.inscripcion_id);
      return anterior
        ? mismosPuntos([fila], [anterior])
        : fila.casillas.every((punto) => punto === null);
    });
  if (ampliacion) {
    return {
      editor: { version: guardada.version, puntuaciones: puntosEditor },
      guardada,
      origen: guardada,
    };
  }
  return {
    editor: { ...actual.editor, puntuaciones: puntosEditor },
    guardada,
    origen: base,
  };
}
