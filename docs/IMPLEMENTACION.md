# Plataforma de competencias: diagnóstico y ejecución

Base auditada: `5de7140e115008724bb4b1a71085190236b815c9`, igual a
`origin/main` al iniciar. No había cambios locales. Rama:
`codex/plataforma-competencias`.

## Hallazgos

El cliente usa roles globales excluyentes. Las políticas y RPC confían en
`private.es_organizacion()` sin verificar la fecha. Un filtro React no corrige
ese acceso. La migración 007 está vacía; faltan tabla y RPC de configuración
de fases. El 013 elimina objetos y debe ejecutarse una sola vez. El 015
retira filas; no se restaurarán retiros históricos. No se inspeccionó Supabase
remoto ni se ejecutaron operaciones remotas.

## Mapa de permisos propuesto

| Actor | Alcance | Autoridad |
| --- | --- | --- |
| Administrador global | Todas las competencias; habilitar organizadores | UUID explícito instalado por propietario SQL |
| Organizador | Sus competencias activas; fechas, jurados y resultados | Vínculo activo de base, consultado en cada operación |
| Jurado | Sus grupos asignados; sus propias planillas | Vínculo activo y asignación concreta |
| Cuenta sin vínculo | Perfil propio e invitaciones propias | No accede a fechas |

Los roles pueden coexistir. Los metadatos de Auth y el rol histórico del
perfil no confieren permisos. Los cambios de vínculo son auditados y no
borran actividad. Los recursos resuelven su competencia a través de una fecha.

## Etapas

1. Esquema, bootstrap explícito, RLS y actualización de todas las RPC.
2. Finalización con vacíos, ranking, cierre y protección de versiones.
3. Configuración de fechas, sorteos, fases y copia de configuración.
4. Administración web, invitaciones de servidor y contextos personales.
5. Reconstrucción limpia, actualización y pruebas de aislamiento y flujos.

La instalación remota, el envío real de correos y el despliegue requieren una
instrucción explícita. El UUID del administrador es un dato de instalación;
no se infiere ni se agrega un UUID ficticio.
