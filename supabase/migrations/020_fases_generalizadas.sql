begin;
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

  if p_fase is null or p_fase not in ('octavos','cuartos', 'semifinal') then
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
    when 'octavos' then 'dieciseisavos'
    when 'cuartos' then 'octavos'
    else 'cuartos'
  end;

  v_esperados := case p_fase
    when 'octavos' then 16
    when 'cuartos' then 8
    else 4
  end;

  v_destinos := case p_fase
    when 'octavos' then 8
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

  if jsonb_array_length(v_participantes) < 1
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
    when 'dieciseisavos' then 0
            when 'octavos' then 1
    when 'cuartos' then 2
    when 'semifinal' then 3
    else 4
  end;

  if v_aleatorias then
    v_siguiente := case v_cruce.fase
      when 'dieciseisavos' then 'octavos'
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
            when 'dieciseisavos' then 0
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
            when 'dieciseisavos' then 0
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
commit;
