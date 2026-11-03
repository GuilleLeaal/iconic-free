# Actualización 029–030

La base debe tener aplicadas 001–028. En el SQL Editor de Supabase, ejecutar
primero `supabase/migrations/029_borrado_definitivo.sql` y después
`supabase/migrations/030_nombres_de_usuario.sql`, completas y una sola vez.
Estas migraciones crean las operaciones y adaptan sus relaciones; aplicarlas
no elimina usuarios, competencias ni datos existentes.

La función Edge `administrar-borrados` se publicó en el proyecto `iconic-free`
(`wwljmvtpdqocbxvbsfvi`), con `verify_jwt=true`. Utiliza el `APP_URL` existente,
`https://iconic-free.vercel.app`, y las claves de servidor del runtime.
No requiere agregar secretos a Vercel. Su prueba sin sesión devuelve 401;
no se realizaron borrados sobre el proyecto remoto.

Después de los dos SQL, publicar el frontend actualizado en Vercel. Sus
variables públicas siguen siendo `VITE_SUPABASE_URL` y
`VITE_SUPABASE_PUBLISHABLE_KEY`.

## Comportamiento

- Administración global → Competencias → Eliminar definitivamente: pide
  escribir el nombre y borra la competencia, sus fechas (también las quitadas
  de la interfaz), inscripciones, planillas, votos, sorteos, cierres, resultados,
  vínculos e invitaciones. Las cuentas personales siguen existiendo.
- Administración global → Directorio → Eliminar cuenta definitivamente: pide
  escribir el correo y usa `auth.admin.deleteUser(id, false)`. El borrado de
  Auth, perfil, vínculos, asignaciones, votos e invitaciones es físico.
  Fechas y resultados creados por esa persona se conservan sin atribución.
  Un correo eliminado puede recibir una invitación nueva, crear una cuenta
  con UUID nuevo y volver a elegir el nombre de usuario que quedó libre.
- No se permite borrar la propia cuenta de administración global. Los
  organizadores no tienen acceso a los borrados globales.
- Si hay un envío de invitación en curso para la cuenta/competencia, el
  borrado espera a que finalice o venza su reserva; el error permite reintentar.
- Mi cuenta permite elegir o cambiar el nombre de usuario. Es único y se
  normaliza a minúsculas. En invitaciones/recuperación se pide junto con la
  contraseña. El correo sigue siendo el identificador de inicio de sesión.

El borrado físico es definitivo: quitar un jurado también elimina sus votos.
La desactivación de vínculos continúa disponible para retirar acceso
conservando actuaciones. Eliminar una fecha individual conserva su historial
según la migración 025; borrar su competencia elimina todo ese historial.

## Verificación local

`npm test`, `npm run build`, `npm run check:edge`, `npm run check:bundle`,
`npm run lint`, `npx playwright test` (34 escenarios) y
`node tests/concurrencia.mjs`. Lint conserva siete advertencias previas de
efectos React y Vite informa el aviso de tamaño del bundle.
