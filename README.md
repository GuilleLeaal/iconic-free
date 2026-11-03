# Competencias de freestyle de Uruguay

React, TypeScript, Vite y Supabase. Cuentas personales con vínculos por
competencia: una persona puede organizar y juzgar en contextos distintos.
Iconic conserva sus fechas y su administración propia.

Las votaciones web son únicamente para clasificatorias. En las eliminatorias (dieciseisavos, octavos, cuartos, semifinal y final), organización registra el ganador de cada cruce; no hay planillas de puntuación ni votaciones de jurados en la web.

## Desarrollo

Requiere Node 24+. Copiar `.env.example` a `.env.local` y configurar solo la URL
y clave pública del proyecto de desarrollo. No usar secretos en `VITE_*`.

```sh
npm ci
npm run dev
npm run build
npm run lint
```

El frontend requiere el esquema hasta 028 y el bootstrap. Las simulaciones de
API se utilizan únicamente en las pruebas de navegador.

## Instalación de base y actualización

**No se inspeccionó ni modificó Supabase remoto.** Antes de instalar, guardar un
respaldo y ejecutar `supabase/preflight.sql`, que contiene solo lecturas.
Comparar sus funciones, ACL, RLS, tablas, constraints, índices, triggers y vistas
con el repo. No declarar aplicada una migración basándose solo en Git.

- Base nueva con Supabase Auth: aplicar 001–028 en orden, una vez cada archivo.
- Base con exactamente 001–015: aplicar **solo 016–028**, en orden.
- Si ya aplicaste hasta 027, ejecutar **solo 028_retiro_por_ausencia_con_contexto.sql** para restaurar el retiro por ausencia por jurados asignados y completar el soporte de tandas de seis.
- Si ya aplicaste hasta 026, ejecutar 027 y 028, en orden. Los sorteos nuevos realizan clasificatorias únicamente si se supera el cupo; se conservan los sorteos y votos existentes.
- Si ya aplicaste hasta 025, ejecutar 026, 027 y 028, en orden. La 026 permite hasta seis inscripciones por tanda y mantiene el valor predeterminado de cinco.
- Si ya aplicaste 016–024, ejecutar 025, 026, 027 y 028, en orden. La 025 habilita
  la eliminación de fechas; no repetir el bootstrap ni las migraciones previas.
- No repetir 013: elimina un índice y una función. No ejecutar `db reset` ni
  `db push` contra un historial desconocido.
- Las primeras quince migraciones no fueron reescritas. La 007 permanece vacía:
  018 repara explícitamente la configuración de fases sin introducir votos web
  de eliminatorias.
- La 018 puede adoptar `planillas_fases` y la RPC exacta preexistentes cuando
  cumplen el contrato comprobado: conserva datos y columnas adicionales
  compatibles, reemplaza las políticas, amplía el CHECK enumerado de fases y
  revoca los overloads antiguos. Si hay columnas, triggers, CHECK o firma de RPC
  incompatibles, se detiene y revierte toda la 018. Ejecutar entonces
  `supabase/inspeccionar-planillas-fases.sql` para revisar las diferencias.
  La 024 rechaza referencias incompatibles. No se ocultan esos errores con
  `IF EXISTS` generales.

La auditoría histórica `actualizado_por`, `actualizado_en` y `creado_en` se
conserva. Guardar y copiar completan explícitamente esos campos incluso si la
tabla previa los exige sin defaults. Cuando una tabla mínima no los tenía, se
agregan sin rellenar autores ni timestamps históricos desconocidos.

| Migración | Cambio |
| --- | --- |
| 016 | Competencias, vínculos, administrador, RLS y bootstrap |
| 017 | RPC con permisos sobre la fecha, vacíos y retiro deshabilitado |
| 018 | Configuración, reparación 007, sorteos y cuadros |
| 019 | Ranking con vacíos, cupos efectivos y cierre |
| 020 | Sorteos/correcciones desde dieciseisavos |
| 021 | Edición versionada, regeneración confirmada y copia |
| 022 | Invitaciones, aceptación, directorio y auditoría |
| 023 | Contextos personales y jurados paginados |
| 024 | Integridad entre recursos e índices |
| 025 | Eliminación de fechas, auditoría y bloqueo de accesos posteriores |
| 026 | Máximo configurable de hasta seis inscripciones por tanda |
| 027 | Clasificatorias únicamente si las inscripciones superan el cupo |
| 028 | Retiro por ausencia con permisos por competencia y tandas iniciadas de hasta seis |

La actualización deja inicialmente las fechas antiguas sin competencia y sin
acceso. En una ventana de mantenimiento, aplicar todos los correctivos y luego
ejecutar como propietario SQL el bootstrap con UUID y correo **reales y
comprobados** de Supabase Auth:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v ADMIN_UUID="UUID_REAL" -v ADMIN_EMAIL="CORREO_REAL" -f supabase/bootstrap-iconic.sql
```

El script valida la coincidencia UUID/correo, crea Iconic, asocia las fechas
existentes, vincula sus jurados históricos y conserva los organizadores
anteriores únicamente como organizadores de Iconic. El UUID indicado es el
único administrador global. Repetir el bootstrap falla; no permite reemplazar
al administrador. Su ejecución está revocada para la API. No se infiere identidad
por nombre, metadata ni antigüedad.

No se borran cuentas, votos ni resultados. No hay un reset incluido. Las futuras
fechas deben indicar su competencia. Las fechas antiguas conservan sorteos y
configuración; sus campos nuevos no reciben valores retroactivos. Para generar
un nuevo sorteo deben elegirse explícitamente las opciones. Los cierres
confirmados conservan su snapshot y no se restauran retiros históricos de 015.

Si la 018 anterior falló con `relation "planillas_fases" already exists` al
ejecutar el archivo completo, reintentar **solo la 018 completa actualizada** y
después continuar con 019–024. No borrar la tabla ni repetir 016/017. Si se
ejecutaron fragmentos o aparecen columnas de 018 ya instaladas, ejecutar la
consulta acotada de inspección antes de seguir. Una instalación donde 018 ya
terminó correctamente no debe volver a aplicarla.

## Instalar correo y servidor

La Edge Function `supabase/functions/gestionar-invitacion` usa supabase-js
2.117.2. Configurar en servidor `APP_URL` con el origen de la app, sin barra
final. Supabase proporciona `SUPABASE_URL`, `SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY` al runtime. Estos secretos no van en `.env.local`
del frontend ni en el hosting estático.

La instalación técnica autorizada requiere publicar `gestionar-invitacion` con
el CLI, configurar `APP_URL` y mantener `verify_jwt=true` según `config.toml`.
La función además usa `auth.getUser(token)` y toma el actor de esa respuesta.
PostgreSQL comprueba sus permisos actuales antes del envío; las RPC de reserva
y confirmación son exclusivas de `service_role`.

Comandos para ejecutar únicamente en la instalación autorizada, reemplazando
el proyecto y el dominio:

```sh
supabase secrets set APP_URL=https://TU_DOMINIO --project-ref TU_PROJECT_REF
supabase functions deploy gestionar-invitacion --project-ref TU_PROJECT_REF
```

Para el frontend, generar `dist/` con las variables públicas del proyecto de
destino y publicar esa carpeta en el hosting estático elegido. Configurar
fallback de rutas a `index.html`. No usar el servidor de desarrollo como hosting.

En Supabase Auth configurar Site URL, Redirect URLs y SMTP con ese origen,
habilitar confirmación de correo y revisar plantillas de invitación/recuperación
para conservar el enlace oficial de confirmación. Probar entrega, expiración y
redirects antes de habilitar operadores. No se enviaron correos reales aquí.

APIs contrastadas con documentación oficial:
[Edge Auth](https://supabase.com/docs/guides/functions/auth),
[getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
[invitación](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail),
[recuperación](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail).

## Uso

- Administración global crea competencias e invita organizadores/jurados.
  Los directorios se buscan y paginan en servidor. Organización ve únicamente
  vínculos de su competencia.
- **Eliminar fecha** está disponible en su tarjeta y dentro de la fecha, con
  confirmación del nombre y la competencia. La quita de la aplicación y bloquea
  operaciones de jurados y organizadores, incluso con pantallas viejas. Conserva
  físicamente inscripciones, planillas, resultados y copias independientes. La
  eliminación queda auditada; reintentar una respuesta perdida no la duplica.
  No elimina competencias, cuentas ni vínculos y no ejecuta DELETE sobre los
  datos históricos.
- Invitar prepara un vínculo pendiente. Se reutiliza una cuenta existente sin
  modificar su contraseña; la cuenta nueva recibe invitación de Auth. Para una
  existente se envía recuperación y también puede ingresar con su contraseña.
  El dueño acepta el vínculo desde la web. Aceptar no asigna una fecha/grupo.
- Los enlaces de invitación/recuperación permiten establecer una contraseña
  personal. Un enlace vencido explica cómo solicitar otro desde el login. El
  panel permite reenviar y distingue un envío nuevo de uno ya registrado. Un
  fallo no se informa como éxito. Una reserva vence a los 90 segundos para
  recuperar fallos parciales; nunca se elimina una cuenta para compensarlos.
  El panel de invitaciones pendientes permite buscar, paginar, consultar entrega
  y vencimiento, renovar/reenviar o cancelar sin borrar la cuenta personal.
- Buscar y asignar jurados ya vinculados desde cada fecha. Las asignaciones
  quedan bloqueadas al iniciar clasis. Se pueden preparar cuentas para próximas
  fechas en cualquier momento. Esta versión conserva grupos A/B/C, automáticos
  o manuales de 1–3, con igual cantidad configurada de jurados.
- Cambiar competencia/rol limpia la pantalla. Los borradores de voto pertenecen
  al usuario y tanda; los de repechaje incluyen usuario y versión del ranking.
  Una revocación bloquea nuevas operaciones aun con sesión vieja.
- Las fechas nuevas empiezan con octavos/duelos/16 cupos. Se ofrecen las seis
  combinaciones, tandas de 1–6, clasificatorias solo al superar el cupo y sorteo entre fases
  o llave fija. Después de la primera fase hay duelos. No hay límite de
  inscripciones. Copiar crea otra fecha autorizada con configuración y planillas
  independientes, sin participantes, jurados ni actividad.
- Un cambio que invalida el sorteo pendiente pide confirmación y conserva el
  anterior. Durante clasis solo cambia el tipo inicial y su cupo; conserva
  jurados, grupos, tandas y notas e invalida cortes/repechajes viejos. Un cierre
  confirmado o batalla manual bloquea cambios. Un pase libre no es una batalla.
- Finalizar admite vacíos y confirma cuántos hay y quién quedó sin puntuar.
  `null` permanece vacío y `0` cuenta. Solo se suman números de planillas
  finalizadas. Quien no tiene ninguna nota queda sin puesto/puntos y fuera del
  corte/repechaje. El cierre clasifica la cantidad efectiva con pases libres;
  menos de dos puntuados permite entregar planillas pero no iniciar el cuadro.

## Pruebas

```sh
npm test
npm run check:edge
npm run check:bundle
npx playwright install chromium
npm run test:ui
npm run test:concurrencia
```

`npm test` reconstruye en PostgreSQL/PGlite y prueba por separado actualizar
001–015 → 024. Incluye permisos, formatos, clasis, altas, cierre, campeonato y
seis pruebas del flujo de correo. El fixture reproduce `auth.users` y
`auth.uid()`; no es una instalación completa de GoTrue/PostgREST.

Las dieciséis pruebas de Chromium usan desktop y Pixel 7 con API interceptada en
localhost. No consultan el Supabase real. La comprobación Edge usa los tipos
reales de supabase-js y una declaración mínima de las dos APIs Deno utilizadas.

Concurrencia crea PostgreSQL nativo únicamente en localhost y
`.test-postgres/<UUID>`, reconstruye el esquema y usa conexiones separadas.
No acepta URL remota. Detiene el clúster y conserva archivos/logs de prueba en
esa carpeta ignorada. En Linux ejecutarlo con una cuenta sin privilegios root;
no crea usuarios del sistema.

Ver [diagnóstico y plan](docs/IMPLEMENTACION.md) y
[resultados y límites](docs/PRUEBAS.md).

Los jurados asignados pueden retirar participantes por ausencia de su tanda mientras ninguna planilla esté finalizada. El retiro se aplica a todo el grupo, conserva las demás notas y registra en auditoría privada la entrada y los borradores anteriores. La inscripción general y el sorteo histórico permanecen guardados.
