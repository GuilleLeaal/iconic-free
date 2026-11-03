begin;

-- Aplicar después del 014. No modifica inscripciones ni sorteos históricos.
alter table public.tandas_clasificatorias
  add column retirados jsonb not null default '[]'::jsonb
    check (jsonb_typeof(retirados) = 'array');
alter table public.tandas_clasificatorias
  drop constraint tandas_clasificatorias_entradas_check;
alter table public.tandas_clasificatorias
  add constraint tandas_clasificatorias_entradas_check check (
    jsonb_typeof(entradas) = 'array'
    and jsonb_array_length(entradas) between 0 and 5
    and (jsonb_array_length(entradas) > 0 or estado = 'finalizada')
  );

-- Conserva también las puntuaciones retiradas, sin exponer votos a otros jurados.
create table private.retiros_clasificatorias (
  tanda_id uuid not null references public.tandas_clasificatorias(id),
  inscripcion_id uuid not null references public.inscripciones(id),
  usuario_id uuid not null references public.perfiles(id),
  entrada jsonb not null,
  votos_anteriores jsonb not null,
  motivo text not null default 'ausencia' check (motivo = 'ausencia'),
  creado_en timestamptz not null default now(),
  primary key (tanda_id, inscripcion_id)
);
alter table private.retiros_clasificatorias enable row level security;
revoke all on private.retiros_clasificatorias from public, anon, authenticated;

create function public.retirar_participante_clasi(
  p_tanda_id uuid, p_inscripcion_id uuid, p_version integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_fecha_id uuid;
  v_clasi_id uuid;
  v_grupo_id uuid;
  v_fecha public.fechas%rowtype;
  v_clasi public.clasificatorias%rowtype;
  v_tanda public.tandas_clasificatorias%rowtype;
  v_entrada jsonb;
  v_restantes jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.perfiles where id = auth.uid() and rol = 'jurado'
  ) then raise exception 'Iniciá sesión con tu cuenta de jurado.'; end if;

  select c.fecha_id, c.id, g.id into v_fecha_id, v_clasi_id, v_grupo_id
  from public.tandas_clasificatorias t
  join public.grupos_clasificatorias g on g.id = t.grupo_id
  join public.clasificatorias c on c.id = g.clasificatoria_id
  where t.id = p_tanda_id;
  if not found then raise exception 'La tanda no existe.'; end if;
  if not exists (select 1 from public.jurados_clasificatorias
    where grupo_id = v_grupo_id and jurado_id = auth.uid()) then
    raise exception 'No tenés este grupo asignado.';
  end if;

  -- Mismo orden de bloqueo que altas, votos y cierre. Evita carreras entre ellos.
  select * into v_fecha from public.fechas where id = v_fecha_id for update;
  select * into v_clasi from public.clasificatorias where id = v_clasi_id for update;
  select * into v_tanda from public.tandas_clasificatorias where id = p_tanda_id for update;

  -- Un reintento, incluso desde otro jurado del grupo, no repite el retiro.
  if exists (select 1 from private.retiros_clasificatorias
    where tanda_id = p_tanda_id and inscripcion_id = p_inscripcion_id) then return; end if;
  if v_fecha.estado <> 'en_curso' or v_clasi.estado <> 'en_curso' then
    raise exception 'Las clasificatorias no están en curso.';
  end if;
  if v_tanda.estado <> 'en_curso' or v_tanda.participantes_bloqueados or exists (
    select 1 from public.votaciones_clasificatorias
    where tanda_id = p_tanda_id and estado = 'finalizada'
  ) then
    raise exception 'No se puede retirar: ya se finalizó una planilla en esta tanda.';
  end if;
  if p_version is null or p_version <> v_tanda.version then
    raise exception 'La tanda cambió. Actualizá antes de retirar al participante.';
  end if;
  select e.value into v_entrada from jsonb_array_elements(v_tanda.entradas) e(value)
    where e.value ->> 'id' = p_inscripcion_id::text;
  if not found then raise exception 'El participante no pertenece a esta tanda.'; end if;

  insert into private.retiros_clasificatorias
    (tanda_id, inscripcion_id, usuario_id, entrada, votos_anteriores)
  values (p_tanda_id, p_inscripcion_id, auth.uid(), v_entrada,
    coalesce((select jsonb_agg(to_jsonb(v) order by v.id)
      from public.votaciones_clasificatorias v where v.tanda_id = p_tanda_id), '[]'::jsonb));

  select coalesce(jsonb_agg(e.value order by e.pos), '[]'::jsonb) into v_restantes
  from jsonb_array_elements(v_tanda.entradas) with ordinality e(value, pos)
  where e.value ->> 'id' <> p_inscripcion_id::text;

  update public.tandas_clasificatorias
  set entradas = v_restantes,
    retirados = retirados || jsonb_build_array(v_entrada),
    estado = case when jsonb_array_length(v_restantes) = 0 then 'finalizada' else estado end,
    participantes_bloqueados = jsonb_array_length(v_restantes) = 0,
    version = version + 1
  where id = p_tanda_id;

  -- Los borradores conservan exactamente las otras filas y su orden.
  update public.votaciones_clasificatorias v
  set puntuaciones = coalesce((
      select jsonb_agg(f.value order by f.pos)
      from jsonb_array_elements(v.puntuaciones) with ordinality f(value, pos)
      where f.value ->> 'inscripcion_id' <> p_inscripcion_id::text
    ), '[]'::jsonb), version = version + 1, actualizado_en = now()
  where v.tanda_id = p_tanda_id and v.estado = 'borrador';
end;
$$;
revoke all on function public.retirar_participante_clasi(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.retirar_participante_clasi(uuid, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
