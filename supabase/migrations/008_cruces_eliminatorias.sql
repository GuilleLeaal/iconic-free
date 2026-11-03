begin;

-- =========================================================
-- CRUCES Y RESULTADOS
-- =========================================================

create table public.cruces_eliminatorias (
  id uuid primary key default gen_random_uuid(),

  fecha_id uuid not null
    references public.fechas(id),

  sorteo_id uuid not null
    references public.sorteos(id),

  fase text not null
    check (fase in ('octavos', 'cuartos', 'semifinal', 'final')),

  numero integer not null,

  -- Copia de los participantes del sorteo:
  -- id, nombre, versión de inscripción e integrantes.
  entradas jsonb not null default '[]'::jsonb
    check (jsonb_typeof(entradas) = 'array'),

  listo boolean not null default false,

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'resuelto', 'vacante')),

  ganador_id uuid
    references public.inscripciones(id),

  resolucion text
    check (resolucion in ('manual', 'automatica')),

  confirmado_por uuid
    references public.perfiles(id),

  confirmado_en timestamptz,

  version integer not null default 1
    check (version >= 1),

  creado_en timestamptz not null default now(),

  unique (sorteo_id, fase, numero),

  check (
    (fase = 'octavos' and numero between 1 and 8)
    or (fase = 'cuartos' and numero between 1 and 4)
    or (fase = 'semifinal' and numero between 1 and 2)
    or (fase = 'final' and numero = 1)
  ),

  check (
    (
      estado = 'pendiente'
      and ganador_id is null
      and resolucion is null
    )
    or (
      estado = 'vacante'
      and ganador_id is null
      and resolucion = 'automatica'
    )
    or (
      estado = 'resuelto'
      and ganador_id is not null
      and resolucion is not null
    )
  )
);

create index cruces_eliminatorias_fecha_idx
  on public.cruces_eliminatorias(fecha_id);

alter table public.cruces_eliminatorias
  enable row level security;

create policy "Organizacion consulta eliminatorias"
  on public.cruces_eliminatorias
  for select
  to authenticated
  using (private.es_organizacion());

revoke all on public.cruces_eliminatorias
  from anon, authenticated;

grant select on public.cruces_eliminatorias
  to authenticated;


-- =========================================================
-- AVANCE AUTOMÁTICO DE LLAVES
-- =========================================================

create or replace function private.actualizar_llaves(
  p_sorteo_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fase text;
  v_anterior text;
  v_cruce public.cruces_eliminatorias%rowtype;
  v_entradas jsonb;
  v_listo boolean;
  v_estado text;
  v_ganador uuid;
  v_resolucion text;
  v_fuentes integer;
  v_resueltas integer;
begin
  foreach v_fase in array array[
    'octavos', 'cuartos', 'semifinal', 'final'
  ]
  loop
    v_anterior := case v_fase
      when 'cuartos' then 'octavos'
      when 'semifinal' then 'cuartos'
      when 'final' then 'semifinal'
      else null
    end;

    for v_cruce in
      select *
      from public.cruces_eliminatorias
      where sorteo_id = p_sorteo_id
        and fase = v_fase
      order by numero
      for update
    loop
      -- Los resultados confirmados no se modifican aquí.
      if v_cruce.estado <> 'pendiente' then
        continue;
      end if;

      if v_fase = 'octavos' then
        v_entradas := v_cruce.entradas;
        v_listo := true;
      else
        select
          count(*),
          count(*) filter (
            where estado in ('resuelto', 'vacante')
          )
        into v_fuentes, v_resueltas
        from public.cruces_eliminatorias
        where sorteo_id = p_sorteo_id
          and fase = v_anterior
          and numero in (
            v_cruce.numero * 2 - 1,
            v_cruce.numero * 2
          );

        v_listo := v_fuentes = 2 and v_resueltas = 2;

        -- Conservamos el orden de las ramas de la llave.
        select coalesce(
          jsonb_agg(entrada.value order by fuente.numero),
          '[]'::jsonb
        )
        into v_entradas
        from public.cruces_eliminatorias as fuente
        cross join lateral
          jsonb_array_elements(fuente.entradas) as entrada(value)
        where fuente.sorteo_id = p_sorteo_id
          and fuente.fase = v_anterior
          and fuente.numero in (
            v_cruce.numero * 2 - 1,
            v_cruce.numero * 2
          )
          and fuente.estado = 'resuelto'
          and (entrada.value ->> 'id')::uuid = fuente.ganador_id;
      end if;

      v_estado := 'pendiente';
      v_ganador := null;
      v_resolucion := null;

      -- Un pase libre solo se resuelve cuando ambas ramas
      -- de origen terminaron. Así no adelantamos a nadie
      -- mientras todavía falta conocer su rival.
      if v_listo then
        if jsonb_array_length(v_entradas) = 0 then
          v_estado := 'vacante';
          v_resolucion := 'automatica';

        elsif jsonb_array_length(v_entradas) = 1 then
          v_estado := 'resuelto';
          v_ganador := (v_entradas -> 0 ->> 'id')::uuid;
          v_resolucion := 'automatica';
        end if;
      end if;

      if v_cruce.entradas is distinct from v_entradas
        or v_cruce.listo is distinct from v_listo
        or v_cruce.estado is distinct from v_estado
        or v_cruce.ganador_id is distinct from v_ganador
        or v_cruce.resolucion is distinct from v_resolucion
      then
        update public.cruces_eliminatorias
        set entradas = v_entradas,
            listo = v_listo,
            estado = v_estado,
            ganador_id = v_ganador,
            resolucion = v_resolucion,
            confirmado_en = case
              when v_estado <> 'pendiente' then now()
              else null
            end,
            version = version + 1
        where id = v_cruce.id;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function private.actualizar_llaves(uuid)
  from public, anon, authenticated;


-- =========================================================
-- INICIAR ELIMINATORIAS DESDE EL SORTEO
-- =========================================================

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
  if not private.es_organizacion() then
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

revoke all on function public.iniciar_eliminatorias(uuid)
  from public, anon;

grant execute on function public.iniciar_eliminatorias(uuid)
  to authenticated;


-- =========================================================
-- CONFIRMAR UN GANADOR
-- =========================================================

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
  if not private.es_organizacion() then
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

revoke all on function public.confirmar_ganador_cruce(
  uuid, uuid, integer
) from public, anon;

grant execute on function public.confirmar_ganador_cruce(
  uuid, uuid, integer
) to authenticated;

notify pgrst, 'reload schema';

commit;