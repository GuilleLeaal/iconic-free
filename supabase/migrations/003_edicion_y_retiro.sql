begin;

alter table public.inscripciones
    add column activa boolean not null default true,
    add column version integer not null default 1
        check (version >= 1),
    add column actualizado_en timestamptz not null default now();

create trigger actualizar_timestamp_inscripcion
before update on public.inscripciones
for each row
execute function private.actualizar_timestamp();

create table public.inscripciones_historial (
    id uuid primary key default gen_random_uuid(),
    inscripcion_id uuid not null references public.inscripciones(id),
    accion text not null check (
        accion in (
            'registro_inicial',
            'creacion',
            'editar',
            'retirar',
            'reactivar'
        )
    ),
    antes jsonb,
    despues jsonb not null,
    usuario_id uuid references public.perfiles(id) on delete set null,
    usuario_nombre text,
    creado_en timestamptz not null default now()
);

create index inscripciones_historial_inscripcion_idx
    on public.inscripciones_historial (inscripcion_id, creado_en);

alter table public.inscripciones_historial enable row level security;

revoke all on public.inscripciones_historial
    from public, anon, authenticated;

grant select on public.inscripciones_historial to authenticated;

create policy historial_inscripciones_lectura
on public.inscripciones_historial
for select
to authenticated
using ((select private.es_organizacion()));

-- Copia completa de una inscripción y sus integrantes.
create function private.snapshot_inscripcion(p_id uuid)
returns jsonb
language sql
set search_path = ''
as $$
    select
        to_jsonb(inscripcion) ||
        jsonb_build_object(
            'integrantes',
            coalesce(
                (
                    select jsonb_agg(
                        to_jsonb(integrante)
                        order by integrante.orden
                    )
                    from public.inscripcion_integrantes integrante
                    where integrante.inscripcion_id = inscripcion.id
                ),
                '[]'::jsonb
            )
        )
    from public.inscripciones inscripcion
    where inscripcion.id = p_id;
$$;

revoke all on function private.snapshot_inscripcion(uuid)
    from public, anon, authenticated;

-- Punto de partida para inscripciones existentes.
insert into public.inscripciones_historial (
    inscripcion_id,
    accion,
    despues
)
select
    id,
    'registro_inicial',
    private.snapshot_inscripcion(id)
from public.inscripciones;

-- Conservar la función anterior como implementación interna.
revoke all on function public.crear_inscripcion(uuid, text, text[])
    from public, anon, authenticated;

alter function public.crear_inscripcion(uuid, text, text[])
    set schema private;

-- La nueva entrada registra también la creación en el historial.
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
    v_id uuid;
begin
    v_id := private.crear_inscripcion(
        p_fecha_id,
        p_nombre,
        p_integrantes
    );

    insert into public.inscripciones_historial (
        inscripcion_id,
        accion,
        despues,
        usuario_id,
        usuario_nombre
    )
    values (
        v_id,
        'creacion',
        private.snapshot_inscripcion(v_id),
        auth.uid(),
        (select nombre from public.perfiles where id = auth.uid())
    );

    return v_id;
end;
$$;

revoke all on function public.crear_inscripcion(uuid, text, text[])
    from public, anon, authenticated;

grant execute on function public.crear_inscripcion(uuid, text, text[])
    to authenticated;

create function public.modificar_inscripcion(
    p_id uuid,
    p_version integer,
    p_accion text,
    p_nombre text default null,
    p_integrantes text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_fecha_id uuid;
    v_fecha public.fechas%rowtype;
    v_inscripcion public.inscripciones%rowtype;
    v_antes jsonb;
    v_nombre text;
    v_aliases text[];
    v_activa boolean;
begin
    if not private.es_organizacion() then
        raise exception 'No tenés permiso para modificar inscripciones.';
    end if;

    if p_accion is null
       or p_accion not in ('editar', 'retirar', 'reactivar') then
        raise exception 'La acción no es válida.';
    end if;

    select fecha_id into v_fecha_id
    from public.inscripciones
    where id = p_id;

    if not found then
        raise exception 'La inscripción no existe.';
    end if;

    -- Mismo orden de bloqueo que en la creación.
    select * into v_fecha
    from public.fechas
    where id = v_fecha_id
    for update;

    if v_fecha.estado not in ('borrador', 'inscripciones') then
        raise exception 'Las inscripciones ya están cerradas para esta fecha.';
    end if;

    select * into v_inscripcion
    from public.inscripciones
    where id = p_id
    for update;

    if p_version is null or p_version <> v_inscripcion.version then
        raise exception 'Esta inscripción cambió desde que la abriste. Actualizá el listado antes de continuar.';
    end if;

    v_antes := private.snapshot_inscripcion(p_id);
    v_nombre := v_inscripcion.nombre;
    v_activa := v_inscripcion.activa;

    if p_accion = 'editar' then
        if not v_inscripcion.activa then
            raise exception 'Reactivá la inscripción antes de editarla.';
        end if;

        if p_integrantes is null
           or cardinality(p_integrantes) <> v_fecha.integrantes_por_equipo
           or array_ndims(p_integrantes) <> 1 then
            raise exception 'La cantidad de integrantes no coincide con el formato.';
        end if;

        select array_agg(trim(alias) order by posicion)
        into v_aliases
        from unnest(p_integrantes) with ordinality
            as datos(alias, posicion);

        if exists (
            select 1
            from unnest(v_aliases) as datos(alias)
            where alias is null or alias = ''
        ) then
            raise exception 'Completá todos los alias.';
        end if;

        if (
            select count(distinct lower(alias))
            from unnest(v_aliases) as datos(alias)
        ) <> cardinality(v_aliases) then
            raise exception 'No podés repetir un integrante dentro del equipo.';
        end if;

        if exists (
            select 1
            from public.inscripcion_integrantes integrante
            join public.inscripciones inscripcion
                on inscripcion.id = integrante.inscripcion_id
            where inscripcion.fecha_id = v_fecha_id
              and inscripcion.id <> p_id
              and lower(trim(integrante.alias)) in (
                  select lower(alias)
                  from unnest(v_aliases) as datos(alias)
              )
        ) then
            raise exception 'Uno de los alias pertenece a otra inscripción de esta fecha.';
        end if;

        v_nombre := case
            when v_fecha.integrantes_por_equipo = 1 then v_aliases[1]
            else trim(p_nombre)
        end;

        if v_nombre is null or v_nombre = '' then
            raise exception 'Ingresá el nombre del equipo.';
        end if;

        if exists (
            select 1
            from public.inscripciones
            where fecha_id = v_fecha_id
              and id <> p_id
              and lower(trim(nombre)) = lower(v_nombre)
        ) then
            raise exception 'Ese nombre pertenece a otra inscripción.';
        end if;

        -- Conservar los identificadores de los integrantes.
        update public.inscripcion_integrantes integrante
        set alias = datos.alias
        from unnest(v_aliases) with ordinality
            as datos(alias, posicion)
        where integrante.inscripcion_id = p_id
          and integrante.orden = datos.posicion;

    elsif p_accion = 'retirar' then
        if not v_activa then
            return p_id;
        end if;

        v_activa := false;

    else
        if v_activa then
            return p_id;
        end if;

        v_activa := true;
    end if;

    update public.inscripciones
    set
        nombre = v_nombre,
        activa = v_activa,
        version = version + 1
    where id = p_id;

    insert into public.inscripciones_historial (
        inscripcion_id,
        accion,
        antes,
        despues,
        usuario_id,
        usuario_nombre
    )
    values (
        p_id,
        p_accion,
        v_antes,
        private.snapshot_inscripcion(p_id),
        auth.uid(),
        (select nombre from public.perfiles where id = auth.uid())
    );

    return p_id;
end;
$$;

revoke all on function public.modificar_inscripcion(
    uuid, integer, text, text, text[]
) from public, anon, authenticated;

grant execute on function public.modificar_inscripcion(
    uuid, integer, text, text, text[]
) to authenticated;

notify pgrst, 'reload schema';

commit;