begin;

create table public.inscripciones (
    id uuid primary key default gen_random_uuid(),
    fecha_id uuid not null references public.fechas(id),
    nombre text not null check (length(trim(nombre)) > 0),
    creado_en timestamptz not null default now()
);

create unique index inscripciones_nombre_fecha_unico
    on public.inscripciones (fecha_id, lower(trim(nombre)));

create table public.inscripcion_integrantes (
    id uuid primary key default gen_random_uuid(),
    inscripcion_id uuid not null references public.inscripciones(id),
    alias text not null check (length(trim(alias)) > 0),
    orden integer not null check (orden >= 1),
    unique (inscripcion_id, orden)
);

create index inscripcion_integrantes_inscripcion_idx
    on public.inscripcion_integrantes (inscripcion_id);

alter table public.inscripciones enable row level security;
alter table public.inscripcion_integrantes enable row level security;

revoke all on public.inscripciones
    from public, anon, authenticated;

revoke all on public.inscripcion_integrantes
    from public, anon, authenticated;

grant select on public.inscripciones to authenticated;
grant select on public.inscripcion_integrantes to authenticated;

create policy inscripciones_lectura
on public.inscripciones
for select
to authenticated
using ((select private.es_organizacion()));

create policy integrantes_lectura
on public.inscripcion_integrantes
for select
to authenticated
using ((select private.es_organizacion()));

-- Guardado completo: inscripción y todos sus integrantes.
create function public.crear_inscripcion(
    p_fecha_id uuid,
    p_nombre text,
    p_integrantes text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_fecha public.fechas%rowtype;
    v_nombre text;
    v_integrantes text[];
    v_inscripcion_id uuid;
begin
    if not private.es_organizacion() then
        raise exception 'No tenés permiso para anotar participantes.';
    end if;

    -- Serializa las inscripciones de esta fecha para evitar
    -- que dos dispositivos anoten simultáneamente el mismo alias.
    select *
    into v_fecha
    from public.fechas
    where id = p_fecha_id
    for update;

    if not found then
        raise exception 'La fecha no existe.';
    end if;

    if v_fecha.estado not in ('borrador', 'inscripciones') then
        raise exception 'Esta fecha ya no admite inscripciones.';
    end if;

    if p_integrantes is null
       or cardinality(p_integrantes) <> v_fecha.integrantes_por_equipo
       or array_ndims(p_integrantes) <> 1 then
        raise exception 'La cantidad de integrantes no coincide con el formato.';
    end if;

    select array_agg(trim(alias) order by posicion)
    into v_integrantes
    from unnest(p_integrantes) with ordinality
        as datos(alias, posicion);

    if exists (
        select 1
        from unnest(v_integrantes) as datos(alias)
        where alias is null or alias = ''
    ) then
        raise exception 'Completá el alias de todos los integrantes.';
    end if;

    if (
        select count(distinct lower(alias))
        from unnest(v_integrantes) as datos(alias)
    ) <> cardinality(v_integrantes) then
        raise exception 'No podés repetir un integrante dentro del equipo.';
    end if;

    if exists (
        select 1
        from public.inscripcion_integrantes integrante
        join public.inscripciones inscripcion
            on inscripcion.id = integrante.inscripcion_id
        where inscripcion.fecha_id = p_fecha_id
          and lower(trim(integrante.alias)) in (
              select lower(alias)
              from unnest(v_integrantes) as datos(alias)
          )
    ) then
        raise exception 'Uno de los alias ya está anotado en esta fecha.';
    end if;

    if v_fecha.integrantes_por_equipo = 1 then
        v_nombre := v_integrantes[1];
    else
        v_nombre := trim(p_nombre);
    end if;

    if v_nombre is null or v_nombre = '' then
        raise exception 'Ingresá el nombre del equipo.';
    end if;

    if exists (
        select 1
        from public.inscripciones
        where fecha_id = p_fecha_id
          and lower(trim(nombre)) = lower(v_nombre)
    ) then
        raise exception 'Ese nombre ya está anotado en esta fecha.';
    end if;

    insert into public.inscripciones (fecha_id, nombre)
    values (p_fecha_id, v_nombre)
    returning id into v_inscripcion_id;

    insert into public.inscripcion_integrantes (
        inscripcion_id,
        alias,
        orden
    )
    select
        v_inscripcion_id,
        alias,
        posicion::integer
    from unnest(v_integrantes) with ordinality
        as datos(alias, posicion);

    return v_inscripcion_id;
end;
$$;

revoke all on function public.crear_inscripcion(uuid, text, text[])
    from public, anon, authenticated;

grant execute on function public.crear_inscripcion(uuid, text, text[])
    to authenticated;

-- El formato no puede cambiar si ya hay inscripciones.
create function private.proteger_formato_fecha()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.integrantes_por_equipo <> old.integrantes_por_equipo
       and exists (
           select 1
           from public.inscripciones
           where fecha_id = old.id
       ) then
        raise exception 'No podés cambiar el formato de una fecha con inscripciones.';
    end if;

    return new;
end;
$$;

revoke all on function private.proteger_formato_fecha()
    from public, anon, authenticated;

create trigger proteger_formato_con_inscripciones
before update on public.fechas
for each row
execute function private.proteger_formato_fecha();

commit;