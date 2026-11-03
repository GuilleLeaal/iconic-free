begin;

-- Las nuevas eliminatorias usan sorteos entre fases.
alter table public.sorteos
  add column eliminatorias_aleatorias boolean not null default true;

-- Conservamos el funcionamiento de las eliminatorias ya iniciadas.
update public.sorteos as sorteo
set eliminatorias_aleatorias = false
where exists (
  select 1
  from public.cruces_eliminatorias as cruce
  where cruce.sorteo_id = sorteo.id
);

create table public.sorteos_fases_eliminatorias (
  id uuid primary key default gen_random_uuid(),

  fecha_id uuid not null
    references public.fechas(id),

  sorteo_id uuid not null
    references public.sorteos(id),

  fase text not null
    check (fase in ('cuartos', 'semifinal')),

  participantes jsonb not null
    check (jsonb_typeof(participantes) = 'array'),

  generado_por uuid not null
    references public.perfiles(id),

  creado_en timestamptz not null default now(),

  unique (sorteo_id, fase)
);

alter table public.sorteos_fases_eliminatorias
  enable row level security;

create policy "Organizacion consulta sorteos por fase"
  on public.sorteos_fases_eliminatorias
  for select
  to authenticated
  using (private.es_organizacion());

revoke all on public.sorteos_fases_eliminatorias
  from anon, authenticated;

grant select on public.sorteos_fases_eliminatorias
  to authenticated;

-- Conservamos la función anterior para las fechas ya iniciadas.
alter function private.actualizar_llaves(uuid)
  rename to actualizar_llaves_fijas;

revoke all on function private.actualizar_llaves_fijas(uuid)
  from public, anon, authenticated;


-- =========================================================
-- NUEVO AVANCE: CUARTOS Y SEMIFINAL ESPERAN SU SORTEO
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
  v_aleatorias boolean;
  v_cruce public.cruces_eliminatorias%rowtype;
  v_entradas jsonb;
  v_total integer;
  v_resueltas integer;
begin
  select eliminatorias_aleatorias
    into v_aleatorias
    from public.sorteos
    where id = p_sorteo_id;

  if not found then
    raise exception 'El sorteo no existe.';
  end if;

  if not v_aleatorias then
    perform private.actualizar_llaves_fijas(p_sorteo_id);
    return;
  end if;

  -- Octavos proviene del sorteo inicial.
  update public.cruces_eliminatorias
    set listo = true,
        version = version + 1
    where sorteo_id = p_sorteo_id
      and fase = 'octavos'
      and listo = false;

  -- Resolvemos vacantes y pases libres de las fases preparadas.
  -- Cuartos y semifinal solo quedan listos al sortearlos.
  for v_cruce in
    select *
    from public.cruces_eliminatorias
    where sorteo_id = p_sorteo_id
      and fase in ('octavos', 'cuartos', 'semifinal')
      and listo = true
      and estado = 'pendiente'
      and jsonb_array_length(entradas) <= 1
    for update
  loop
    if jsonb_array_length(v_cruce.entradas) = 0 then
      update public.cruces_eliminatorias
        set estado = 'vacante',
            resolucion = 'automatica',
            confirmado_en = now(),
            version = version + 1
        where id = v_cruce.id;
    else
      update public.cruces_eliminatorias
        set estado = 'resuelto',
            ganador_id = (entradas -> 0 ->> 'id')::uuid,
            resolucion = 'automatica',
            confirmado_en = now(),
            version = version + 1
        where id = v_cruce.id;
    end if;
  end loop;

  -- La final se prepara cuando terminan ambas semifinales.
  select
    count(*),
    count(*) filter (
      where listo = true
        and estado in ('resuelto', 'vacante')
    )
  into v_total, v_resueltas
  from public.cruces_eliminatorias
  where sorteo_id = p_sorteo_id
    and fase = 'semifinal';

  if v_total = 2 and v_resueltas = 2 then
    select coalesce(
      jsonb_agg(entrada.value order by fuente.numero),
      '[]'::jsonb
    )
    into v_entradas
    from public.cruces_eliminatorias as fuente
    cross join lateral
      jsonb_array_elements(fuente.entradas) as entrada(value)
    where fuente.sorteo_id = p_sorteo_id
      and fuente.fase = 'semifinal'
      and fuente.estado = 'resuelto'
      and (entrada.value ->> 'id')::uuid = fuente.ganador_id;

    update public.cruces_eliminatorias
      set entradas = v_entradas,
          listo = true,
          version = version + 1
      where sorteo_id = p_sorteo_id
        and fase = 'final'
        and listo = false;
  end if;
end;
$$;

revoke all on function private.actualizar_llaves(uuid)
  from public, anon, authenticated;


-- =========================================================
-- SORTEAR CUARTOS O SEMIFINAL
-- =========================================================

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
  if not private.es_organizacion() then
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

revoke all on function public.sortear_fase_eliminatoria(uuid, text)
  from public, anon;

grant execute on function public.sortear_fase_eliminatoria(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;