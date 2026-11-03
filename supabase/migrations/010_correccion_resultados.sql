begin;

create table public.historial_resultados_eliminatorias (
  id uuid primary key default gen_random_uuid(),

  cruce_id uuid not null
    references public.cruces_eliminatorias(id),

  fecha_id uuid not null
    references public.fechas(id),

  accion text not null
    check (
      accion in (
        'registro_inicial',
        'confirmacion',
        'anulacion'
      )
    ),

  antes jsonb,
  despues jsonb not null,

  realizado_por uuid
    references public.perfiles(id),

  creado_en timestamptz not null default now()
);

create index historial_resultados_cruce_idx
  on public.historial_resultados_eliminatorias(cruce_id, creado_en);

alter table public.historial_resultados_eliminatorias
  enable row level security;

create policy "Organizacion consulta historial de resultados"
  on public.historial_resultados_eliminatorias
  for select
  to authenticated
  using (private.es_organizacion());

revoke all on public.historial_resultados_eliminatorias
  from anon, authenticated;

grant select on public.historial_resultados_eliminatorias
  to authenticated;

-- Conservamos los resultados manuales existentes.
insert into public.historial_resultados_eliminatorias (
  cruce_id,
  fecha_id,
  accion,
  despues,
  realizado_por
)
select
  cruce.id,
  cruce.fecha_id,
  'registro_inicial',
  to_jsonb(cruce),
  cruce.confirmado_por
from public.cruces_eliminatorias as cruce
where cruce.estado = 'resuelto'
  and cruce.resolucion = 'manual';


-- =========================================================
-- HISTORIAL DE NUEVAS CONFIRMACIONES
-- =========================================================

create or replace function private.registrar_confirmacion_cruce()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado = 'resuelto'
    and new.resolucion = 'manual'
    and (
      old.ganador_id is distinct from new.ganador_id
      or old.resolucion is distinct from new.resolucion
      or old.estado is distinct from new.estado
    )
  then
    insert into public.historial_resultados_eliminatorias (
      cruce_id,
      fecha_id,
      accion,
      antes,
      despues,
      realizado_por
    )
    values (
      new.id,
      new.fecha_id,
      'confirmacion',
      to_jsonb(old),
      to_jsonb(new),
      auth.uid()
    );
  end if;

  return new;
end;
$$;

revoke all on function private.registrar_confirmacion_cruce()
  from public, anon, authenticated;

create trigger registrar_confirmacion_cruce
after update on public.cruces_eliminatorias
for each row
execute function private.registrar_confirmacion_cruce();


-- =========================================================
-- DESHACER UN RESULTADO
-- =========================================================

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
  if not private.es_organizacion() then
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

revoke all on function public.deshacer_resultado_cruce(
  uuid, integer
) from public, anon;

grant execute on function public.deshacer_resultado_cruce(
  uuid, integer
) to authenticated;

notify pgrst, 'reload schema';

commit;