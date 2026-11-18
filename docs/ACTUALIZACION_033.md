# Actualización 033: equipos incompletos

La migración está preparada en el repositorio. No se aplicó a la base remota ni se publicó el frontend desde este trabajo.

## Instalación

1. Verificar que la base tenga el esquema hasta 032, guardar un respaldo y contrastar funciones y permisos con `supabase/preflight.sql`.
2. Ejecutar una vez el archivo completo `supabase/migrations/033_equipos_incompletos.sql`. Es transaccional: un error revierte el archivo completo. No ejecutar por fragmentos.
3. Publicar el frontend después del SQL. El frontend permite enviar equipos incompletos; una base detenida en 032 los rechaza.

## Comportamiento e impacto

- El tamaño del formato es un máximo. Altas, edición, inscripción en rondas manuales y altas tardías aceptan entre 1 y ese máximo; individual conserva exactamente un alias.
- En los formularios se dejan vacíos los lugares libres. La API recibe solo los alias completados; rechaza listas vacías, alias vacíos/nulos, duplicados y equipos que excedan el máximo.
- La edición permite agregar y quitar integrantes, conserva la inscripción y los identificadores de las posiciones que permanecen. Mantiene permisos, versiones, bloqueos por fecha e historial con el estado anterior y posterior.
- No se reescriben inscripciones, sorteos, votos ni resultados existentes. No se cambian tablas ni contratos de las RPC. Las funciones internas de 032 conservan sus restricciones de acceso.
- Las votaciones ya funcionan por inscripción: cada equipo tiene una fila con las casillas configuradas y un total por jurado. El ranking suma esos totales por equipo, sin multiplicar ni promediar por cantidad de integrantes. Las altas tardías agregan una sola fila y conservan las notas existentes.

La migración reemplaza tres funciones. Para revertir no alcanza con restaurar 031: la edición fue trasladada al esquema privado en 032 y podrían existir equipos incompletos. Se requiere revisar esos datos y preparar una restauración compatible; no eliminar equipos para volver atrás.

## Validación

`tests/equipos-incompletos.test.mjs` cubre actualización desde 032, tamaños de 1 al máximo, límites y alias inválidos, edición con cambios de tamaño, permisos/versiones, historial, rondas manuales, totales iguales para equipos de 1 y 5 con dos jurados y altas tardías con reintentos.

Las pruebas de navegador en `tests/ui/equipos.spec.ts` y `tests/ui/armados.spec.ts` usan una API simulada; las pruebas SQL usan PostgreSQL/PGlite local. No acreditan integración con Supabase remoto ni concurrencia de conexiones nativas.

Validación ejecutada: `npm test` (34 pruebas y recorridos de regresión), build, lint, comprobación del bundle y `git diff --check`. Lint conserva las advertencias existentes de efectos React y build informa el tamaño del bundle. Se verificaron 30 casos de navegador entre escritorio y móvil: 24 de equipos/inscripción manual y 6 de cruces. Estos últimos pasaron al corregir sus selectores de prueba para buscar los controles por rol y nombre accesible. El navegador se ejecutó fuera del sandbox porque este bloqueaba localhost.
