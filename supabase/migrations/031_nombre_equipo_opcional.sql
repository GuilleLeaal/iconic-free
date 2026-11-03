begin;
-- El nombre del equipo es opcional. Se conserva nombre como etiqueta no vacía
-- usando los alias en su orden; no se modifican inscripciones existentes.

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
        v_nombre := coalesce(nullif(trim(p_nombre), ''), array_to_string(v_integrantes, ' / '));
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
            else coalesce(nullif(trim(p_nombre), ''), array_to_string(v_aliases, ' / '))
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
  v_nombre := case when v_fecha.integrantes_por_equipo = 1 then v_aliases[1] else coalesce(nullif(trim(p_nombre), ''), array_to_string(v_aliases, ' / ')) end;
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

notify pgrst, 'reload schema';
commit;

