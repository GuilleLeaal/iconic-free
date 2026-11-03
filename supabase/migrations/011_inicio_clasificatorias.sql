begin;

-- =========================================================
-- CLASIFICATORIA DE UNA FECHA
-- =========================================================

create table public.clasificatorias (
  id uuid primary key default gen_random_uuid(),

  fecha_id uuid not null
    references public.fechas(id),

  sorteo_id uuid not null unique
    references public.sorteos(id),

  estado text not null default 'en_curso'
    check (estado in ('en_curso', 'finalizada')),

  casillas text[] not null
    check (
      cardinality(casillas) > 0
      and array_ndims(casillas) = 1
      and array_position(casillas, null) is null
    ),

  clasifican integer not null
    check (clasifican >= 2),

  iniciado_por uuid not null
    references public.perfiles(id),

  iniciado_en timestamptz not null default now(),

  finalizado_en timestamptz
);

create index clasificatorias_fecha_idx
  on public.clasificatorias(fecha_id);


-- =========================================================
-- GRUPOS Y JURADOS
-- =========================================================

create table public.grupos_clasificatorias (
  id uuid primary key default gen_random_uuid(),

  clasificatoria_id uuid not null
    references public.clasificatorias(id),

  nombre text not null
    check (nombre in ('A', 'B', 'C')),

  unique (clasificatoria_id, nombre)
);

create table public.jurados_clasificatorias (
  grupo_id uuid not null
    references public.grupos_clasificatorias(id),

  jurado_id uuid not null
    references public.perfiles(id),

  -- Copia del nombre al comenzar.
  nombre text not null,

  primary key (grupo_id, jurado_id)
);

create index jurados_clasificatorias_jurado_idx
  on public.jurados_clasificatorias(jurado_id);


-- =========================================================
-- TANDAS
-- =========================================================

create table public.tandas_clasificatorias (
  id uuid primary key default gen_random_uuid(),

  grupo_id uuid not null
    references public.grupos_clasificatorias(id),

  numero integer not null
    check (numero >= 1),

  entradas jsonb not null
    check (
      jsonb_typeof(entradas) = 'array'
      and jsonb_array_length(entradas) between 1 and 5
    ),

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_curso', 'finalizada')),

  version integer not null default 1
    check (version >= 1),

  unique (grupo_id, numero)
);


-- =========================================================
-- PERMISOS DE CONSULTA
-- =========================================================

create or replace function private.puede_ver_grupo_clasi(
  p_grupo_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.es_organizacion()
    or exists (
      select 1
      from public.jurados_clasificatorias
      where grupo_id = p_grupo_id
        and jurado_id = auth.uid()
    );
$$;

create or replace function private.puede_ver_clasificatoria(
  p_clasificatoria_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.es_organizacion()
    or exists (
      select 1
      from public.grupos_clasificatorias as grupo
      join public.jurados_clasificatorias as jurado
        on jurado.grupo_id = grupo.id
      where grupo.clasificatoria_id = p_clasificatoria_id
        and jurado.jurado_id = auth.uid()
    );
$$;

revoke all on function private.puede_ver_grupo_clasi(uuid)
  from public, anon;

revoke all on function private.puede_ver_clasificatoria(uuid)
  from public, anon;

grant execute on function private.puede_ver_grupo_clasi(uuid)
  to authenticated;

grant execute on function private.puede_ver_clasificatoria(uuid)
  to authenticated;

alter table public.clasificatorias
  enable row level security;

alter table public.grupos_clasificatorias
  enable row level security;

alter table public.jurados_clasificatorias
  enable row level security;

alter table public.tandas_clasificatorias
  enable row level security;

create policy "Consultar clasificatorias asignadas"
  on public.clasificatorias
  for select
  to authenticated
  using (private.puede_ver_clasificatoria(id));

create policy "Consultar grupos asignados"
  on public.grupos_clasificatorias
  for select
  to authenticated
  using (private.puede_ver_grupo_clasi(id));

create policy "Consultar jurados de clasificatorias"
  on public.jurados_clasificatorias
  for select
  to authenticated
  using (
    private.es_organizacion()
    or jurado_id = auth.uid()
  );

create policy "Consultar tandas del grupo asignado"
  on public.tandas_clasificatorias
  for select
  to authenticated
  using (private.puede_ver_grupo_clasi(grupo_id));

create policy "Jurado consulta fecha de su clasificatoria"
  on public.fechas
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.clasificatorias as clasi
      where clasi.fecha_id = fechas.id
        and private.puede_ver_clasificatoria(clasi.id)
    )
  );

revoke all on
  public.clasificatorias,
  public.grupos_clasificatorias,
  public.jurados_clasificatorias,
  public.tandas_clasificatorias
from anon, authenticated;

grant select on
  public.clasificatorias,
  public.grupos_clasificatorias,
  public.jurados_clasificatorias,
  public.tandas_clasificatorias
to authenticated;


-- =========================================================
-- INICIAR CLASIFICATORIAS
-- =========================================================

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
  if not private.es_organizacion() then
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
      and perfil.rol = 'jurado';

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

  if v_total <= (v_sorteo.plan ->> 'clasifican')::integer then
    raise exception 'La cantidad de participantes no requiere esta clasificatoria.';
  end if;

  update public.fechas
    set estado = 'en_curso'
    where id = p_fecha_id;

  return v_clasi_id;
end;
$$;

revoke all on function public.iniciar_clasificatorias(uuid)
  from public, anon;

grant execute on function public.iniciar_clasificatorias(uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;