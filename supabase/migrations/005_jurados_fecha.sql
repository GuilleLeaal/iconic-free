begin;

create table public.jurados_fecha (
  id uuid primary key default gen_random_uuid(),

  fecha_id uuid not null
    references public.fechas(id),

  jurado_id uuid not null
    references public.perfiles(id),

  apartado text not null
    check (
      apartado in (
        'eliminatorias',
        'clasi_a',
        'clasi_b',
        'clasi_c'
      )
    ),

  asignado_por uuid not null
    references public.perfiles(id),

  creado_en timestamptz not null default now(),

  unique (fecha_id, jurado_id, apartado)
);

create index jurados_fecha_jurado_idx
  on public.jurados_fecha(jurado_id, fecha_id);

alter table public.jurados_fecha
  enable row level security;

-- La organización ve todas las asignaciones.
-- Cada jurado puede consultar las suyas.
create policy "Consultar asignaciones de jurados"
  on public.jurados_fecha
  for select
  to authenticated
  using (
    private.es_organizacion()
    or jurado_id = auth.uid()
  );

revoke all on public.jurados_fecha
  from anon, authenticated;

grant select on public.jurados_fecha
  to authenticated;

-- Las modificaciones pasan por esta función.
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
  if not private.es_organizacion() then
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
      and rol = 'jurado'
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

revoke all on function public.configurar_jurado_fecha(
  uuid, uuid, text, boolean
) from public, anon;

grant execute on function public.configurar_jurado_fecha(
  uuid, uuid, text, boolean
) to authenticated;

notify pgrst, 'reload schema';

commit;