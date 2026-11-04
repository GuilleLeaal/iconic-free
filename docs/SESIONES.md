# Sesiones

La aplicación pide ingresar nuevamente después de 60 minutos sin interacción
o al cumplir 12 horas de sesión. Dos minutos antes muestra un diálogo con el
tiempo restante. «Continuar sesión» reinicia la espera por inactividad; no
extiende la duración máxima de 12 horas.

Solo cuentan interacciones del usuario (teclado, entrada, pulsación, rueda o
toque). Consultas automáticas, renovación del token y recuperar el foco no
reinician la espera. Al volver de una suspensión se comprueba el vencimiento
antes de aceptar otra interacción.

El estado se conserva por sesión y se comparte entre las pestañas del mismo
origen. Recargar la página no reinicia el plazo. Una sesión vencida no vuelve
a habilitar la interfaz aunque el cierre contra Auth falle por falta de red.
Si el navegador bloquea el almacenamiento, el plazo se mantiene en memoria
para esa pestaña; la persistencia entre recargas y pestañas no está garantizada.

Se solicita el cierre con `scope: local`, sin cerrar las sesiones de otros
dispositivos ni borrar los borradores existentes. La competencia y el rol se
recuerdan en esa pestaña, por usuario. Al volver a ingresar se vuelven a consultar
los accesos: solo se restaura una competencia que siga autorizada. Los borradores
continúan sujetos a la reconciliación con el estado actual del servidor.

## Alcance de seguridad y plan Free

Estos plazos controlan la interfaz y el cierre voluntario mediante Supabase Auth.
**No son una validación de vencimiento en servidor**: alguien que modifique el
navegador o use un JWT directamente puede omitir el temporizador. Un JWT emitido
puede seguir siendo válido hasta su vencimiento incluso después del cierre.

El proyecto utiliza el plan Free. Los controles nativos de duración máxima e
inactividad de Supabase requieren Pro o superior y no se activaron. No se
cambiaron tablas, políticas RLS, funciones Edge ni ajustes del proyecto remoto.
Para exigir límites en servidor con Free hace falta diseñar y desplegar un
control adicional que cubra las RPC, los accesos a tablas y las funciones Edge.

Si se habilitan controles nativos en un plan compatible, el máximo propuesto es
12 horas. Su inactividad se mide desde la última renovación del token, no desde
la última interacción de una persona, y se comprueba al renovar la sesión.

Referencia: [sesiones de Supabase](https://supabase.com/docs/guides/auth/sessions).

## Validación

Las pruebas de navegador usan Auth y datos simulados en localhost. Comprueban
el aviso, continuidad, vencimiento, recarga, pestañas y recuperación del contexto.
No verifican límites del servidor remoto ni envían correos reales.
