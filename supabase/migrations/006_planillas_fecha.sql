begin;

create table public.planillas_fecha (
  id uuid primary key default gen_random_uuid(),

  fecha_id uuid not null
    references public.fechas(id),

  tipo text not null
    check (tipo in ('eliminatorias', 'clasificatorias')),

  casillas text[] not null
    check (
      cardinality(casillas) > 0
      and array_ndims(casillas) = 1
      and array_position(casillas, null) is null
    ),

  version integer not null default 1
    check (version >= 1),

  actualizado_por uuid not null
    references public.perfiles(id),

  creado_en timestamptz not null default now(),

  actualizado_en timestamptz not null default now(),

  unique (fecha_id, tipo)
);

alter table public.planillas_fecha
  enable row level security;

create policy "Consultar configuracion de planillas"
  on public.planillas_fecha
  for select
  to authenticated
  using (
    private.es_organizacion()
    or exists (
      select 1
      from public.jurados_fecha as asignacion
      where asignacion.fecha_id = planillas_fecha.fecha_id
        and asignacion.jurado_id = auth.uid()
        and (
          (
            planillas_fecha.tipo = 'eliminatorias'
            and asignacion.apartado = 'eliminatorias'
          )
          or (
            planillas_fecha.tipo = 'clasificatorias'
            and asignacion.apartado in (
              'clasi_a',
              'clasi_b',
              'clasi_c'
            )
          )
        )
    )
  );

revoke all on public.planillas_fecha
  from anon, authenticated;

grant select on public.planillas_fecha
  to authenticated;

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
  if not private.es_organizacion() then
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

revoke all on function public.guardar_planilla_fecha(
  uuid, text, text[], integer
) from public, anon;

grant execute on function public.guardar_planilla_fecha(
  uuid, text, text[], integer
) to authenticated;

notify pgrst, 'reload schema';

commit;