begin;
-- Generado por scripts/generar-ranking-correctivo.mjs.
create or replace function private.datos_ranking_clasi(p_clasificatoria_id uuid)
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
          then (p.value #>> '{}')::numeric between 0 and 4 else jsonb_typeof(p.value) = 'null' end) as valida
      from jsonb_array_elements(case when jsonb_typeof(f.value -> 'casillas') = 'array'
        then f.value -> 'casillas' else '[]'::jsonb end) p(value)
    ) p
    where f.value ->> 'inscripcion_id' = e.inscripcion_id
  ) notas
), puntuadas as (
  select e.*,
    coalesce(d.entregados, 0) as jurados_finalizados,
    (e.esperados > 0 and d.entregados = e.esperados) as completa,
    case when e.esperados > 0 and d.entregados = e.esperados
      then d.total else null end as puntos,
    coalesce(d.detalle_jurados, '[]'::jsonb) as detalle_jurados
  from entradas e
  left join lateral (
    select count(*) filter (where total_jurado is not null)::integer as finalizados,
      sum(total_jurado) as total,
      count(*) filter(where voto_estado='finalizada')::integer as entregados,
      jsonb_agg(jsonb_build_object('jurado_id', jurado_id,
        'nombre', jurado_nombre, 'estado', coalesce(voto_estado, 'sin_guardar'),
        'total', total_jurado) order by jurado_nombre, jurado_id) as detalle_jurados
    from detalle d where d.inscripcion_id = e.inscripcion_id and d.tanda_id = e.tanda_id
  ) d on true
), ordenadas as (
  select p.*, case when completa and puntos is not null then rank() over (
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
      and r.total = r.distintos
      and r.total = r.completos and r.total > 0
      and not exists (select 1 from entradas where tanda_estado <> 'finalizada')) as lista
  from resumen r cross join configuracion c
), punto_corte as (
  select o.puntos from ordenadas o cross join disponibilidad d
  where d.lista and o.puntos is not null order by o.puntos desc, o.inscripcion_id
  offset (select greatest(least(c.clasifican,(select count(*) from ordenadas where puntos is not null)) - 1,0) from configuracion c) limit 1
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
  'fase_inicial', coalesce((select fase_inicial from public.fechas where id=c.fecha_id),'octavos'),
  'efectivos',least(c.clasifican,(select count(*) from ordenadas where puntos is not null)),
  'puntuados',(select count(*) from ordenadas where puntos is not null),
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
    'sin_puntuar',o.completa and o.puntos is null,
    'casillas_vacias',exists(select 1 from public.votaciones_clasificatorias v
      cross join lateral jsonb_array_elements(v.puntuaciones) f
      cross join lateral jsonb_array_elements(f->'casillas') p
      where v.tanda_id=o.tanda_id and v.estado='finalizada' and f->>'inscripcion_id'=o.inscripcion_id and p='null'::jsonb),
    'jurados_esperados', o.esperados, 'jurados_finalizados', o.jurados_finalizados,
    'detalle_jurados', o.detalle_jurados)
    order by o.completa desc, o.puntos desc nulls last,
      o.entrada ->> 'nombre', o.inscripcion_id) from ordenadas o), '[]'::jsonb),
  'corte', jsonb_build_object('puntos', k.puntos, 'directos', k.directos,
    'empatados', k.empatados, 'cupos', least(c.clasifican,(select count(*) from ordenadas where puntos is not null)) - jsonb_array_length(k.directos),
    'requiere_desempate', coalesce(d.lista, false)
      and jsonb_array_length(k.empatados) > least(c.clasifican,(select count(*) from ordenadas where puntos is not null)) - jsonb_array_length(k.directos)),
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
create or replace function public.cerrar_clasificatorias_y_sortear_octavos(
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
  if not private.exigir_organizacion_fecha(private.fecha_recurso('clasi',p_clasificatoria_id)) then
    raise exception 'No tenés permiso para cerrar clasificatorias.';
  end if;
  select fecha_id into v_fecha_id from public.clasificatorias where id = p_clasificatoria_id;
  if not found then raise exception 'La clasificatoria no existe.'; end if;
  select * into v_fecha from public.fechas where id = v_fecha_id for update;
  select * into v_clasi from public.clasificatorias where id = p_clasificatoria_id for update;
  if p_ganadores_desempate is null or cardinality(p_ganadores_desempate) > 64
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
  if cardinality(v_ids) <> (v_ranking->>'efectivos')::integer then
    raise exception 'La cantidad de clasificados no coincide con los cupos.';
  end if;
  select jsonb_agg(f.value -> 'entrada' order by (f.value ->> 'puesto')::integer,
    f.value ->> 'inscripcion_id') into v_clasificados
  from jsonb_array_elements(v_ranking -> 'filas') f(value)
  where (f.value ->> 'inscripcion_id')::uuid = any(v_ids);
  select jsonb_agg(e.value order by random()) into v_aleatorios
    from jsonb_array_elements(v_clasificados) e(value);
  if cardinality(v_ids)<2 then raise exception 'Se necesitan al menos dos inscripciones puntuadas para iniciar eliminatorias.';end if;
  perform private.crear_cuadro(v_clasi.sorteo_id,v_aleatorios);
  insert into public.cierres_clasificatorias(clasificatoria_id, sorteo_id,
    version_consulta, ranking, clasificados, ganadores_desempate, nota_desempate, cerrado_por)
  values (v_clasi.id, v_clasi.sorteo_id, p_version, v_ranking,
    v_clasificados, v_seleccion, v_nota, auth.uid());
  update public.clasificatorias set estado = 'finalizada', finalizado_en = now() where id = v_clasi.id;
  return v_clasi.sorteo_id;
end;
$$;
commit;
