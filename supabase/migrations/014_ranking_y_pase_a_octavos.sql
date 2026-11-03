begin;

-- Requiere el paso 013 ya aplicado. No modifica votos ni el sorteo original.
do $$ begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tandas_clasificatorias'
      and column_name = 'participantes_bloqueados') then
    raise exception 'Aplicá primero el paso 013 de tandas y altas.';
  end if;
end $$;

create table public.cierres_clasificatorias (
  clasificatoria_id uuid primary key references public.clasificatorias(id),
  sorteo_id uuid not null unique references public.sorteos(id),
  version_consulta text not null,
  ranking jsonb not null check (jsonb_typeof(ranking) = 'object'),
  clasificados jsonb not null check (jsonb_typeof(clasificados) = 'array'),
  ganadores_desempate uuid[] not null default '{}',
  nota_desempate text,
  cerrado_por uuid not null references public.perfiles(id),
  cerrado_en timestamptz not null default now()
);
alter table public.cierres_clasificatorias enable row level security;
revoke all on public.cierres_clasificatorias from public, anon, authenticated;
grant select on public.cierres_clasificatorias to authenticated;
create policy "Organizacion consulta cierres de clasis"
  on public.cierres_clasificatorias for select to authenticated
  using (private.es_organizacion());

-- Una consulta consistente, independiente del límite de filas de PostgREST.
-- Solo se computan notas de los jurados asignados al comenzar las clasis.
create function private.datos_ranking_clasi(p_clasificatoria_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
with configuracion as (
  select c.*, f.estado as fecha_estado
  from public.clasificatorias c join public.fechas f on f.id = c.fecha_id
  where c.id = p_clasificatoria_id
), grupos as (
  select g.id, g.nombre, count(j.jurado_id)::integer as esperados
  from public.grupos_clasificatorias g
  left join public.jurados_clasificatorias j on j.grupo_id = g.id
  where g.clasificatoria_id = p_clasificatoria_id
  group by g.id, g.nombre
), entradas as (
  select t.id as tanda_id, t.numero, t.estado as tanda_estado,
    g.id as grupo_id, g.nombre as grupo, g.esperados,
    e.value as entrada, e.value ->> 'id' as inscripcion_id
  from grupos g join public.tandas_clasificatorias t on t.grupo_id = g.id
  cross join lateral jsonb_array_elements(t.entradas) e(value)
), detalle as (
  select e.*, j.jurado_id, j.nombre as jurado_nombre,
    v.estado as voto_estado,
    case when v.estado = 'finalizada' and notas.filas = 1
      and notas.valida then notas.total else null end as total_jurado
  from entradas e
  join public.jurados_clasificatorias j on j.grupo_id = e.grupo_id
  left join public.votaciones_clasificatorias v
    on v.tanda_id = e.tanda_id and v.jurado_id = j.jurado_id
  cross join lateral (
    select count(*) as filas,
      bool_and(jsonb_array_length(case when jsonb_typeof(f.value -> 'casillas') = 'array'
        then f.value -> 'casillas' else '[]'::jsonb end) = cardinality(c.casillas)
        and coalesce(p.valida, false)) as valida,
      sum(p.total) as total
    from configuracion c
    cross join lateral jsonb_array_elements(coalesce(v.puntuaciones, '[]'::jsonb)) f(value)
    cross join lateral (
      select sum(case when jsonb_typeof(p.value) = 'number'
          then (p.value #>> '{}')::numeric else null end) as total,
        bool_and(case when jsonb_typeof(p.value) = 'number'
          then (p.value #>> '{}')::numeric between 0 and 4 else false end) as valida
      from jsonb_array_elements(case when jsonb_typeof(f.value -> 'casillas') = 'array'
        then f.value -> 'casillas' else '[]'::jsonb end) p(value)
    ) p
    where f.value ->> 'inscripcion_id' = e.inscripcion_id
  ) notas
), puntuadas as (
  select e.*,
    coalesce(d.finalizados, 0) as jurados_finalizados,
    (e.esperados > 0 and d.finalizados = e.esperados) as completa,
    case when e.esperados > 0 and d.finalizados = e.esperados
      then d.total else null end as puntos,
    coalesce(d.detalle_jurados, '[]'::jsonb) as detalle_jurados
  from entradas e
  left join lateral (
    select count(*) filter (where total_jurado is not null)::integer as finalizados,
      sum(total_jurado) as total,
      jsonb_agg(jsonb_build_object('jurado_id', jurado_id,
        'nombre', jurado_nombre, 'estado', coalesce(voto_estado, 'sin_guardar'),
        'total', total_jurado) order by jurado_nombre, jurado_id) as detalle_jurados
    from detalle d where d.inscripcion_id = e.inscripcion_id and d.tanda_id = e.tanda_id
  ) d on true
), ordenadas as (
  select p.*, case when completa then rank() over (
    order by completa desc, puntos desc nulls last)::integer else null end as puesto
  from puntuadas p
), resumen as (
  select count(*)::integer as total,
    count(distinct inscripcion_id)::integer as distintos,
    count(*) filter (where completa)::integer as completos
  from ordenadas
), disponibilidad as (
  select r.*, c.clasifican,
    ((select count(*) from grupos) between 1 and 3
      and (select min(esperados) > 0 and min(esperados) = max(esperados) from grupos)
      and r.total = r.distintos and r.total >= c.clasifican
      and r.total = r.completos and r.total > 0
      and not exists (select 1 from entradas where tanda_estado <> 'finalizada')) as lista
  from resumen r cross join configuracion c
), punto_corte as (
  select o.puntos from ordenadas o cross join disponibilidad d
  where d.lista order by o.puntos desc, o.inscripcion_id
  offset (select greatest(clasifican - 1, 0) from configuracion) limit 1
), corte as (
  select (select puntos from punto_corte) as puntos,
    coalesce((select jsonb_agg(inscripcion_id order by inscripcion_id) from ordenadas
      where puntos > (select puntos from punto_corte)), '[]'::jsonb) as directos,
    coalesce((select jsonb_agg(inscripcion_id order by inscripcion_id) from ordenadas
      where puntos = (select puntos from punto_corte)), '[]'::jsonb) as empatados
)
select jsonb_build_object(
  'clasificatoria_id', c.id, 'fecha_id', c.fecha_id, 'estado', c.estado,
  'fecha_estado', c.fecha_estado, 'clasifican', c.clasifican,
  'casillas', c.casillas, 'total', d.total, 'completos', d.completos,
  'lista_para_cerrar', coalesce(d.lista, false),
  'jurados_consistentes', coalesce((select min(esperados) > 0
    and min(esperados) = max(esperados) from grupos), false),
  'tandas_total', (select count(*) from public.tandas_clasificatorias t
    join grupos g on g.id = t.grupo_id),
  'tandas_finalizadas', (select count(*) from public.tandas_clasificatorias t
    join grupos g on g.id = t.grupo_id where t.estado = 'finalizada'),
  'filas', coalesce((select jsonb_agg(jsonb_build_object(
    'inscripcion_id', o.inscripcion_id, 'entrada', o.entrada,
    'grupo', o.grupo, 'tanda', o.numero, 'puesto', o.puesto,
    'completa', o.completa, 'puntos', o.puntos,
    'jurados_esperados', o.esperados, 'jurados_finalizados', o.jurados_finalizados,
    'detalle_jurados', o.detalle_jurados)
    order by o.completa desc, o.puntos desc nulls last,
      o.entrada ->> 'nombre', o.inscripcion_id) from ordenadas o), '[]'::jsonb),
  'corte', jsonb_build_object('puntos', k.puntos, 'directos', k.directos,
    'empatados', k.empatados, 'cupos', c.clasifican - jsonb_array_length(k.directos),
    'requiere_desempate', coalesce(d.lista, false)
      and jsonb_array_length(k.empatados) > c.clasifican - jsonb_array_length(k.directos)),
  'version', md5(jsonb_build_object('configuracion', to_jsonb(c),
    'grupos', (select jsonb_agg(to_jsonb(g) order by g.id) from grupos g),
    'jurados', (select jsonb_agg(to_jsonb(j) order by j.grupo_id, j.jurado_id)
      from public.jurados_clasificatorias j join grupos g on g.id = j.grupo_id),
    'tandas', (select jsonb_agg(to_jsonb(t) order by t.id)
      from public.tandas_clasificatorias t join grupos g on g.id = t.grupo_id),
    'votos', (select jsonb_agg(to_jsonb(v) order by v.id)
      from public.votaciones_clasificatorias v
      join public.tandas_clasificatorias t on t.id = v.tanda_id
      join grupos g on g.id = t.grupo_id))::text)
)
from configuracion c cross join disponibilidad d cross join corte k;
$$;
revoke all on function private.datos_ranking_clasi(uuid) from public, anon, authenticated;

create function public.consultar_ranking_clasificatoria(p_clasificatoria_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ranking jsonb; v_cierre public.cierres_clasificatorias%rowtype;
begin
  if not private.es_organizacion() then
    raise exception 'No tenés permiso para consultar la tabla global.';
  end if;
  select * into v_cierre from public.cierres_clasificatorias
    where clasificatoria_id = p_clasificatoria_id;
  if found then
    return v_cierre.ranking || jsonb_build_object('estado', 'finalizada',
      'cierre', jsonb_build_object('clasificados', v_cierre.clasificados,
        'ganadores_desempate', v_cierre.ganadores_desempate,
        'nota_desempate', v_cierre.nota_desempate, 'cerrado_en', v_cierre.cerrado_en));
  end if;
  v_ranking := private.datos_ranking_clasi(p_clasificatoria_id);
  if v_ranking is null then raise exception 'La clasificatoria no existe.'; end if;
  return v_ranking || jsonb_build_object('cierre', null);
end;
$$;
revoke all on function public.consultar_ranking_clasificatoria(uuid) from public, anon, authenticated;
grant execute on function public.consultar_ranking_clasificatoria(uuid) to authenticated;

create function public.cerrar_clasificatorias_y_sortear_octavos(
  p_clasificatoria_id uuid,
  p_version text,
  p_ganadores_desempate uuid[] default '{}',
  p_nota_desempate text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_fecha_id uuid; v_fecha public.fechas%rowtype;
  v_clasi public.clasificatorias%rowtype;
  v_cierre public.cierres_clasificatorias%rowtype;
  v_ranking jsonb; v_corte jsonb;
  v_seleccion uuid[]; v_guardados uuid[]; v_ids uuid[];
  v_nota text := nullif(trim(p_nota_desempate), '');
  v_clasificados jsonb; v_aleatorios jsonb; v_entradas jsonb;
  v_tamanios integer[] := array_fill(0, array[8]);
  v_orden integer[] := array[1,5,3,7,2,6,4,8];
  v_pos integer; v_cursor integer := 0; v_fase text; v_cantidad integer;
  i integer; j integer;
begin
  if not private.es_organizacion() then
    raise exception 'No tenés permiso para cerrar clasificatorias.';
  end if;
  select fecha_id into v_fecha_id from public.clasificatorias where id = p_clasificatoria_id;
  if not found then raise exception 'La clasificatoria no existe.'; end if;
  select * into v_fecha from public.fechas where id = v_fecha_id for update;
  select * into v_clasi from public.clasificatorias where id = p_clasificatoria_id for update;
  if p_ganadores_desempate is null or cardinality(p_ganadores_desempate) > 28
    or (cardinality(p_ganadores_desempate) > 0 and array_ndims(p_ganadores_desempate) <> 1)
    or array_position(p_ganadores_desempate, null) is not null then
    raise exception 'La selección del desempate no es válida.';
  end if;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_seleccion
    from unnest(p_ganadores_desempate) d(id);
  if cardinality(v_seleccion) <> (select count(distinct id) from unnest(v_seleccion) d(id)) then
    raise exception 'No podés repetir un participante del desempate.';
  end if;
  select * into v_cierre from public.cierres_clasificatorias where clasificatoria_id = v_clasi.id;
  if found then
    select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_guardados
      from unnest(v_cierre.ganadores_desempate) d(id);
    if p_version = v_cierre.version_consulta and v_seleccion = v_guardados
      and v_nota is not distinct from v_cierre.nota_desempate then
      return v_cierre.sorteo_id;
    end if;
    raise exception 'Las clasis ya fueron cerradas. Actualizá para ver el resultado guardado.';
  end if;
  if v_fecha.estado <> 'en_curso' or v_clasi.estado <> 'en_curso' then
    raise exception 'Las clasificatorias no están en curso.';
  end if;
  if not exists (select 1 from public.sorteos where id = v_clasi.sorteo_id and vigente) then
    raise exception 'El sorteo de esta clasificatoria ya no está vigente.';
  end if;
  if exists (select 1 from public.cruces_eliminatorias where sorteo_id = v_clasi.sorteo_id) then
    raise exception 'Esta fecha ya tiene cruces de eliminatorias. No se modificarán.';
  end if;
  if v_clasi.clasifican not between 2 and 28 then
    raise exception 'El cupo actual debe estar entre 2 y 28 para armar ocho cruces.';
  end if;
  v_ranking := private.datos_ranking_clasi(v_clasi.id);
  if p_version is null or p_version is distinct from v_ranking ->> 'version' then
    raise exception 'La tabla cambió. Actualizá y revisá los resultados antes de cerrar.';
  end if;
  if not (v_ranking ->> 'lista_para_cerrar')::boolean then
    raise exception 'Faltan planillas o tandas por finalizar, o la configuración de los grupos no es válida.';
  end if;
  v_corte := v_ranking -> 'corte';
  if (v_corte ->> 'requiere_desempate')::boolean then
    if cardinality(v_seleccion) <> (v_corte ->> 'cupos')::integer then
      raise exception 'Seleccioná exactamente los % ganadores del repechaje.', v_corte ->> 'cupos';
    end if;
    if exists (select 1 from unnest(v_seleccion) d(id)
      where not (v_corte -> 'empatados') ? id::text) then
      raise exception 'Solo podés elegir participantes empatados en el corte.';
    end if;
    if v_nota is null then raise exception 'Dejá una nota breve sobre el repechaje.'; end if;
  elsif cardinality(v_seleccion) <> 0 or v_nota is not null then
    raise exception 'Esta tabla no requiere desempate en el corte.';
  end if;
  select coalesce(array_agg(id::uuid), '{}'::uuid[]) into v_ids
  from jsonb_array_elements_text(v_corte -> 'directos') d(id);
  if (v_corte ->> 'requiere_desempate')::boolean then
    v_ids := v_ids || v_seleccion;
  else
    select v_ids || coalesce(array_agg(id::uuid), '{}'::uuid[]) into v_ids
      from jsonb_array_elements_text(v_corte -> 'empatados') d(id);
  end if;
  if cardinality(v_ids) <> v_clasi.clasifican then
    raise exception 'La cantidad de clasificados no coincide con los cupos.';
  end if;
  select jsonb_agg(f.value -> 'entrada' order by (f.value ->> 'puesto')::integer,
    f.value ->> 'inscripcion_id') into v_clasificados
  from jsonb_array_elements(v_ranking -> 'filas') f(value)
  where (f.value ->> 'inscripcion_id')::uuid = any(v_ids);
  select jsonb_agg(e.value order by random()) into v_aleatorios
    from jsonb_array_elements(v_clasificados) e(value);
  for i in 1..least(v_clasi.clasifican,16) loop
    v_pos := v_orden[((i - 1) % 8) + 1];
    v_tamanios[v_pos] := v_tamanios[v_pos] + 1;
  end loop;
  if v_clasi.clasifican > 16 then
    for i in 17..v_clasi.clasifican loop
      v_pos := v_orden[((i - 17) % 8) + 1];
      v_tamanios[v_pos] := v_tamanios[v_pos] + 1;
    end loop;
  end if;
  for i in 1..8 loop
    v_entradas := '[]'::jsonb;
    if v_tamanios[i] > 0 then
      for j in 1..v_tamanios[i] loop
        v_entradas := v_entradas || jsonb_build_array(v_aleatorios -> v_cursor);
        v_cursor := v_cursor + 1;
      end loop;
    end if;
    insert into public.cruces_eliminatorias(fecha_id, sorteo_id, fase, numero, entradas)
    values (v_fecha_id, v_clasi.sorteo_id, 'octavos', i, v_entradas);
  end loop;
  foreach v_fase in array array['cuartos','semifinal','final'] loop
    v_cantidad := case v_fase when 'cuartos' then 4 when 'semifinal' then 2 else 1 end;
    for i in 1..v_cantidad loop
      insert into public.cruces_eliminatorias(fecha_id, sorteo_id, fase, numero)
      values (v_fecha_id, v_clasi.sorteo_id, v_fase, i);
    end loop;
  end loop;
  -- Este nuevo cuadro mantiene cuartos y semifinal aleatorios.
  update public.sorteos set eliminatorias_aleatorias = true where id = v_clasi.sorteo_id;
  perform private.actualizar_llaves(v_clasi.sorteo_id);
  insert into public.cierres_clasificatorias(clasificatoria_id, sorteo_id,
    version_consulta, ranking, clasificados, ganadores_desempate, nota_desempate, cerrado_por)
  values (v_clasi.id, v_clasi.sorteo_id, p_version, v_ranking,
    v_clasificados, v_seleccion, v_nota, auth.uid());
  update public.clasificatorias set estado = 'finalizada', finalizado_en = now() where id = v_clasi.id;
  return v_clasi.sorteo_id;
end;
$$;
revoke all on function public.cerrar_clasificatorias_y_sortear_octavos(uuid,text,uuid[],text)
  from public, anon, authenticated;
grant execute on function public.cerrar_clasificatorias_y_sortear_octavos(uuid,text,uuid[],text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
