export type InitialDrawMode = 'sorteo' | 'puntaje' | 'manual';
export type InitialCross = { numero: number; inscripciones: (string | null)[] };
export type ConfirmedCross = { numero: number; inscripciones: string[] };

export function buildInitialCrosses(ids: string[], mode: InitialDrawMode, perCross: number, crossCount: number): InitialCross[] {
  const crosses: InitialCross[] = Array.from({ length: crossCount }, (_, i) => ({ numero: i + 1, inscripciones: Array(perCross).fill(null) }));
  if (mode === 'manual') return crosses;
  const ordered = [...ids];
  if (mode === 'sorteo') {
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }
  ordered.forEach((id, index) => {
    let cross = Math.floor(index / perCross);
    let position = index % perCross;
    if (mode === 'sorteo') {
      let value = index % crossCount;
      cross = 0;
      for (let n = crossCount; n > 1; n /= 2) { cross = cross * 2 + value % 2; value = Math.floor(value / 2); }
      position = Math.floor(index / crossCount);
    }
    crosses[cross].inscripciones[position] = id;
  });
  return crosses;
}

export function confirmableCrosses(crosses: InitialCross[]): ConfirmedCross[] {
  return crosses.map(c => ({ numero: c.numero, inscripciones: c.inscripciones.filter((id): id is string => id !== null) }));
}
