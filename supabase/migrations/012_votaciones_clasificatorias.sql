begin;

-- =========================================================
-- UNA PLANILLA POR JURADO Y TANDA
-- =========================================================

create table public.votaciones_clasificatorias (
  id uuid primary key default gen_random_uuid(),

  tanda_id uuid not null
    references public.tandas_clasificatorias(id),

  jurado_id uuid not null
    references public.perfiles(id),

  puntuaciones jsonb not null
    check (jsonb_typeof(puntuaciones) = 'array'),

  estado text not null default 'borrador'
    check (estado in ('borrador', 'finalizada')),

  version integer not null default 1
    check (version >= 1),

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  finalizado_en timestamptz,

  unique (tanda_id, jurado_id),

  check (
    (estado = 'borrador' and finalizado_en is null)
    or
    (estado = 'finalizada' and finalizado_en is not null)
  )
);

alter table public.votaciones_clasificatorias
  enable row level security;

create policy "Consultar puntuaciones propias u organizacion"
  on public.votaciones_clasificatorias
  for select
  to authenticated
  using (
    private.es_organizacion()
    or jurado_id = auth.uid()
  );

revoke all on public.votaciones_clasificatorias
  from anon, authenticated;

grant select on public.votaciones_clasificatorias
  to authenticated;

-- Como máximo, una tanda abierta por grupo.
create unique index una_tanda_abierta_por_grupo
  on public.tandas_clasificatorias(grupo_id)
  where estado = 'en_curso';


-- =========================================================
-- LA ORGANIZACIÓN ABRE UNA TANDA
-- =========================================================

create or replace function public.abrir_tanda_clasificatoria(
  p_tanda_id uuid,
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
  v_clasi public.clasificatorias%rowtype;
  v_tanda public.tandas_clasificatorias%rowtype;
begin
  if not private.es_organizacion() then
    raise exception 'No tenés permiso para abrir tandas.';
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

  -- Recuperar una solicitud ya guardada no vuelve a abrirla.
  if v_tanda.estado = 'en_curso' then
    return;
  end if;

  if v_fecha.estado <> 'en_curso'
    or v_clasi.estado <> 'en_curso'
  then
    raise exception 'Las clasificatorias no están en curso.';
  end if;

  if p_version is null or p_version <> v_tanda.version then
    raise exception 'La tanda cambió. Actualizá antes de abrirla.';
  end if;

  if v_tanda.estado <> 'pendiente' then
    raise exception 'Esta tanda ya terminó.';
  end if;

  if exists (
    select 1
    from public.tandas_clasificatorias
    where grupo_id = v_tanda.grupo_id
      and estado = 'en_curso'
  ) then
    raise exception 'Este grupo ya tiene una tanda abierta.';
  end if;

  if exists (
    select 1
    from public.tandas_clasificatorias
    where grupo_id = v_tanda.grupo_id
      and numero < v_tanda.numero
      and estado <> 'finalizada'
  ) then
    raise exception 'Terminá las tandas anteriores de este grupo.';
  end if;

  update public.tandas_clasificatorias
    set estado = 'en_curso',
        version = version + 1
    where id = p_tanda_id;
end;
$$;

revoke all on function public.abrir_tanda_clasificatoria(
  uuid, integer
) from public, anon;

grant execute on function public.abrir_tanda_clasificatoria(
  uuid, integer
) to authenticated;


-- =========================================================
-- EL JURADO GUARDA O FINALIZA SU PLANILLA
-- =========================================================

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
  if auth.uid() is null then
    raise exception 'Iniciá sesión para puntuar.';
  end if;

  if not exists (
    select 1
    from public.perfiles
    where id = auth.uid()
      and rol = 'jurado'
  ) then
    raise exception 'Tu cuenta no tiene el rol de jurado.';
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
      if jsonb_typeof(v_punto) = 'null' then
        if p_finalizar then
          raise exception 'Completá todas las casillas antes de finalizar.';
        end if;
      else
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

revoke all on function public.guardar_votacion_clasificatoria(
  uuid, jsonb, integer, boolean
) from public, anon;

grant execute on function public.guardar_votacion_clasificatoria(
  uuid, jsonb, integer, boolean
) to authenticated;

notify pgrst, 'reload schema';

commit;