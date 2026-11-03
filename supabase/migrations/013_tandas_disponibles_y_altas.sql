begin;

-- Aplicar después del 012. Sustituye el 013 anterior, que no fue ejecutado.
drop index public.una_tanda_abierta_por_grupo;
drop function public.abrir_tanda_clasificatoria(uuid, integer);
alter table public.tandas_clasificatorias
  alter column estado set default 'en_curso',
  add column participantes_bloqueados boolean not null default false;

-- No reabrir tandas ni clasificatorias finalizadas.
update public.tandas_clasificatorias t
set estado = 'en_curso', version = t.version + 1
from public.grupos_clasificatorias g, public.clasificatorias c, public.fechas f
where t.grupo_id = g.id and g.clasificatoria_id = c.id
  and c.fecha_id = f.id and t.estado = 'pendiente'
  and c.estado = 'en_curso' and f.estado = 'en_curso';

update public.tandas_clasificatorias t
set participantes_bloqueados = true
where t.estado = 'finalizada' or exists (
  select 1 from public.votaciones_clasificatorias v
  where v.tanda_id = t.id and v.estado = 'finalizada'
);

-- La primera planilla finalizada fija los participantes de la tanda.
-- El indicador es visible a los demás jurados, sin revelar sus puntuaciones.
create function private.fijar_participantes_tanda()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.estado = 'finalizada' then
    update public.tandas_clasificatorias
    set participantes_bloqueados = true, version = version + 1
    where id = new.tanda_id and not participantes_bloqueados;
  end if;
  return new;
end;
$$;
revoke all on function private.fijar_participantes_tanda() from public, anon, authenticated;
create trigger fijar_participantes_tanda
  after insert or update of estado on public.votaciones_clasificatorias
  for each row execute function private.fijar_participantes_tanda();

-- Auditoría e idempotencia. No está expuesta por la API y nadie del cliente
-- puede insertar autorizaciones. Las FK diferidas permiten registrar la
-- autorización antes de insertar la inscripción y su tanda en esta transacción.
create table private.altas_clasificatorias (
  solicitud_id uuid primary key,
  inscripcion_id uuid not null unique references public.inscripciones(id)
    deferrable initially deferred,
  fecha_id uuid not null references public.fechas(id),
  grupo_id uuid not null references public.grupos_clasificatorias(id),
  tanda_id uuid not null references public.tandas_clasificatorias(id)
    deferrable initially deferred,
  usuario_id uuid not null references public.perfiles(id),
  solicitud jsonb not null,
  resultado jsonb not null,
  creado_en timestamptz not null default now()
);
alter table private.altas_clasificatorias enable row level security;
revoke all on private.altas_clasificatorias from public, anon, authenticated;

-- Conservar el bloqueo del 004. La única excepción es un INSERT previamente
-- autorizado por la RPC de altas. Nunca permite modificar una inscripción.
create or replace function private.bloquear_inscripcion_con_sorteo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform id from public.fechas where id = new.fecha_id for update;
  if tg_op = 'INSERT' and exists (
    select 1 from private.altas_clasificatorias a
    join public.grupos_clasificatorias g on g.id = a.grupo_id
    join public.clasificatorias c on c.id = g.clasificatoria_id
    join public.fechas f on f.id = c.fecha_id
    join public.jurados_clasificatorias j on j.grupo_id = g.id
      and j.jurado_id = auth.uid()
    where a.inscripcion_id = new.id and a.fecha_id = new.fecha_id
      and c.fecha_id = new.fecha_id and a.usuario_id = auth.uid()
      and c.estado = 'en_curso' and f.estado = 'en_curso'
  ) then
    return new;
  end if;
  if exists (select 1 from public.sorteos where fecha_id = new.fecha_id and vigente) then
    raise exception 'Hay un sorteo vigente. Deshacelo antes de modificar las inscripciones.';
  end if;
  return new;
end;
$$;
revoke all on function private.bloquear_inscripcion_con_sorteo() from public, anon, authenticated;

create function public.agregar_participante_clasi(
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
  if auth.uid() is null or not exists (
    select 1 from public.perfiles where id = auth.uid() and rol = 'jurado'
  ) then
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
  v_nombre := case when v_fecha.integrantes_por_equipo = 1 then v_aliases[1] else trim(p_nombre) end;
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
    if jsonb_array_length(v_tanda.entradas) >= 5 then
      raise exception 'La tanda ya tiene cinco inscripciones. Elegí otra o creá una nueva.';
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
revoke all on function public.agregar_participante_clasi(uuid, uuid, text, text[], uuid)
  from public, anon, authenticated;
grant execute on function public.agregar_participante_clasi(uuid, uuid, text, text[], uuid) to authenticated;

-- Leer participantes y planillas en un mismo snapshot: evita mezclar una
-- tanda anterior al alta con un voto posterior al alta (o a la inversa).
create function public.consultar_tandas_jurado(p_grupo_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_resultado jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.perfiles where id = auth.uid() and rol = 'jurado'
  ) or not exists (
    select 1 from public.jurados_clasificatorias
    where grupo_id = p_grupo_id and jurado_id = auth.uid()
  ) then
    raise exception 'No tenés este grupo asignado.';
  end if;
  select jsonb_build_object(
    'tandas', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.numero)
      from public.tandas_clasificatorias t where t.grupo_id = p_grupo_id
    ), '[]'::jsonb),
    'votos', coalesce((
      select jsonb_agg(to_jsonb(v) order by t.numero)
      from public.votaciones_clasificatorias v
      join public.tandas_clasificatorias t on t.id = v.tanda_id
      where t.grupo_id = p_grupo_id and v.jurado_id = auth.uid()
    ), '[]'::jsonb)
  ) into v_resultado;
  return v_resultado;
end;
$$;
revoke all on function public.consultar_tandas_jurado(uuid) from public, anon, authenticated;
grant execute on function public.consultar_tandas_jurado(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
