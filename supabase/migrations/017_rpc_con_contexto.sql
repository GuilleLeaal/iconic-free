begin;
-- Generado por scripts/generar-rpc-correctivas.mjs. Reemplazos auditables.

create or replace function private.crear_inscripcion(
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
    if not private.exigir_organizacion_fecha(p_fecha_id) then
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

create or replace function public.crear_inscripcion(
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

create or replace function public.modificar_inscripcion(
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
    if not private.exigir_organizacion_fecha(private.fecha_recurso('inscripcion',p_id)) then
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

create or replace function public.generar_sorteo(p_fecha_id uuid)
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
    if not private.exigir_organizacion_fecha(p_fecha_id) then
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

create or replace function public.deshacer_sorteo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_fecha_id uuid;
    v_estado text;
begin
    if not private.exigir_organizacion_fecha(private.fecha_recurso('sorteo',p_id)) then
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

create or replace function public.configurar_jurado_fecha(
  p_fecha_id uuid,
  p_jurado_id uuid,
  p_apartado text,
  p_asignar boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha public.fechas%rowtype;
  v_limite integer;
  v_asignados integer;
begin
  if not private.exigir_organizacion_fecha(p_fecha_id) then
    raise exception 'No tenés permiso para administrar jurados.';
  end if;

  if p_apartado is null or p_apartado not in (
    'eliminatorias',
    'clasi_a',
    'clasi_b',
    'clasi_c'
  ) then
    raise exception 'El apartado no es válido.';
  end if;

  if p_asignar is null then
    raise exception 'Indicá si querés asignar o quitar al jurado.';
  end if;

  -- Todas las modificaciones de una fecha comparten este bloqueo.
  -- Así dos solicitudes simultáneas no pueden superar el límite.
  select *
    into v_fecha
    from public.fechas
    where id = p_fecha_id
    for update;

  if not found then
    raise exception 'La fecha no existe.';
  end if;

  if v_fecha.estado not in ('borrador', 'inscripciones') then
    raise exception
      'Los jurados solo se pueden cambiar antes de comenzar la fecha.';
  end if;

  if not p_asignar then
    delete from public.jurados_fecha
      where fecha_id = p_fecha_id
        and jurado_id = p_jurado_id
        and apartado = p_apartado;

    return;
  end if;

  -- Bloqueamos el perfil mientras comprobamos su rol.
  perform 1
    from public.perfiles
    where id = p_jurado_id
      and exists(select 1 from public.vinculos_competencia v where v.usuario_id=p_jurado_id and v.competencia_id=v_fecha.competencia_id and v.rol='jurado' and v.estado='activo')
    for share;

  if not found then
    raise exception 'La cuenta seleccionada no tiene el rol de jurado.';
  end if;

  -- Repetir una asignación no agrega otra ni consume un cupo.
  if exists (
    select 1
      from public.jurados_fecha
      where fecha_id = p_fecha_id
        and jurado_id = p_jurado_id
        and apartado = p_apartado
  ) then
    return;
  end if;

  v_limite := case
    when p_apartado = 'eliminatorias'
      then v_fecha.jurados_eliminatorias
    else v_fecha.jurados_por_grupo_clasi
  end;

  select count(*)
    into v_asignados
    from public.jurados_fecha
    where fecha_id = p_fecha_id
      and apartado = p_apartado;

  if v_asignados >= v_limite then
    raise exception
      'Este apartado ya tiene los % jurados configurados.',
      v_limite;
  end if;

  insert into public.jurados_fecha (
    fecha_id,
    jurado_id,
    apartado,
    asignado_por
  )
  values (
    p_fecha_id,
    p_jurado_id,
    p_apartado,
    auth.uid()
  );
end;
$$;

create or replace function public.guardar_planilla_fecha(
  p_fecha_id uuid,
  p_tipo text,
  p_casillas text[],
  p_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha public.fechas%rowtype;
  v_planilla public.planillas_fecha%rowtype;
  v_existe boolean;
  v_casillas text[];
begin
  if not private.exigir_organizacion_fecha(p_fecha_id) then
    raise exception 'No tenés permiso para configurar planillas.';
  end if;

  if p_tipo is null or p_tipo not in (
    'eliminatorias',
    'clasificatorias'
  ) then
    raise exception 'El tipo de planilla no es válido.';
  end if;

  if p_version is null or p_version < 0 then
    raise exception 'La versión de la planilla no es válida.';
  end if;

  if p_casillas is null
    or cardinality(p_casillas) = 0
    or array_ndims(p_casillas) <> 1
  then
    raise exception 'Agregá al menos una casilla.';
  end if;

  if exists (
    select 1
    from unnest(p_casillas) as entrada(nombre)
    where nombre is null
      or btrim(nombre) = ''
  ) then
    raise exception 'Todas las casillas deben tener un nombre.';
  end if;

  -- Conservamos el orden y quitamos espacios en los extremos.
  select array_agg(btrim(nombre) order by posicion)
    into v_casillas
    from unnest(p_casillas)
      with ordinality as entrada(nombre, posicion);

  select *
    into v_fecha
    from public.fechas
    where id = p_fecha_id
    for update;

  if not found then
    raise exception 'La fecha no existe.';
  end if;

  if v_fecha.estado not in ('borrador', 'inscripciones') then
    raise exception
      'La planilla base solo se puede configurar antes de comenzar la fecha.';
  end if;

  select *
    into v_planilla
    from public.planillas_fecha
    where fecha_id = p_fecha_id
      and tipo = p_tipo
    for update;

  v_existe := found;

  if v_existe then
    if p_version <> v_planilla.version then
      raise exception
        'Otra persona modificó esta planilla. Actualizá antes de guardar.';
    end if;

    update public.planillas_fecha
      set casillas = v_casillas,
          version = version + 1,
          actualizado_por = auth.uid(),
          actualizado_en = now()
      where id = v_planilla.id;
  else
    -- La versión 0 representa una planilla todavía sin guardar.
    if p_version <> 0 then
      raise exception
        'La planilla cambió. Actualizá antes de guardar.';
    end if;

    insert into public.planillas_fecha (
      fecha_id,
      tipo,
      casillas,
      actualizado_por
    )
    values (
      p_fecha_id,
      p_tipo,
      v_casillas,
      auth.uid()
    );
  end if;
end;
$$;

create or replace function public.iniciar_eliminatorias(
  p_fecha_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha public.fechas%rowtype;
  v_sorteo public.sorteos%rowtype;
  v_cruce jsonb;
  v_fase text;
  v_cantidad integer;
  v_numero integer;
begin
  if not private.exigir_organizacion_fecha(p_fecha_id) then
    raise exception 'No tenés permiso para iniciar eliminatorias.';
  end if;

  select *
    into v_fecha
    from public.fechas
    where id = p_fecha_id
    for update;

  if not found then
    raise exception 'La fecha no existe.';
  end if;

  select *
    into v_sorteo
    from public.sorteos
    where fecha_id = p_fecha_id
      and vigente = true;

  if not found then
    raise exception 'Generá un sorteo antes de comenzar.';
  end if;

  -- Permite recuperar una operación ya guardada
  -- sin volver a crear cruces.
  if exists (
    select 1
    from public.cruces_eliminatorias
    where sorteo_id = v_sorteo.id
  ) then
    return v_sorteo.id;
  end if;

  if v_fecha.estado not in ('borrador', 'inscripciones') then
    raise exception 'La fecha no admite iniciar eliminatorias.';
  end if;

  if v_sorteo.plan ->> 'tipo' is distinct from 'octavos' then
    raise exception
      'Esta fecha necesita terminar las clasificatorias antes de iniciar octavos.';
  end if;

  if jsonb_typeof(v_sorteo.plan -> 'cruces') is distinct from 'array' then
    raise exception 'El sorteo no tiene una lista válida de cruces.';
  end if;

  if jsonb_array_length(v_sorteo.plan -> 'cruces') <> 8 then
    raise exception 'El sorteo debe tener ocho cruces de octavos.';
  end if;

  for v_cruce in
    select value
    from jsonb_array_elements(v_sorteo.plan -> 'cruces')
  loop
    if jsonb_typeof(v_cruce -> 'inscripciones')
      is distinct from 'array'
    then
      raise exception 'Un cruce del sorteo no tiene participantes válidos.';
    end if;

    if jsonb_array_length(v_cruce -> 'inscripciones') > 4 then
      raise exception 'Un cruce de octavos supera los cuatro participantes.';
    end if;

    insert into public.cruces_eliminatorias (
      fecha_id,
      sorteo_id,
      fase,
      numero,
      entradas
    )
    values (
      p_fecha_id,
      v_sorteo.id,
      'octavos',
      (v_cruce ->> 'numero')::integer,
      v_cruce -> 'inscripciones'
    );
  end loop;

  foreach v_fase in array array['cuartos', 'semifinal', 'final']
  loop
    v_cantidad := case v_fase
      when 'cuartos' then 4
      when 'semifinal' then 2
      else 1
    end;

    for v_numero in 1..v_cantidad
    loop
      insert into public.cruces_eliminatorias (
        fecha_id,
        sorteo_id,
        fase,
        numero
      )
      values (
        p_fecha_id,
        v_sorteo.id,
        v_fase,
        v_numero
      );
    end loop;
  end loop;

  perform private.actualizar_llaves(v_sorteo.id);

  update public.fechas
    set estado = 'en_curso'
    where id = p_fecha_id;

  return v_sorteo.id;
end;
$$;

create or replace function public.confirmar_ganador_cruce(
  p_cruce_id uuid,
  p_ganador_id uuid,
  p_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha_id uuid;
  v_fecha public.fechas%rowtype;
  v_cruce public.cruces_eliminatorias%rowtype;
begin
  if not private.exigir_organizacion_fecha(private.fecha_recurso('cruce',p_cruce_id)) then
    raise exception 'No tenés permiso para confirmar resultados.';
  end if;

  select fecha_id
    into v_fecha_id
    from public.cruces_eliminatorias
    where id = p_cruce_id;

  if not found then
    raise exception 'El cruce no existe.';
  end if;

  -- Mismo orden de bloqueo que al iniciar.
  select *
    into v_fecha
    from public.fechas
    where id = v_fecha_id
    for update;

  select *
    into v_cruce
    from public.cruces_eliminatorias
    where id = p_cruce_id
    for update;

  -- Reintentar el mismo resultado no lo duplica.
  if v_cruce.estado = 'resuelto'
    and v_cruce.resolucion = 'manual'
    and v_cruce.ganador_id = p_ganador_id
  then
    return;
  end if;

  if v_fecha.estado <> 'en_curso' then
    raise exception 'La fecha no está en curso.';
  end if;

  if p_version is null or p_version <> v_cruce.version then
    raise exception 'El cruce cambió. Actualizá antes de confirmar.';
  end if;

  if v_cruce.estado <> 'pendiente' then
    raise exception 'Este cruce ya está resuelto.';
  end if;

  if not v_cruce.listo then
    raise exception 'Todavía faltan resultados de la fase anterior.';
  end if;

  if jsonb_array_length(v_cruce.entradas) < 2 then
    raise exception 'Este cruce no necesita un resultado manual.';
  end if;

  if p_ganador_id is null or not exists (
    select 1
    from jsonb_array_elements(v_cruce.entradas) as entrada(value)
    where (entrada.value ->> 'id')::uuid = p_ganador_id
  ) then
    raise exception 'El ganador debe ser un participante de este cruce.';
  end if;

  update public.cruces_eliminatorias
    set estado = 'resuelto',
        ganador_id = p_ganador_id,
        resolucion = 'manual',
        confirmado_por = auth.uid(),
        confirmado_en = now(),
        version = version + 1
    where id = p_cruce_id;

  perform private.actualizar_llaves(v_cruce.sorteo_id);

  if exists (
    select 1
    from public.cruces_eliminatorias
    where sorteo_id = v_cruce.sorteo_id
      and fase = 'final'
      and estado = 'resuelto'
  ) then
    update public.fechas
      set estado = 'finalizada'
      where id = v_fecha_id;
  end if;
end;
$$;

create or replace function public.sortear_fase_eliminatoria(
  p_fecha_id uuid,
  p_fase text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha public.fechas%rowtype;
  v_sorteo public.sorteos%rowtype;
  v_anterior text;
  v_esperados integer;
  v_destinos integer;
  v_total integer;
  v_resueltos integer;
  v_participantes jsonb;
  v_entradas jsonb;
  v_numero integer;
begin
  if not private.exigir_organizacion_fecha(p_fecha_id) then
    raise exception 'No tenés permiso para sortear eliminatorias.';
  end if;

  if p_fase is null or p_fase not in ('cuartos', 'semifinal') then
    raise exception 'Solo se pueden sortear cuartos y semifinal.';
  end if;

  select *
    into v_fecha
    from public.fechas
    where id = p_fecha_id
    for update;

  if not found then
    raise exception 'La fecha no existe.';
  end if;

  select *
    into v_sorteo
    from public.sorteos
    where fecha_id = p_fecha_id
      and vigente = true;

  if not found then
    raise exception 'La fecha no tiene un sorteo vigente.';
  end if;

  if not v_sorteo.eliminatorias_aleatorias then
    raise exception
      'Esta fecha comenzó con el sistema anterior y conserva sus cruces.';
  end if;

  -- Reintentar una solicitud no vuelve a sortear.
  if exists (
    select 1
    from public.sorteos_fases_eliminatorias
    where sorteo_id = v_sorteo.id
      and fase = p_fase
  ) then
    return;
  end if;

  if v_fecha.estado <> 'en_curso' then
    raise exception 'La fecha no está en curso.';
  end if;

  v_anterior := case p_fase
    when 'cuartos' then 'octavos'
    else 'cuartos'
  end;

  v_esperados := case p_fase
    when 'cuartos' then 8
    else 4
  end;

  v_destinos := case p_fase
    when 'cuartos' then 4
    else 2
  end;

  select
    count(*),
    count(*) filter (
      where listo = true
        and estado in ('resuelto', 'vacante')
    )
  into v_total, v_resueltos
  from public.cruces_eliminatorias
  where sorteo_id = v_sorteo.id
    and fase = v_anterior;

  if v_total <> v_esperados or v_resueltos <> v_esperados then
    raise exception
      'Terminá todos los cruces de la fase anterior antes de sortear.';
  end if;

  select count(*)
    into v_total
    from public.cruces_eliminatorias
    where sorteo_id = v_sorteo.id
      and fase = p_fase;

  if v_total <> v_destinos then
    raise exception 'La fase de destino no tiene los cruces esperados.';
  end if;

  if exists (
    select 1
    from public.cruces_eliminatorias
    where sorteo_id = v_sorteo.id
      and fase = p_fase
      and (
        listo = true
        or estado <> 'pendiente'
        or jsonb_array_length(entradas) > 0
      )
  ) then
    raise exception 'La fase de destino ya fue preparada.';
  end if;

  -- Sorteamos las copias de los ganadores de la fase anterior.
  select coalesce(
    jsonb_agg(entrada.value order by random()),
    '[]'::jsonb
  )
  into v_participantes
  from public.cruces_eliminatorias as fuente
  cross join lateral
    jsonb_array_elements(fuente.entradas) as entrada(value)
  where fuente.sorteo_id = v_sorteo.id
    and fuente.fase = v_anterior
    and fuente.estado = 'resuelto'
    and (entrada.value ->> 'id')::uuid = fuente.ganador_id;

  if jsonb_array_length(v_participantes) < 2
    or jsonb_array_length(v_participantes) > v_destinos * 2
  then
    raise exception 'La cantidad de ganadores no permite preparar esta fase.';
  end if;

  insert into public.sorteos_fases_eliminatorias (
    fecha_id,
    sorteo_id,
    fase,
    participantes,
    generado_por
  )
  values (
    p_fecha_id,
    v_sorteo.id,
    p_fase,
    v_participantes,
    auth.uid()
  );

  -- Repartimos la lista sorteada entre los cruces.
  -- Con pocos participantes, los pases libres quedan repartidos.
  for v_numero in 1..v_destinos
  loop
    select coalesce(
      jsonb_agg(entrada.value order by entrada.posicion),
      '[]'::jsonb
    )
    into v_entradas
    from jsonb_array_elements(v_participantes)
      with ordinality as entrada(value, posicion)
    where ((entrada.posicion - 1) % v_destinos) + 1 = v_numero;

    update public.cruces_eliminatorias
      set entradas = v_entradas,
          listo = true,
          version = version + 1
      where sorteo_id = v_sorteo.id
        and fase = p_fase
        and numero = v_numero;
  end loop;

  perform private.actualizar_llaves(v_sorteo.id);
end;
$$;

create or replace function public.deshacer_resultado_cruce(
  p_cruce_id uuid,
  p_version integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha_id uuid;
  v_fecha public.fechas%rowtype;
  v_cruce public.cruces_eliminatorias%rowtype;
  v_despues public.cruces_eliminatorias%rowtype;
  v_aleatorias boolean;
  v_siguiente text;
  v_orden integer;
begin
  if not private.exigir_organizacion_fecha(private.fecha_recurso('cruce',p_cruce_id)) then
    raise exception 'No tenés permiso para corregir resultados.';
  end if;

  select fecha_id
    into v_fecha_id
    from public.cruces_eliminatorias
    where id = p_cruce_id;

  if not found then
    raise exception 'El cruce no existe.';
  end if;

  select *
    into v_fecha
    from public.fechas
    where id = v_fecha_id
    for update;

  select *
    into v_cruce
    from public.cruces_eliminatorias
    where id = p_cruce_id
    for update;

  if v_fecha.estado not in ('en_curso', 'finalizada') then
    raise exception 'Esta fecha no admite corregir resultados.';
  end if;

  if p_version is null or p_version <> v_cruce.version then
    raise exception 'El cruce cambió. Actualizá antes de corregir.';
  end if;

  if v_cruce.estado <> 'resuelto'
    or v_cruce.resolucion <> 'manual'
  then
    raise exception 'Solo se pueden deshacer resultados confirmados manualmente.';
  end if;

  select eliminatorias_aleatorias
    into v_aleatorias
    from public.sorteos
    where id = v_cruce.sorteo_id;

  v_orden := case v_cruce.fase
    when 'octavos' then 1
    when 'cuartos' then 2
    when 'semifinal' then 3
    else 4
  end;

  if v_aleatorias then
    v_siguiente := case v_cruce.fase
      when 'octavos' then 'cuartos'
      when 'cuartos' then 'semifinal'
      else null
    end;

    if v_siguiente is not null and exists (
      select 1
      from public.sorteos_fases_eliminatorias
      where sorteo_id = v_cruce.sorteo_id
        and fase = v_siguiente
    ) then
      raise exception
        'No se puede corregir este resultado porque la fase siguiente ya fue sorteada.';
    end if;

    if v_cruce.fase = 'semifinal' and exists (
      select 1
      from public.cruces_eliminatorias
      where sorteo_id = v_cruce.sorteo_id
        and fase = 'final'
        and estado <> 'pendiente'
    ) then
      raise exception
        'Deshacé primero el resultado de la final.';
    end if;

    -- Al corregir una semifinal, retiramos la final preparada.
    if v_cruce.fase = 'semifinal' then
      update public.cruces_eliminatorias
        set entradas = '[]'::jsonb,
            listo = false,
            estado = 'pendiente',
            ganador_id = null,
            resolucion = null,
            confirmado_por = null,
            confirmado_en = null,
            version = version + 1
        where sorteo_id = v_cruce.sorteo_id
          and fase = 'final';
    end if;
  else
    -- Compatibilidad con las fechas de llaves fijas anteriores.
    if exists (
      select 1
      from public.cruces_eliminatorias
      where sorteo_id = v_cruce.sorteo_id
        and resolucion = 'manual'
        and (
          case fase
            when 'octavos' then 1
            when 'cuartos' then 2
            when 'semifinal' then 3
            else 4
          end
        ) > v_orden
    ) then
      raise exception
        'Primero deshacé los resultados manuales de las fases posteriores.';
    end if;

    -- Solo retiramos resultados derivados automáticamente.
    -- La función de avance vuelve a calcularlos después.
    update public.cruces_eliminatorias
      set entradas = '[]'::jsonb,
          listo = false,
          estado = 'pendiente',
          ganador_id = null,
          resolucion = null,
          confirmado_por = null,
          confirmado_en = null,
          version = version + 1
      where sorteo_id = v_cruce.sorteo_id
        and (
          case fase
            when 'octavos' then 1
            when 'cuartos' then 2
            when 'semifinal' then 3
            else 4
          end
        ) > v_orden;
  end if;

  update public.cruces_eliminatorias
    set estado = 'pendiente',
        ganador_id = null,
        resolucion = null,
        confirmado_por = null,
        confirmado_en = null,
        version = version + 1
    where id = p_cruce_id
    returning * into v_despues;

  insert into public.historial_resultados_eliminatorias (
    cruce_id,
    fecha_id,
    accion,
    antes,
    despues,
    realizado_por
  )
  values (
    v_cruce.id,
    v_cruce.fecha_id,
    'anulacion',
    to_jsonb(v_cruce),
    to_jsonb(v_despues),
    auth.uid()
  );

  if v_fecha.estado = 'finalizada' then
    update public.fechas
      set estado = 'en_curso'
      where id = v_fecha_id;
  end if;

  perform private.actualizar_llaves(v_cruce.sorteo_id);
end;
$$;

create or replace function public.iniciar_clasificatorias(
  p_fecha_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha public.fechas%rowtype;
  v_sorteo public.sorteos%rowtype;
  v_planilla public.planillas_fecha%rowtype;
  v_clasi_id uuid;
  v_grupo_id uuid;
  v_grupo jsonb;
  v_tanda jsonb;
  v_nombre text;
  v_apartado text;
  v_jurados integer;
  v_total integer;
  v_distintos integer;
begin
  if not private.exigir_organizacion_fecha(p_fecha_id) then
    raise exception 'No tenés permiso para iniciar clasificatorias.';
  end if;

  select *
    into v_fecha
    from public.fechas
    where id = p_fecha_id
    for update;

  if not found then
    raise exception 'La fecha no existe.';
  end if;

  select *
    into v_sorteo
    from public.sorteos
    where fecha_id = p_fecha_id
      and vigente = true;

  if not found then
    raise exception 'Generá el sorteo antes de comenzar.';
  end if;

  -- Reintentar no crea otra clasificatoria.
  select id
    into v_clasi_id
    from public.clasificatorias
    where sorteo_id = v_sorteo.id;

  if found then
    return v_clasi_id;
  end if;

  if v_fecha.estado not in ('borrador', 'inscripciones') then
    raise exception 'La fecha no admite iniciar clasificatorias.';
  end if;

  if v_sorteo.plan ->> 'tipo'
    is distinct from 'clasificatorias'
  then
    raise exception 'El sorteo de esta fecha no requiere clasificatorias.';
  end if;

  if jsonb_typeof(v_sorteo.plan -> 'grupos')
    is distinct from 'array'
  then
    raise exception 'El sorteo no tiene una lista válida de grupos.';
  end if;

  if jsonb_array_length(v_sorteo.plan -> 'grupos')
    not between 1 and 3
  then
    raise exception 'El sorteo debe tener entre uno y tres grupos.';
  end if;

  select *
    into v_planilla
    from public.planillas_fecha
    where fecha_id = p_fecha_id
      and tipo = 'clasificatorias';

  if not found then
    raise exception 'Guardá la planilla de clasificatorias antes de comenzar.';
  end if;

  if (v_sorteo.plan ->> 'clasifican')::integer is null then
    raise exception 'El sorteo no indica cuántos participantes clasifican.';
  end if;

  insert into public.clasificatorias (
    fecha_id,
    sorteo_id,
    casillas,
    clasifican,
    iniciado_por
  )
  values (
    p_fecha_id,
    v_sorteo.id,
    v_planilla.casillas,
    (v_sorteo.plan ->> 'clasifican')::integer,
    auth.uid()
  )
  returning id into v_clasi_id;

  for v_grupo in
    select value
    from jsonb_array_elements(v_sorteo.plan -> 'grupos')
  loop
    v_nombre := v_grupo ->> 'nombre';

    if v_nombre is null or v_nombre not in ('A', 'B', 'C') then
      raise exception 'Un grupo del sorteo tiene un nombre inválido.';
    end if;

    v_apartado := 'clasi_' || lower(v_nombre);

    insert into public.grupos_clasificatorias (
      clasificatoria_id,
      nombre
    )
    values (
      v_clasi_id,
      v_nombre
    )
    returning id into v_grupo_id;

    insert into public.jurados_clasificatorias (
      grupo_id,
      jurado_id,
      nombre
    )
    select
      v_grupo_id,
      asignacion.jurado_id,
      perfil.nombre
    from public.jurados_fecha as asignacion
    join public.perfiles as perfil
      on perfil.id = asignacion.jurado_id
    where asignacion.fecha_id = p_fecha_id
      and asignacion.apartado = v_apartado
      and exists(select 1 from public.vinculos_competencia v where v.usuario_id=perfil.id and v.competencia_id=v_fecha.competencia_id and v.rol='jurado' and v.estado='activo');

    get diagnostics v_jurados = row_count;

    if v_jurados <> v_fecha.jurados_por_grupo_clasi then
      raise exception
        'Clasis % necesita exactamente % jurados válidos.',
        v_nombre,
        v_fecha.jurados_por_grupo_clasi;
    end if;

    if jsonb_typeof(v_grupo -> 'tandas')
      is distinct from 'array'
    then
      raise exception 'Clasis % no tiene una lista válida de tandas.', v_nombre;
    end if;

    if jsonb_array_length(v_grupo -> 'tandas') = 0 then
      raise exception 'Clasis % no tiene tandas.', v_nombre;
    end if;

    for v_tanda in
      select value
      from jsonb_array_elements(v_grupo -> 'tandas')
    loop
      if jsonb_typeof(v_tanda -> 'inscripciones')
        is distinct from 'array'
      then
        raise exception 'Una tanda no tiene participantes válidos.';
      end if;

      insert into public.tandas_clasificatorias (
        grupo_id,
        numero,
        entradas
      )
      values (
        v_grupo_id,
        (v_tanda ->> 'numero')::integer,
        v_tanda -> 'inscripciones'
      );
    end loop;
  end loop;

  -- Comprobamos que no falten ni se repitan participantes.
  select
    count(*),
    count(distinct (entrada.value ->> 'id')::uuid)
  into v_total, v_distintos
  from public.tandas_clasificatorias as tanda
  join public.grupos_clasificatorias as grupo
    on grupo.id = tanda.grupo_id
  cross join lateral
    jsonb_array_elements(tanda.entradas) as entrada(value)
  where grupo.clasificatoria_id = v_clasi_id;

  if v_total <> v_distintos
    or v_total is distinct from (v_sorteo.plan ->> 'total')::integer
  then
    raise exception 'Los participantes de las tandas no coinciden con el sorteo.';
  end if;



  update public.fechas
    set estado = 'en_curso'
    where id = p_fecha_id;

  return v_clasi_id;
end;
$$;

create or replace function public.consultar_ranking_clasificatoria(p_clasificatoria_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ranking jsonb; v_cierre public.cierres_clasificatorias%rowtype;
begin
  if not private.exigir_organizacion_fecha(private.fecha_recurso('clasi',p_clasificatoria_id)) then
    raise exception 'No tenés permiso para consultar la tabla global.';
  end if;
  select * into v_cierre from public.cierres_clasificatorias
    where clasificatoria_id = p_clasificatoria_id;
  if found then
    return v_cierre.ranking || jsonb_build_object('estado', 'finalizada',
      'cierre', jsonb_build_object('clasificados', v_cierre.clasificados,
        'ganadores_desempate', v_cierre.ganadores_desempate,
        'nota_desempate', v_cierre.nota_desempate, 'cerrado_en', v_cierre.cerrado_en));
  end if;
  v_ranking := private.datos_ranking_clasi(p_clasificatoria_id);
  if v_ranking is null then raise exception 'La clasificatoria no existe.'; end if;
  return v_ranking || jsonb_build_object('cierre', null);
end;
$$;

create or replace function public.cerrar_clasificatorias_y_sortear_octavos(
  p_clasificatoria_id uuid,
  p_version text,
  p_ganadores_desempate uuid[] default '{}',
  p_nota_desempate text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_fecha_id uuid; v_fecha public.fechas%rowtype;
  v_clasi public.clasificatorias%rowtype;
  v_cierre public.cierres_clasificatorias%rowtype;
  v_ranking jsonb; v_corte jsonb;
  v_seleccion uuid[]; v_guardados uuid[]; v_ids uuid[];
  v_nota text := nullif(trim(p_nota_desempate), '');
  v_clasificados jsonb; v_aleatorios jsonb; v_entradas jsonb;
  v_tamanios integer[] := array_fill(0, array[8]);
  v_orden integer[] := array[1,5,3,7,2,6,4,8];
  v_pos integer; v_cursor integer := 0; v_fase text; v_cantidad integer;
  i integer; j integer;
begin
  if not private.exigir_organizacion_fecha(private.fecha_recurso('clasi',p_clasificatoria_id)) then
    raise exception 'No tenés permiso para cerrar clasificatorias.';
  end if;
  select fecha_id into v_fecha_id from public.clasificatorias where id = p_clasificatoria_id;
  if not found then raise exception 'La clasificatoria no existe.'; end if;
  select * into v_fecha from public.fechas where id = v_fecha_id for update;
  select * into v_clasi from public.clasificatorias where id = p_clasificatoria_id for update;
  if p_ganadores_desempate is null or cardinality(p_ganadores_desempate) > 28
    or (cardinality(p_ganadores_desempate) > 0 and array_ndims(p_ganadores_desempate) <> 1)
    or array_position(p_ganadores_desempate, null) is not null then
    raise exception 'La selección del desempate no es válida.';
  end if;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_seleccion
    from unnest(p_ganadores_desempate) d(id);
  if cardinality(v_seleccion) <> (select count(distinct id) from unnest(v_seleccion) d(id)) then
    raise exception 'No podés repetir un participante del desempate.';
  end if;
  select * into v_cierre from public.cierres_clasificatorias where clasificatoria_id = v_clasi.id;
  if found then
    select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_guardados
      from unnest(v_cierre.ganadores_desempate) d(id);
    if p_version = v_cierre.version_consulta and v_seleccion = v_guardados
      and v_nota is not distinct from v_cierre.nota_desempate then
      return v_cierre.sorteo_id;
    end if;
    raise exception 'Las clasis ya fueron cerradas. Actualizá para ver el resultado guardado.';
  end if;
  if v_fecha.estado <> 'en_curso' or v_clasi.estado <> 'en_curso' then
    raise exception 'Las clasificatorias no están en curso.';
  end if;
  if not exists (select 1 from public.sorteos where id = v_clasi.sorteo_id and vigente) then
    raise exception 'El sorteo de esta clasificatoria ya no está vigente.';
  end if;
  if exists (select 1 from public.cruces_eliminatorias where sorteo_id = v_clasi.sorteo_id) then
    raise exception 'Esta fecha ya tiene cruces de eliminatorias. No se modificarán.';
  end if;
  if v_clasi.clasifican not between 2 and 28 then
    raise exception 'El cupo actual debe estar entre 2 y 28 para armar ocho cruces.';
  end if;
  v_ranking := private.datos_ranking_clasi(v_clasi.id);
  if p_version is null or p_version is distinct from v_ranking ->> 'version' then
    raise exception 'La tabla cambió. Actualizá y revisá los resultados antes de cerrar.';
  end if;
  if not (v_ranking ->> 'lista_para_cerrar')::boolean then
    raise exception 'Faltan planillas o tandas por finalizar, o la configuración de los grupos no es válida.';
  end if;
  v_corte := v_ranking -> 'corte';
  if (v_corte ->> 'requiere_desempate')::boolean then
    if cardinality(v_seleccion) <> (v_corte ->> 'cupos')::integer then
      raise exception 'Seleccioná exactamente los % ganadores del repechaje.', v_corte ->> 'cupos';
    end if;
    if exists (select 1 from unnest(v_seleccion) d(id)
      where not (v_corte -> 'empatados') ? id::text) then
      raise exception 'Solo podés elegir participantes empatados en el corte.';
    end if;
    if v_nota is null then raise exception 'Dejá una nota breve sobre el repechaje.'; end if;
  elsif cardinality(v_seleccion) <> 0 or v_nota is not null then
    raise exception 'Esta tabla no requiere desempate en el corte.';
  end if;
  select coalesce(array_agg(id::uuid), '{}'::uuid[]) into v_ids
  from jsonb_array_elements_text(v_corte -> 'directos') d(id);
  if (v_corte ->> 'requiere_desempate')::boolean then
    v_ids := v_ids || v_seleccion;
  else
    select v_ids || coalesce(array_agg(id::uuid), '{}'::uuid[]) into v_ids
      from jsonb_array_elements_text(v_corte -> 'empatados') d(id);
  end if;
  if cardinality(v_ids) <> v_clasi.clasifican then
    raise exception 'La cantidad de clasificados no coincide con los cupos.';
  end if;
  select jsonb_agg(f.value -> 'entrada' order by (f.value ->> 'puesto')::integer,
    f.value ->> 'inscripcion_id') into v_clasificados
  from jsonb_array_elements(v_ranking -> 'filas') f(value)
  where (f.value ->> 'inscripcion_id')::uuid = any(v_ids);
  select jsonb_agg(e.value order by random()) into v_aleatorios
    from jsonb_array_elements(v_clasificados) e(value);
  for i in 1..least(v_clasi.clasifican,16) loop
    v_pos := v_orden[((i - 1) % 8) + 1];
    v_tamanios[v_pos] := v_tamanios[v_pos] + 1;
  end loop;
  if v_clasi.clasifican > 16 then
    for i in 17..v_clasi.clasifican loop
      v_pos := v_orden[((i - 17) % 8) + 1];
      v_tamanios[v_pos] := v_tamanios[v_pos] + 1;
    end loop;
  end if;
  for i in 1..8 loop
    v_entradas := '[]'::jsonb;
    if v_tamanios[i] > 0 then
      for j in 1..v_tamanios[i] loop
        v_entradas := v_entradas || jsonb_build_array(v_aleatorios -> v_cursor);
        v_cursor := v_cursor + 1;
      end loop;
    end if;
    insert into public.cruces_eliminatorias(fecha_id, sorteo_id, fase, numero, entradas)
    values (v_fecha_id, v_clasi.sorteo_id, 'octavos', i, v_entradas);
  end loop;
  foreach v_fase in array array['cuartos','semifinal','final'] loop
    v_cantidad := case v_fase when 'cuartos' then 4 when 'semifinal' then 2 else 1 end;
    for i in 1..v_cantidad loop
      insert into public.cruces_eliminatorias(fecha_id, sorteo_id, fase, numero)
      values (v_fecha_id, v_clasi.sorteo_id, v_fase, i);
    end loop;
  end loop;
  -- Este nuevo cuadro mantiene cuartos y semifinal aleatorios.
  update public.sorteos set eliminatorias_aleatorias = true where id = v_clasi.sorteo_id;
  perform private.actualizar_llaves(v_clasi.sorteo_id);
  insert into public.cierres_clasificatorias(clasificatoria_id, sorteo_id,
    version_consulta, ranking, clasificados, ganadores_desempate, nota_desempate, cerrado_por)
  values (v_clasi.id, v_clasi.sorteo_id, p_version, v_ranking,
    v_clasificados, v_seleccion, v_nota, auth.uid());
  update public.clasificatorias set estado = 'finalizada', finalizado_en = now() where id = v_clasi.id;
  return v_clasi.sorteo_id;
end;
$$;

create or replace function public.guardar_votacion_clasificatoria(
  p_tanda_id uuid,
  p_puntuaciones jsonb,
  p_version integer,
  p_finalizar boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha_id uuid;
  v_fecha public.fechas%rowtype;
  v_clasi public.clasificatorias%rowtype;
  v_tanda public.tandas_clasificatorias%rowtype;
  v_voto public.votaciones_clasificatorias%rowtype;

  v_existe boolean;
  v_fila jsonb;
  v_punto jsonb;
  v_normalizadas jsonb;

  v_total integer;
  v_distintos integer;
  v_jurados integer;
  v_finalizados integer;
  v_nueva_version integer;
begin

  perform id from public.fechas where id=private.fecha_recurso('tanda',p_tanda_id) for update;
  if not exists(select 1 from public.tandas_clasificatorias t where t.id=p_tanda_id and private.jurado_grupo(t.grupo_id)) then raise exception 'No tenés esta tanda asignada o tu acceso fue revocado.'; end if;
  if auth.uid() is null then
    raise exception 'Iniciá sesión para puntuar.';
  end if;


  if p_version is null or p_version < 0 then
    raise exception 'La versión de la planilla no es válida.';
  end if;

  if p_finalizar is null then
    raise exception 'Indicá si querés guardar o finalizar.';
  end if;

  if p_puntuaciones is null
    or jsonb_typeof(p_puntuaciones) <> 'array'
  then
    raise exception 'Las puntuaciones deben ser una lista.';
  end if;

  select clasi.fecha_id
    into v_fecha_id
    from public.tandas_clasificatorias as tanda
    join public.grupos_clasificatorias as grupo
      on grupo.id = tanda.grupo_id
    join public.clasificatorias as clasi
      on clasi.id = grupo.clasificatoria_id
    where tanda.id = p_tanda_id;

  if not found then
    raise exception 'La tanda no existe.';
  end if;

  -- Mismo orden de bloqueo para todas las operaciones.
  select *
    into v_fecha
    from public.fechas
    where id = v_fecha_id
    for update;

  select clasi.*
    into v_clasi
    from public.tandas_clasificatorias as tanda
    join public.grupos_clasificatorias as grupo
      on grupo.id = tanda.grupo_id
    join public.clasificatorias as clasi
      on clasi.id = grupo.clasificatoria_id
    where tanda.id = p_tanda_id
    for update of clasi;

  select *
    into v_tanda
    from public.tandas_clasificatorias
    where id = p_tanda_id
    for update;

  if not exists (
    select 1
    from public.jurados_clasificatorias
    where grupo_id = v_tanda.grupo_id
      and jurado_id = auth.uid()
  ) then
    raise exception 'No estás asignado al grupo de esta tanda.';
  end if;

  -- Cada participante debe aparecer una sola vez.
  if jsonb_array_length(p_puntuaciones)
    <> jsonb_array_length(v_tanda.entradas)
  then
    raise exception 'La planilla debe incluir a todos los participantes.';
  end if;

  for v_fila in
    select value
    from jsonb_array_elements(p_puntuaciones)
  loop
    if jsonb_typeof(v_fila) <> 'object' then
      raise exception 'Una fila de puntuaciones no es válida.';
    end if;

    if jsonb_typeof(v_fila -> 'inscripcion_id')
      is distinct from 'string'
    then
      raise exception 'Una fila no identifica al participante.';
    end if;

    if not exists (
      select 1
      from jsonb_array_elements(v_tanda.entradas) as entrada(value)
      where entrada.value ->> 'id' = v_fila ->> 'inscripcion_id'
    ) then
      raise exception 'La planilla incluye un participante ajeno a esta tanda.';
    end if;

    if jsonb_typeof(v_fila -> 'casillas')
      is distinct from 'array'
    then
      raise exception 'Cada participante debe tener una lista de puntuaciones.';
    end if;

    if jsonb_array_length(v_fila -> 'casillas')
      <> cardinality(v_clasi.casillas)
    then
      raise exception 'La cantidad de casillas no coincide con la planilla.';
    end if;

    for v_punto in
      select value
      from jsonb_array_elements(v_fila -> 'casillas')
    loop
      if jsonb_typeof(v_punto) <> 'null' then
        if jsonb_typeof(v_punto) <> 'number' then
          raise exception 'Las puntuaciones deben ser números entre 0 y 4.';
        end if;

        if (v_punto #>> '{}')::numeric < 0
          or (v_punto #>> '{}')::numeric > 4
        then
          raise exception 'Las puntuaciones deben estar entre 0 y 4.';
        end if;
      end if;
    end loop;
  end loop;

  select
    count(*),
    count(distinct fila.value ->> 'inscripcion_id')
  into v_total, v_distintos
  from jsonb_array_elements(p_puntuaciones) as fila(value);

  if v_total <> v_distintos then
    raise exception 'La planilla tiene participantes repetidos.';
  end if;

  -- Guardamos las filas en el mismo orden que la tanda.
  -- Los campos adicionales enviados por el cliente se descartan.
  select jsonb_agg(
    jsonb_build_object(
      'inscripcion_id', entrada.value ->> 'id',
      'casillas', fila.value -> 'casillas'
    )
    order by entrada.posicion
  )
  into v_normalizadas
  from jsonb_array_elements(v_tanda.entradas)
    with ordinality as entrada(value, posicion)
  join jsonb_array_elements(p_puntuaciones) as fila(value)
    on fila.value ->> 'inscripcion_id' = entrada.value ->> 'id';

  select *
    into v_voto
    from public.votaciones_clasificatorias
    where tanda_id = p_tanda_id
      and jurado_id = auth.uid()
    for update;

  v_existe := found;

  if v_existe and v_voto.estado = 'finalizada' then
    -- Permite recuperar una finalización cuya respuesta se perdió.
    if p_finalizar and v_voto.puntuaciones = v_normalizadas then
      return v_voto.version;
    end if;

    raise exception 'Tu planilla ya está finalizada.';
  end if;

  if v_fecha.estado <> 'en_curso'
    or v_clasi.estado <> 'en_curso'
    or v_tanda.estado <> 'en_curso'
  then
    raise exception 'Esta tanda no está abierta para puntuar.';
  end if;

  if v_existe then
    if p_version <> v_voto.version then
      raise exception
        'Tu planilla cambió en otro dispositivo. Actualizá antes de guardar.';
    end if;

    update public.votaciones_clasificatorias
      set puntuaciones = v_normalizadas,
          estado = case
            when p_finalizar then 'finalizada'
            else 'borrador'
          end,
          version = version + 1,
          actualizado_en = now(),
          finalizado_en = case
            when p_finalizar then now()
            else null
          end
      where id = v_voto.id
      returning version into v_nueva_version;
  else
    if p_version <> 0 then
      raise exception 'La planilla cambió. Actualizá antes de guardar.';
    end if;

    insert into public.votaciones_clasificatorias (
      tanda_id,
      jurado_id,
      puntuaciones,
      estado,
      finalizado_en
    )
    values (
      p_tanda_id,
      auth.uid(),
      v_normalizadas,
      case
        when p_finalizar then 'finalizada'
        else 'borrador'
      end,
      case
        when p_finalizar then now()
        else null
      end
    )
    returning version into v_nueva_version;
  end if;

  if p_finalizar then
    select count(*)
      into v_jurados
      from public.jurados_clasificatorias
      where grupo_id = v_tanda.grupo_id;

    select count(*)
      into v_finalizados
      from public.votaciones_clasificatorias as voto
      join public.jurados_clasificatorias as jurado
        on jurado.grupo_id = v_tanda.grupo_id
        and jurado.jurado_id = voto.jurado_id
      where voto.tanda_id = p_tanda_id
        and voto.estado = 'finalizada';

    if v_jurados > 0 and v_finalizados = v_jurados then
      update public.tandas_clasificatorias
        set estado = 'finalizada',
            version = version + 1
        where id = p_tanda_id;
    end if;
  end if;

  return v_nueva_version;
end;
$$;

create or replace function public.agregar_participante_clasi(
  p_grupo_id uuid,
  p_tanda_id uuid,
  p_nombre text,
  p_integrantes text[],
  p_solicitud_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_fecha public.fechas%rowtype;
  v_clasi public.clasificatorias%rowtype;
  v_tanda public.tandas_clasificatorias%rowtype;
  v_anterior private.altas_clasificatorias%rowtype;
  v_fecha_id uuid;
  v_clasi_id uuid;
  v_aliases text[];
  v_nombre text;
  v_inscripcion_id uuid := gen_random_uuid();
  v_tanda_id uuid;
  v_numero integer;
  v_solicitud jsonb;
  v_resultado jsonb;
  v_entrada jsonb;
  v_fila_voto jsonb;
begin

  perform id from public.fechas where id=private.fecha_recurso('grupo',p_grupo_id) for update;
  if not private.jurado_grupo(p_grupo_id) then raise exception 'No tenés este grupo asignado o tu acceso fue revocado.'; end if;
  if auth.uid() is null then
    raise exception 'Iniciá sesión con tu cuenta de jurado.';
  end if;
  if not exists (
    select 1 from public.jurados_clasificatorias
    where grupo_id = p_grupo_id and jurado_id = auth.uid()
  ) then
    raise exception 'No tenés este grupo asignado.';
  end if;
  if p_solicitud_id is null then
    raise exception 'Falta el identificador de la solicitud.';
  end if;
  select c.fecha_id, c.id into v_fecha_id, v_clasi_id
  from public.grupos_clasificatorias g
  join public.clasificatorias c on c.id = g.clasificatoria_id
  where g.id = p_grupo_id;

  -- Igual que guardar_votacion: fecha, clasificatoria, tanda, votos.
  select * into v_fecha from public.fechas where id = v_fecha_id for update;
  select * into v_clasi from public.clasificatorias where id = v_clasi_id for update;

  if p_integrantes is null or array_ndims(p_integrantes) is distinct from 1
    or cardinality(p_integrantes) <> v_fecha.integrantes_por_equipo then
    raise exception 'La cantidad de integrantes no coincide con el formato.';
  end if;
  select array_agg(trim(alias) order by posicion) into v_aliases
  from unnest(p_integrantes) with ordinality as datos(alias, posicion);
  if exists (select 1 from unnest(v_aliases) as datos(alias) where alias is null or alias = '') then
    raise exception 'Completá todos los alias.';
  end if;
  if (select count(distinct lower(alias)) from unnest(v_aliases) as datos(alias))
    <> cardinality(v_aliases) then
    raise exception 'No podés repetir un integrante dentro del equipo.';
  end if;
  v_nombre := case when v_fecha.integrantes_por_equipo = 1 then v_aliases[1] else trim(p_nombre) end;
  if v_nombre is null or v_nombre = '' then
    raise exception 'Ingresá el nombre del equipo.';
  end if;
  v_solicitud := jsonb_build_object('grupo_id', p_grupo_id, 'tanda_id', p_tanda_id,
    'nombre', v_nombre, 'integrantes', to_jsonb(v_aliases));

  select * into v_anterior from private.altas_clasificatorias where solicitud_id = p_solicitud_id;
  if found then
    if v_anterior.usuario_id <> auth.uid() or v_anterior.solicitud <> v_solicitud then
      raise exception 'Esta solicitud ya se usó con otros datos. Actualizá la pantalla.';
    end if;
    return v_anterior.resultado;
  end if;
  if v_fecha.estado <> 'en_curso' or v_clasi.estado <> 'en_curso' then
    raise exception 'Las clasificatorias no están en curso.';
  end if;

  if p_tanda_id is null then
    -- La fecha bloqueada serializa las altas, incluso entre grupos.
    v_tanda_id := gen_random_uuid();
    select coalesce(max(numero), 0) + 1 into v_numero
    from public.tandas_clasificatorias where grupo_id = p_grupo_id;
  else
    select * into v_tanda from public.tandas_clasificatorias where id = p_tanda_id for update;
    if not found or v_tanda.grupo_id <> p_grupo_id then
      raise exception 'La tanda no pertenece a este grupo.';
    end if;
    if v_tanda.estado <> 'en_curso' or v_tanda.participantes_bloqueados
      or exists (select 1 from public.votaciones_clasificatorias
        where tanda_id = p_tanda_id and estado = 'finalizada') then
      raise exception 'Ya se finalizó una planilla en esta tanda. Elegí otra o creá una nueva.';
    end if;
    if jsonb_array_length(v_tanda.entradas) >= coalesce(v_fecha.maximo_tanda,5) then
      raise exception 'La tanda alcanzó el máximo configurado. Elegí otra o creá una nueva.';
    end if;
    v_tanda_id := v_tanda.id;
    v_numero := v_tanda.numero;
  end if;

  if exists (
    select 1 from public.inscripcion_integrantes i
    join public.inscripciones s on s.id = i.inscripcion_id
    where s.fecha_id = v_fecha.id and lower(trim(i.alias)) in (
      select lower(alias) from unnest(v_aliases) as datos(alias)
    )
  ) then
    raise exception 'Uno de los alias ya está inscripto en esta fecha.';
  end if;
  if exists (select 1 from public.inscripciones
    where fecha_id = v_fecha.id and lower(trim(nombre)) = lower(v_nombre)) then
    raise exception 'Ese nombre ya está inscripto en esta fecha.';
  end if;

  v_resultado := jsonb_build_object('inscripcion_id', v_inscripcion_id,
    'tanda_id', v_tanda_id, 'numero', v_numero);
  insert into private.altas_clasificatorias
    (solicitud_id, inscripcion_id, fecha_id, grupo_id, tanda_id, usuario_id, solicitud, resultado)
  values (p_solicitud_id, v_inscripcion_id, v_fecha.id, p_grupo_id,
    v_tanda_id, auth.uid(), v_solicitud, v_resultado);

  insert into public.inscripciones(id, fecha_id, nombre) values (v_inscripcion_id, v_fecha.id, v_nombre);
  insert into public.inscripcion_integrantes(inscripcion_id, alias, orden)
  select v_inscripcion_id, alias, posicion::integer
  from unnest(v_aliases) with ordinality as datos(alias, posicion);
  insert into public.inscripciones_historial(inscripcion_id, accion, despues, usuario_id, usuario_nombre)
  values (v_inscripcion_id, 'creacion', private.snapshot_inscripcion(v_inscripcion_id),
    auth.uid(), (select nombre from public.perfiles where id = auth.uid()));

  v_entrada := jsonb_build_object('id', v_inscripcion_id, 'nombre', v_nombre,
    'version', 1, 'integrantes', to_jsonb(v_aliases));
  if p_tanda_id is null then
    insert into public.tandas_clasificatorias(id, grupo_id, numero, entradas)
    values (v_tanda_id, p_grupo_id, v_numero, jsonb_build_array(v_entrada));
  else
    update public.tandas_clasificatorias
    set entradas = entradas || jsonb_build_array(v_entrada), version = version + 1
    where id = v_tanda_id;
    v_fila_voto := jsonb_build_object('inscripcion_id', v_inscripcion_id,
      'casillas', (select jsonb_agg(null::text) from generate_series(1, cardinality(v_clasi.casillas))));
    -- Agregar solo la fila nueva. No tocar ningún punto ya registrado.
    update public.votaciones_clasificatorias
    set puntuaciones = puntuaciones || jsonb_build_array(v_fila_voto),
      version = version + 1, actualizado_en = now()
    where tanda_id = v_tanda_id and estado = 'borrador';
  end if;
  return v_resultado;
end;
$$;

create or replace function public.consultar_tandas_jurado(p_grupo_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_resultado jsonb;
begin

  perform id from public.fechas where id=private.fecha_recurso('grupo',p_grupo_id) for update;
  if not private.jurado_grupo(p_grupo_id) then raise exception 'No tenés este grupo asignado o tu acceso fue revocado.'; end if;
  if auth.uid() is null or not exists (
    select 1 from public.jurados_clasificatorias
    where grupo_id = p_grupo_id and jurado_id = auth.uid()
  ) then
    raise exception 'No tenés este grupo asignado.';
  end if;
  select jsonb_build_object(
    'tandas', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.numero)
      from public.tandas_clasificatorias t where t.grupo_id = p_grupo_id
    ), '[]'::jsonb),
    'votos', coalesce((
      select jsonb_agg(to_jsonb(v) order by t.numero)
      from public.votaciones_clasificatorias v
      join public.tandas_clasificatorias t on t.id = v.tanda_id
      where t.grupo_id = p_grupo_id and v.jurado_id = auth.uid()
    ), '[]'::jsonb)
  ) into v_resultado;
  return v_resultado;
end;
$$;

-- Interfaz vieja: operación de ausencia retirada también del servidor.
revoke all on function public.retirar_participante_clasi(uuid,uuid,integer) from public,anon,authenticated;
commit;
