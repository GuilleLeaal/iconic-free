-- Ejecutar completo en Supabase -> SQL Editor, como postgres.
-- BORRADO DEFINITIVO de los datos de la app y de todas las cuentas excepto
-- la registrada en private.administrador_plataforma. No es una migración.
-- Conserva su perfil, nombre de usuario, contraseña y acceso de administrador.
-- Conserva tablas, políticas, funciones, configuración e historial de migraciones.

begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Evitar cambios de cuentas, administrador o envíos durante esta operación.
lock table auth.users, private.administrador_plataforma, private.invitaciones
  in access exclusive mode;

do $$
declare administrador uuid; recursos oid[]; lista_tablas text;
begin
  if (select count(*) from private.administrador_plataforma) <> 1 then
    raise exception 'Se necesita exactamente un administrador principal. No se borró nada.';
  end if;

  select a.usuario_id into administrador
  from private.administrador_plataforma a
  join auth.users u on u.id = a.usuario_id
  join public.perfiles p on p.id = a.usuario_id;

  if administrador is null then
    raise exception 'No se encontró la cuenta y el perfil del administrador. No se borró nada.';
  end if;

  if exists(select 1 from private.invitaciones where lease_hasta > now()) then
    raise exception 'Hay invitaciones enviándose. Esperá 90 segundos y ejecutá de nuevo.';
  end if;

  -- Detectar las dependencias reales, incluidas tablas históricas que ya no
  -- están en las migraciones del repositorio (por ejemplo modalidades_jurados_fecha).
  -- UNION evita ciclos; las dependencias de dependencias también se incluyen.
  with recursive dependencias(oid) as (
    select unnest(array[
      'public.competencias'::regclass::oid,
      'public.fechas'::regclass::oid,
      'public.inscripciones'::regclass::oid,
      'public.inscripcion_integrantes'::regclass::oid,
      'public.inscripciones_historial'::regclass::oid,
      'public.sorteos'::regclass::oid,
      'public.jurados_fecha'::regclass::oid,
      'public.planillas_fecha'::regclass::oid,
      'public.planillas_fases'::regclass::oid,
      'public.cruces_eliminatorias'::regclass::oid,
      'public.sorteos_fases_eliminatorias'::regclass::oid,
      'public.historial_resultados_eliminatorias'::regclass::oid,
      'public.clasificatorias'::regclass::oid,
      'public.grupos_clasificatorias'::regclass::oid,
      'public.jurados_clasificatorias'::regclass::oid,
      'public.tandas_clasificatorias'::regclass::oid,
      'public.votaciones_clasificatorias'::regclass::oid,
      'public.cierres_clasificatorias'::regclass::oid,
      'public.vinculos_competencia'::regclass::oid,
      'public.auditoria_accesos'::regclass::oid,
      'public.historial_configuracion_fecha'::regclass::oid,
      'private.altas_clasificatorias'::regclass::oid,
      'private.retiros_clasificatorias'::regclass::oid,
      'private.copias_fecha'::regclass::oid,
      'private.invitaciones'::regclass::oid
    ])
    union
    select fk.conrelid from pg_catalog.pg_constraint fk
    join dependencias d on d.oid=fk.confrelid where fk.contype='f'
  ) select array_agg(oid order by oid) into recursos from dependencias;

  -- Nunca ampliar el TRUNCATE a perfiles, administrador ni esquemas de sistema.
  if 'public.perfiles'::regclass::oid=any(recursos)
     or 'private.administrador_plataforma'::regclass::oid=any(recursos)
     or exists(select 1 from pg_catalog.pg_class t
       join pg_catalog.pg_namespace n on n.oid=t.relnamespace
       where t.oid=any(recursos) and n.nspname not in ('public','private')) then
    raise exception 'Una dependencia afecta cuentas o un esquema protegido. Se detuvo la limpieza sin borrar datos.';
  end if;

  select string_agg(format('%I.%I',n.nspname,t.relname),', ' order by n.nspname,t.relname)
    into lista_tablas from pg_catalog.pg_class t
    join pg_catalog.pg_namespace n on n.oid=t.relnamespace where t.oid=any(recursos);
  raise notice 'Tablas que se vaciarán: %', lista_tablas;
  -- Sin CASCADE: solo se vacía la lista comprobada y se conservan las cuentas
  -- hasta el DELETE selectivo siguiente. Incluye fechas eliminadas lógicamente.
  execute 'truncate table ' || lista_tablas || ' restart identity';

  -- El perfil se elimina por su FK ON DELETE CASCADE de Auth.
  -- Supabase elimina asimismo las identidades y sesiones dependientes.
  delete from auth.users where id <> administrador;

  if (select count(*) from auth.users) <> 1
     or (select count(*) from public.perfiles) <> 1
     or not exists(select 1 from public.perfiles where id = administrador) then
    raise exception 'No se pudo conservar únicamente la cuenta principal. Se revierte toda la limpieza.';
  end if;
end;
$$;

commit;

-- Resultado: la única cuenta conservada, sin exponer contraseña ni tokens.
select u.id, u.email, p.nombre, 'Administrador principal conservado' as resultado
from private.administrador_plataforma a
join auth.users u on u.id = a.usuario_id
join public.perfiles p on p.id = a.usuario_id;
