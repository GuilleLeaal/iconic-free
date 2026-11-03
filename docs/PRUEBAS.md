# Verificación

Fecha de trabajo: 2 de noviembre de 2026, America/Montevideo.

## Ejecutado

- `npm test`: reconstrucción 001–028 y actualización desde 001–015 en
  PostgreSQL/PGlite 0.5.14; seis pruebas del flujo privilegiado de invitación.
  Incluye seis regresiones de 018: adopción de tabla/RPC preexistentes sin
  modificar datos, rechazo de columnas adicionales obligatorias, CHECK de fase
  desconocido y retorno incompatible de la RPC, comprobando rollback; auditoría
  histórica NOT NULL sin defaults con guardado, alta de fase y copia; rechazo de
  tipos de auditoría incompatibles. Se comprueba también el diagnóstico JSON.
- `npm run build`: TypeScript y Vite generan el bundle.
- `npm run check:edge`: tipos de la función contra supabase-js 2.117.2.
- `npm run check:bundle`: bundle sin referencias a clave privilegiada, claves
  secretas ni JWT de service_role.
- `npm run lint`: sin errores; advertencias de efectos React en componentes
  existentes. Vite informa un bundle principal de aproximadamente 619 kB antes
  de gzip.
- `npm run test:ui`: veinticuatro pruebas pasan en Chromium desktop y Pixel 7,
  mediante fixtures interceptados en localhost. Incluyen un recorrido visual de acceso, fechas, inscripciones, sorteos, clasificatorias, resultados, eliminatorias, configuración, cuentas y planillas; búsqueda, navegación y ausencia de desbordes horizontales.
- `npm run test:concurrencia`: reconstrucción en PostgreSQL 18.6 nativo, Windows
  x64; conexiones distintas para voto/configuración, cierre con versión vieja
  y voto/revocación; se agrega voto/eliminación de fecha. Todas pasan, sin pérdida de notas.

## Alcance de las pruebas de base

Bootstrap UUID/correo, rechazo de autopromoción, vínculos por contexto, cuentas
sin vínculo, RLS y RPC directas entre competencias, revocación sin borrar votos,
privacidad entre jurados, límites/asignaciones bloqueadas al iniciar clasis,
correo normalizado y aceptación personal, directorios paginados sin vínculos
ajenos, invitaciones pendientes/canceladas/renovadas, reserva de envío exclusiva
de servidor, integridad con IDs mezclados y ACL de funciones privadas.

La 025 prueba eliminación con confirmación/cancelación y reintento en navegador;
permisos entre competencias, ausencia de DELETE directo, ocultación de recursos
y bloqueo de sesiones viejas; conservación de votos, inscripciones y copias;
auditoría idempotente y eliminación de fechas en curso o finalizadas. La prueba
nativa usa dos conexiones para comprobar la carrera con un voto.

Seis combinaciones, debajo/en/encima del cupo, 20/16 y más de 28/32,
inscripciones por equipos, clasis siempre/automáticas, grupos manuales,
reparto/máximo por tanda, altas tardías idempotentes sin perder borradores,
decimales/cero/null, ranking/cupos efectivos, cero/una puntuadas,
repechaje invalidado por cambio de cupo, cierre repetido, regeneración pendiente
con historial, bloqueo después del cierre, copia sin actividad, campeonato
desde ambas fases y modalidades, sorteo repetido sin alteración y corrección de
final.

El correo se prueba con puertos controlados: cuenta nueva/existente, respuesta
perdida, error SMTP, fallo entre Auth/base y permiso revocado. No acredita
entrega real.

## Pendiente de instalación

No se accedió al esquema remoto ni a su historial real. No se ejecutaron
migraciones remotas, resets, invitaciones reales, cambios de credenciales,
publicación ni despliegue. Falta contrastar el preflight, proporcionar UUID y
correo del administrador, aplicar los correctivos faltantes, ejecutar el
bootstrap y configurar/publicar la función con SMTP/redirects.

No se ejecutó el runtime completo de Supabase Edge/GoTrue en este equipo. Su
integración con correo y PostgREST debe verificarse durante la instalación
autorizada. La prueba de interfaz acredita comportamiento del cliente con sus
fixtures y se complementa con pruebas SQL reales de seguridad.

La 026 verifica configuración con máximo seis, rechazo de siete por RPC y CHECK, y sorteo de 18 inscripciones en tres tandas de seis. La interfaz comprueba la ausencia del selector de clasificatorias, la explicación del cupo y la selección de seis en escritorio y celular.

La 027 se aplica también sobre el flujo histórico hasta 026: comprueba que 12 y 16 inscripciones pasan directo a octavos y 17 requieren clasificatorias, incluso con el modo histórico siempre. Conserva votos previos y el reintento del sorteo. Las pruebas históricas previas mantienen su configuración para acreditar la actualización sin pérdida de datos.

La interfaz verifica que no aparecen planillas de eliminatorias ni un selector de jurados de eliminatorias. El panel de eliminatorias identifica el registro de ganadores por organización; las puntuaciones de jurados se limitan a clasificatorias.

La 028 verifica retiros con jurados asignados y acceso activo, rechazo de actores ajenos y versiones viejas, idempotencia, auditoría privada con borradores previos, conservación de cero y notas restantes, retiro de toda una tanda y bloqueo por finalización/revocación. Inicia tandas reales de seis. En Chromium se prueban confirmación/cancelación, conservación de borradores locales, recarga, error y reintento. En PostgreSQL nativo se comprueba retiro/finalización en ambos órdenes con conexiones distintas.
