# Actualización 032: armado manual

La migración está preparada en el repositorio; no se aplicó a la base remota
ni se publicó el frontend desde este trabajo.

## Instalación

1. Verificar que la base tenga el esquema 001–031. Guardar un respaldo y ejecutar
   `supabase/preflight.sql` como propietario para contrastar funciones y permisos.
2. Ejecutar una sola vez el archivo completo
   `supabase/migrations/032_armados_manuales.sql`. Es una transacción: un error
   revierte la migración completa. No ejecutarlo por fragmentos.
3. Publicar el frontend después de aplicar el SQL. El frontend requiere la nueva
   columna y las RPC de 032; no es compatible con una base detenida en 031.

Se agregan una opción de armado en fechas, un borrador versionado por fecha y
la modalidad/solicitud del armado en los cierres. Las funciones de inscripción,
configuración, inicio y cierre se amplían conservando sus contratos anteriores.
Las implementaciones reutilizadas quedan privadas y sin ejecución para la API.
No se reescriben inscripciones, votos ni cruces históricos. Las fechas anteriores
conservan el modo por sorteo. Para volver al esquema anterior se requiere un
procedimiento de restauración revisado; no borrar columnas/tablas con actividad.

## Uso

- Elegir Manual al crear/configurar una fecha sin inscripciones activas.
- En Inscripciones, agregar hasta tres clasis (A/B/C), agregar rondas e inscribir
  desde cualquier lugar. Nombre de equipo opcional y alias obligatorios, como
  en el alta existente. Cada alta guarda inscripción y lugar juntos.
- La cantidad por ronda es un máximo de 1–6. No es necesario llenarla. Al iniciar
  se omiten rondas y grupos completamente vacíos, conservando el número de las
  otras rondas y el orden relativo de los participantes. Se necesitan al menos
  dos inscripciones activas en la fecha para comenzar.
- Se puede mover o intercambiar lugares entre rondas/grupos, editar inscripciones
  y retirarlas. Reincorporar una retirada también se hace desde un lugar libre.
  Quitar rondas/grupos se ofrece solo cuando están vacíos.
- El modo y el máximo se definen antes del armado. Una versión vieja de otro
  dispositivo no puede sobrescribir el armado actual. El inicio prepara el plan
  y ejecuta el inicio existente en la misma transacción: requiere jurados válidos
  en cada grupo con participantes y la planilla guardada. Si falta alguno, no
  deja un sorteo a medio preparar.
- Clasis manuales se realizan aunque no se exceda el cupo. El modo por sorteo
  conserva la regla de superar el cupo. Después del inicio se mantienen los
  permisos y flujos actuales de los jurados, incluidas las altas tardías.
- Al cerrar, elegir sorteo, puntaje o manual para la fase inicial configurada.
  Por puntaje forma cruces consecutivos según el total global; para totales
  iguales usa el orden visible del ranking. El repechaje sigue definiendo quién
  entra en el corte, independientemente del método de armado.
- La vista previa muestra el cuadro que se guardará. En manual, seleccionar a
  alguien ya ubicado intercambia los lugares. Todos los clasificados deben
  aparecer exactamente una vez; se admiten pases libres y vacantes.
- El servidor valida de nuevo versión del ranking, clasificados, tamaño de los
  cruces y orden por puntaje. Cierre y cuadro se confirman juntos. Una respuesta
  perdida admite reintentar la misma solicitud; no permite cambiar un cuadro ya
  confirmado. La llave fija o los sorteos de fases posteriores siguen igual.

## Verificación local

`npm test` incluye `tests/armados-manuales.test.mjs`: altas atómicas en lugares
libres, rondas incompletas/vacías, versiones viejas, permisos, retiro/reactivación,
orden por puntaje en los tres formatos, cuadros manuales, copia de configuración,
avance de ganador y actualización 031 → 032 sin alterar votos/cuadros históricos.

Se prepararon diez casos de navegador (cinco en escritorio y cinco en móvil) en
`tests/ui/armados.spec.ts`. Su recolección con `--list` pasó; la ejecución quedó
bloqueada por el acceso a localhost del sandbox y no fue autorizada fuera de él.
La apariencia y las interacciones en navegador siguen pendientes de validación.
Las pruebas SQL utilizan PostgreSQL/PGlite local; no acreditan integración real
con Supabase Auth/PostgREST. La concurrencia con conexiones nativas simultáneas
no se ejecutó en este trabajo.
