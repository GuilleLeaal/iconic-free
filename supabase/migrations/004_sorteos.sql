begin;

create table public.sorteos (
    id uuid primary key default gen_random_uuid(),
    fecha_id uuid not null references public.fechas(id),
    vigente boolean not null default true,
    plan jsonb not null,
    creado_por uuid not null references public.perfiles(id),
    creado_en timestamptz not null default now(),
    cancelado_por uuid references public.perfiles(id),
    cancelado_en timestamptz
);

-- Una fecha puede tener sorteos anteriores, pero solo uno vigente.
create unique index sorteos_vigente_fecha_unico
    on public.sorteos (fecha_id)
    where vigente;

create index sorteos_fecha_idx
    on public.sorteos (fecha_id, creado_en desc);

alter table public.sorteos enable row level security;

revoke all on public.sorteos from public, anon, authenticated;
grant select on public.sorteos to authenticated;

create policy sorteos_lectura
on public.sorteos
for select
to authenticated
using ((select private.es_organizacion()));

create function public.generar_sorteo(p_fecha_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_fecha public.fechas%rowtype;
    v_sorteo public.sorteos%rowtype;
    v_entradas jsonb;
    v_total integer;
    v_plan jsonb;

    v_orden integer[] := array[1, 5, 3, 7, 2, 6, 4, 8];
    v_tamanios integer[] := array_fill(0, array[8]);
    v_posicion integer;
    v_cursor integer;
    v_cruces jsonb := '[]'::jsonb;
    v_cruce jsonb;

    v_cantidad_grupos integer;
    v_grupos jsonb := '[]'::jsonb;
    v_grupo jsonb;
    v_total_grupo integer;
    v_cantidad_tandas integer;
    v_base integer;
    v_resto integer;
    v_tamanio_tanda integer;
    v_tandas jsonb;
    v_tanda jsonb;

    i integer;
    j integer;
    g integer;
    t integer;
begin
    if not private.es_organizacion() then
        raise exception 'No tenés permiso para generar sorteos.';
    end if;

    select * into v_fecha
    from public.fechas
    where id = p_fecha_id
    for update;

    if not found then
        raise exception 'La fecha no existe.';
    end if;

    if v_fecha.estado not in ('borrador', 'inscripciones') then
        raise exception 'La fecha ya no admite cambios de sorteo.';
    end if;

    -- Repetir la petición recupera el sorteo, no lo vuelve a generar.
    select * into v_sorteo
    from public.sorteos
    where fecha_id = p_fecha_id
      and vigente;

    if found then
        return to_jsonb(v_sorteo);
    end if;

    -- Solo inscripciones activas. Se guardan sus datos como snapshot.
    select coalesce(
        jsonb_agg(to_jsonb(entrada) order by random()),
        '[]'::jsonb
    )
    into v_entradas
    from (
        select
            inscripcion.id,
            inscripcion.nombre,
            inscripcion.version,
            (
                select jsonb_agg(integrante.alias order by integrante.orden)
                from public.inscripcion_integrantes integrante
                where integrante.inscripcion_id = inscripcion.id
            ) as integrantes
        from public.inscripciones inscripcion
        where inscripcion.fecha_id = p_fecha_id
          and inscripcion.activa
    ) entrada;

    v_total := jsonb_array_length(v_entradas);

    if v_total < 2 then
        raise exception 'Necesitás al menos dos inscripciones activas.';
    end if;

    if v_total <= 28 then
        -- Distribuir las primeras 16 entre ocho posiciones.
        -- El orden separa los pases libres por distintas ramas.
        for i in 1..least(v_total, 16) loop
            v_posicion := v_orden[((i - 1) % 8) + 1];
            v_tamanios[v_posicion] := v_tamanios[v_posicion] + 1;
        end loop;

        -- De 17 a 24: triangulares.
        -- De 25 a 28: hasta cuatro cuadrangulares.
        if v_total > 16 then
            for i in 17..v_total loop
                v_posicion := v_orden[((i - 17) % 8) + 1];
                v_tamanios[v_posicion] := v_tamanios[v_posicion] + 1;
            end loop;
        end if;

        v_cursor := 0;

        for i in 1..8 loop
            v_cruce := '[]'::jsonb;

            for j in 1..v_tamanios[i] loop
                v_cruce := v_cruce ||
                    jsonb_build_array(v_entradas -> v_cursor);
                v_cursor := v_cursor + 1;
            end loop;

            v_cruces := v_cruces || jsonb_build_array(
                jsonb_build_object(
                    'numero', i,
                    'inscripciones', v_cruce
                )
            );
        end loop;

        v_plan := jsonb_build_object(
            'version_algoritmo', 1,
            'tipo', 'octavos',
            'total', v_total,
            'integrantes_por_equipo', v_fecha.integrantes_por_equipo,
            'cruces', v_cruces
        );

    else
        v_cantidad_grupos := case
            when v_total <= 50 then 1
            when v_total <= 100 then 2
            else 3
        end;

        for g in 1..v_cantidad_grupos loop
            v_grupo := '[]'::jsonb;

            -- Reparto equilibrado entre A, B y C.
            for i in 0..(v_total - 1) loop
                if (i % v_cantidad_grupos) = (g - 1) then
                    v_grupo := v_grupo ||
                        jsonb_build_array(v_entradas -> i);
                end if;
            end loop;

            v_total_grupo := jsonb_array_length(v_grupo);
            v_cantidad_tandas := ceil(v_total_grupo::numeric / 5)::integer;
            v_base := v_total_grupo / v_cantidad_tandas;
            v_resto := v_total_grupo % v_cantidad_tandas;

            v_tandas := '[]'::jsonb;
            v_cursor := 0;

            -- Tandas de hasta cinco, repartiendo el sobrante.
            for t in 1..v_cantidad_tandas loop
                v_tamanio_tanda := v_base +
                    case when t <= v_resto then 1 else 0 end;

                v_tanda := '[]'::jsonb;

                for j in 1..v_tamanio_tanda loop
                    v_tanda := v_tanda ||
                        jsonb_build_array(v_grupo -> v_cursor);
                    v_cursor := v_cursor + 1;
                end loop;

                v_tandas := v_tandas || jsonb_build_array(
                    jsonb_build_object(
                        'numero', t,
                        'inscripciones', v_tanda
                    )
                );
            end loop;

            v_grupos := v_grupos || jsonb_build_array(
                jsonb_build_object(
                    'nombre', chr(64 + g),
                    'total', v_total_grupo,
                    'tandas', v_tandas
                )
            );
        end loop;

        v_plan := jsonb_build_object(
            'version_algoritmo', 1,
            'tipo', 'clasificatorias',
            'total', v_total,
            'integrantes_por_equipo', v_fecha.integrantes_por_equipo,
            'clasifican', 24,
            'grupos', v_grupos
        );
    end if;

    insert into public.sorteos (fecha_id, plan, creado_por)
    values (p_fecha_id, v_plan, auth.uid())
    returning * into v_sorteo;

    return to_jsonb(v_sorteo);
end;
$$;

revoke all on function public.generar_sorteo(uuid)
    from public, anon, authenticated;

grant execute on function public.generar_sorteo(uuid)
    to authenticated;

create function public.deshacer_sorteo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_fecha_id uuid;
    v_estado text;
begin
    if not private.es_organizacion() then
        raise exception 'No tenés permiso para deshacer sorteos.';
    end if;

    select fecha_id into v_fecha_id
    from public.sorteos
    where id = p_id;

    if not found then
        raise exception 'El sorteo no existe.';
    end if;

    select estado into v_estado
    from public.fechas
    where id = v_fecha_id
    for update;

    if v_estado not in ('borrador', 'inscripciones') then
        raise exception 'No podés deshacer el sorteo de una fecha iniciada.';
    end if;

    update public.sorteos
    set
        vigente = false,
        cancelado_por = auth.uid(),
        cancelado_en = now()
    where id = p_id
      and vigente;

    if not found then
        raise exception 'Este sorteo ya no está vigente. Actualizá la pantalla.';
    end if;
end;
$$;

revoke all on function public.deshacer_sorteo(uuid)
    from public, anon, authenticated;

grant execute on function public.deshacer_sorteo(uuid)
    to authenticated;

-- Impedir cambios que invaliden un sorteo vigente.
create function private.bloquear_inscripcion_con_sorteo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform id
    from public.fechas
    where id = new.fecha_id
    for update;

    if exists (
        select 1
        from public.sorteos
        where fecha_id = new.fecha_id
          and vigente
    ) then
        raise exception 'Hay un sorteo vigente. Deshacelo antes de modificar las inscripciones.';
    end if;

    return new;
end;
$$;

revoke all on function private.bloquear_inscripcion_con_sorteo()
    from public, anon, authenticated;

create trigger bloquear_inscripcion_con_sorteo
before insert or update on public.inscripciones
for each row
execute function private.bloquear_inscripcion_con_sorteo();

notify pgrst, 'reload schema';

commit;