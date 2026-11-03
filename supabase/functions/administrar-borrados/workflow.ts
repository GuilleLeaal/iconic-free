export async function borrarCuenta(puertos: {
  validar: () => Promise<{ existe: boolean }>;
  borrarAuth: () => Promise<void>;
}) {
  const cuenta = await puertos.validar();
  if (cuenta.existe) await puertos.borrarAuth();
  return { eliminado: true };
}
