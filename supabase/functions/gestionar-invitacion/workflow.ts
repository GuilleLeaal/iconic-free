export type Reserva = { enviada: boolean; email?: string; existe?: boolean; lease?: string };
export type PuertosInvitacion = {
  reservar: () => Promise<Reserva>;
  invitar: (email: string) => Promise<void>;
  recuperar: (email: string) => Promise<void>;
  registrar: (lease: string, exito: boolean) => Promise<void>;
};

// Una respuesta perdida se recupera de la reserva persistida. Nunca elimina
// cuentas ni cambia contraseñas para compensar fallos entre Auth y PostgreSQL.
export async function enviarInvitacion(puertos: PuertosInvitacion) {
  const reserva = await puertos.reservar();
  if (reserva.enviada) return { enviada: true, reutilizada: true };
  if (!reserva.email || !reserva.lease) throw new Error('Reserva de envío inválida.');
  let enviado = false;
  try {
    if (reserva.existe) await puertos.recuperar(reserva.email);
    else await puertos.invitar(reserva.email);
    enviado = true;
  } finally {
    // Si Auth respondió pero falló este registro, no afirmar éxito. Al vencer
    // la reserva se puede reintentar; se detectará la cuenta ya existente.
    await puertos.registrar(reserva.lease, enviado);
  }
  return { enviada: true, reutilizada: false };
}
