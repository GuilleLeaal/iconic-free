begin;

-- Funciones internas de permisos.
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

-- Cada usuario de Supabase Auth tendrá un perfil.
create table public.perfiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nombre text not null check (length(trim(nombre)) > 0),
    rol text not null default 'jurado'
        check (rol in ('organizacion', 'jurado')),
    creado_en timestamptz not null default now()
);

-- Una fecha representa una edición de la competencia.
create table public.fechas (
    id uuid primary key default gen_random_uuid(),

    nombre text not null check (length(trim(nombre)) > 0),
    fecha_evento date,

    -- 1: individual; 2: parejas; 3: equipos de tres; etc.
    integrantes_por_equipo integer not null default 1
        check (integrantes_por_equipo >= 1),

    jurados_eliminatorias integer not null default 3
        check (jurados_eliminatorias in (3, 5)),

    jurados_por_grupo_clasi integer not null default 2
        check (jurados_por_grupo_clasi between 1 and 5),

    estado text not null default 'borrador'
        check (
            estado in (
                'borrador',
                'inscripciones',
                'en_curso',
                'finalizada',
                'archivada'
            )
        ),

    creado_por uuid not null default auth.uid()
        references public.perfiles(id),

    creado_en timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);

create index fechas_creado_en_idx
    on public.fechas (creado_en desc);

-- Se consulta el rol guardado en la base de datos.
-- El usuario no puede asignarse este rol desde el frontend.
create function private.es_organizacion()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.perfiles
        where id = auth.uid()
          and rol = 'organizacion'
    );
$$;

revoke all on function private.es_organizacion()
    from public, anon, authenticated;

grant execute on function private.es_organizacion()
    to authenticated;

-- Crear automáticamente el perfil al crear un usuario.
-- Todos empiezan como jurado; organización se asigna administrativamente.
create function private.crear_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.perfiles (id, nombre, rol)
    values (
        new.id,
        coalesce(
            nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''),
            nullif(split_part(new.email, '@', 1), ''),
            'Usuario'
        ),
        'jurado'
    );

    return new;
end;
$$;

revoke all on function private.crear_perfil()
    from public, anon, authenticated;

create trigger al_crear_usuario
after insert on auth.users
for each row
execute function private.crear_perfil();

-- También cubrir usuarios creados antes de esta migración.
insert into public.perfiles (id, nombre, rol)
select
    id,
    coalesce(
        nullif(trim(raw_user_meta_data ->> 'nombre'), ''),
        nullif(split_part(email, '@', 1), ''),
        'Usuario'
    ),
    'jurado'
from auth.users
on conflict (id) do nothing;

-- Mantener actualizada la fecha de modificación.
create function private.actualizar_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.actualizado_en := now();
    return new;
end;
$$;

revoke all on function private.actualizar_timestamp()
    from public, anon, authenticated;

create trigger al_actualizar_fecha
before update on public.fechas
for each row
execute function private.actualizar_timestamp();

-- Activar seguridad por fila.
alter table public.perfiles enable row level security;
alter table public.fechas enable row level security;

-- Quitar permisos automáticos y otorgar solo los necesarios.
revoke all on public.perfiles from public, anon, authenticated;
revoke all on public.fechas from public, anon, authenticated;

grant select on public.perfiles to authenticated;

-- El usuario puede cambiar su nombre, pero no su rol.
grant update (nombre) on public.perfiles to authenticated;

grant select on public.fechas to authenticated;

grant insert (
    nombre,
    fecha_evento,
    integrantes_por_equipo,
    jurados_eliminatorias,
    jurados_por_grupo_clasi,
    estado
) on public.fechas to authenticated;

grant update (
    nombre,
    fecha_evento,
    integrantes_por_equipo,
    jurados_eliminatorias,
    jurados_por_grupo_clasi,
    estado
) on public.fechas to authenticated;

-- Cada usuario ve su perfil.
-- Organización puede consultar todos los perfiles.
create policy perfiles_lectura
on public.perfiles
for select
to authenticated
using (
    id = (select auth.uid())
    or (select private.es_organizacion())
);

create policy perfiles_editar_nombre
on public.perfiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Por ahora, solo organización accede a las fechas.
-- El acceso de jurados se agregará mediante sus asignaciones.
create policy fechas_lectura
on public.fechas
for select
to authenticated
using ((select private.es_organizacion()));

create policy fechas_creacion
on public.fechas
for insert
to authenticated
with check (
    (select private.es_organizacion())
    and creado_por = (select auth.uid())
);

create policy fechas_edicion
on public.fechas
for update
to authenticated
using ((select private.es_organizacion()))
with check ((select private.es_organizacion()));

commit;