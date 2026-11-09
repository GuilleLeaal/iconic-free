begin;

-- Los datos históricos conservan el sorteo y el circuito de votación existente.
alter table public.fechas add column armado_clasis text not null default 'sorteo'
  check (armado_clasis in ('sorteo', 'manual'));
grant insert(armado_clasis) on public.fechas to authenticated;

create table public.armados_clasificatorias (
  fecha_id uuid primary key references public.fechas(id) on delete cascade,
  version integer not null check (version > 0),
  grupos jsonb not null check (jsonb_typeof(grupos) = 'array'),
  actualizado_por uuid references public.perfiles(id) on delete set null,
  actualizado_en timestamptz not null default now()
);
alter table public.armados_clasificatorias enable row level security;
revoke all on public.armados_clasificatorias from public, anon, authenticated;
grant select on public.armados_clasificatorias to authenticated;
create policy consultar_armado on public.armados_clasificatorias for select to authenticated
  using (private.organiza_fecha(fecha_id));

create function private.exigir_armado_editable(p_fecha_id uuid, p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; actual integer;
begin
  perform private.exigir_organizacion_fecha(p_fecha_id);
  select * into f from public.fechas where id = p_fecha_id for update;
  if f.armado_clasis <> 'manual' or f.estado not in ('borrador', 'inscripciones') then
    raise exception 'Esta fecha no admite editar el armado manual.';
  end if;
  if exists (select 1 from public.sorteos where fecha_id = f.id and vigente) then
    raise exception 'Las clasificatorias ya están preparadas. Actualizá la pantalla.';
  end if;
  select coalesce((select version from public.armados_clasificatorias where fecha_id = f.id), 0) into actual;
  if p_version is distinct from actual then
    raise exception 'El armado cambió en otro dispositivo. Actualizá antes de continuar.';
  end if;
end;
$$;

create function private.validar_armado_clasificatorias(p_fecha_id uuid, p_grupos jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; g jsonb; t jsonb; lugar jsonb; n integer := 0;
  ids uuid[] := '{}'; rondas uuid[] := '{}'; id_ uuid;
begin
  select * into f from public.fechas where id = p_fecha_id;
  if jsonb_typeof(p_grupos) is distinct from 'array' then raise exception 'El armado no es válido.'; end if;
  if jsonb_array_length(p_grupos) > 3 then raise exception 'Podés agregar hasta tres clasis: A, B y C.'; end if;
  for g in select value from jsonb_array_elements(p_grupos) loop
    n := n + 1;
    if g->>'nombre' is distinct from chr(64+n) or jsonb_typeof(g->'tandas') is distinct from 'array' then
      raise exception 'Los grupos deben conservar el orden A, B y C.';
    end if;
    for t in select value from jsonb_array_elements(g->'tandas') loop
      id_ := (t->>'id')::uuid;
      if id_ is null or id_ = any(rondas) then raise exception 'Las rondas no son válidas.'; end if;
      rondas := array_append(rondas, id_);
      if jsonb_typeof(t->'posiciones') is distinct from 'array' then raise exception 'Los lugares de la ronda no son válidos.'; end if;
      if jsonb_array_length(t->'posiciones') <> f.maximo_tanda then raise exception 'La ronda debe respetar el máximo configurado.'; end if;
      for lugar in select value from jsonb_array_elements(t->'posiciones') loop
        if lugar = 'null'::jsonb then continue; end if;
        if jsonb_typeof(lugar) <> 'string' then raise exception 'La inscripción no es válida.'; end if;
        id_ := (lugar #>> '{}')::uuid;
        if id_ = any(ids) then raise exception 'Un participante no puede ocupar dos lugares.'; end if;
        if not exists (select 1 from public.inscripciones where id = id_ and fecha_id = f.id and activa) then
          raise exception 'Solo podés ubicar inscripciones activas de esta fecha.';
        end if;
        ids := array_append(ids, id_);
      end loop;
    end loop;
  end loop;
  if exists (select 1 from public.inscripciones where fecha_id = f.id and activa and not (id = any(ids))) then
    raise exception 'Cada inscripción activa debe tener un lugar en una ronda.';
  end if;
end;
$$;

create function public.guardar_armado_clasificatorias(p_fecha_id uuid, p_version integer, p_grupos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.armados_clasificatorias%rowtype;
begin
  perform private.exigir_armado_editable(p_fecha_id, p_version);
  perform private.validar_armado_clasificatorias(p_fecha_id, p_grupos);
  insert into public.armados_clasificatorias(fecha_id, version, grupos, actualizado_por)
    values (p_fecha_id, p_version+1, p_grupos, auth.uid())
    on conflict (fecha_id) do update set version = excluded.version, grupos = excluded.grupos,
      actualizado_por = auth.uid(), actualizado_en = now() returning * into a;
  return to_jsonb(a);
end;
$$;

create function public.inscribir_en_ronda(p_fecha_id uuid, p_version integer, p_tanda_id uuid,
  p_posicion integer, p_nombre text, p_integrantes text[], p_inscripcion_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare grupos jsonb; ruta text[]; id_ uuid; i public.inscripciones%rowtype;
begin
  perform private.exigir_armado_editable(p_fecha_id, p_version);
  select a.grupos into grupos from public.armados_clasificatorias a where fecha_id = p_fecha_id;
  select array[(g.n-1)::text, 'tandas', (t.n-1)::text, 'posiciones', (p_posicion-1)::text] into ruta
    from jsonb_array_elements(grupos) with ordinality g(v,n)
    cross join lateral jsonb_array_elements(g.v->'tandas') with ordinality t(v,n)
    where t.v->>'id' = p_tanda_id::text
      and p_posicion between 1 and jsonb_array_length(t.v->'posiciones');
  if ruta is null then raise exception 'El lugar de la ronda no existe.'; end if;
  if grupos #> ruta <> 'null'::jsonb then raise exception 'Este lugar ya está ocupado. Actualizá la pantalla.'; end if;
  if p_inscripcion_id is null then
    id_ := private.crear_inscripcion_sin_armado(p_fecha_id, p_nombre, p_integrantes);
  else
    select * into i from public.inscripciones where id = p_inscripcion_id and fecha_id = p_fecha_id;
    if not found or i.activa then raise exception 'Solo podés reincorporar una inscripción retirada de esta fecha.'; end if;
    -- La reactivación también se completa dentro de la ronda, en esta transacción.
    id_ := private.modificar_inscripcion_sin_armado(i.id, i.version, 'reactivar', null, null);
  end if;
  grupos := jsonb_set(grupos, ruta, to_jsonb(id_));
  return public.guardar_armado_clasificatorias(p_fecha_id, p_version, grupos);
end;
$$;

-- Conservar validaciones, duplicados, versiones e historial del alta existente.
alter function public.crear_inscripcion(uuid,text,text[]) rename to crear_inscripcion_sin_armado;
alter function public.crear_inscripcion_sin_armado(uuid,text,text[]) set schema private;
revoke all on function private.crear_inscripcion_sin_armado(uuid,text,text[]) from public,anon,authenticated;
create function public.crear_inscripcion(p_fecha_id uuid, p_nombre text, p_integrantes text[])
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_organizacion_fecha(p_fecha_id);
  perform id from public.fechas where id = p_fecha_id for update;
  if (select armado_clasis from public.fechas where id = p_fecha_id) = 'manual' then
    raise exception 'En clasis manuales inscribí al participante desde un lugar de una ronda.';
  end if;
  return private.crear_inscripcion_sin_armado(p_fecha_id, p_nombre, p_integrantes);
end;
$$;
revoke all on function public.crear_inscripcion(uuid,text,text[]) from public,anon;
grant execute on function public.crear_inscripcion(uuid,text,text[]) to authenticated;

alter function public.modificar_inscripcion(uuid,integer,text,text,text[]) set schema private;
alter function private.modificar_inscripcion(uuid,integer,text,text,text[]) rename to modificar_inscripcion_sin_armado;
revoke all on function private.modificar_inscripcion_sin_armado(uuid,integer,text,text,text[]) from public,anon,authenticated;
create function public.modificar_inscripcion(p_id uuid, p_version integer, p_accion text,
  p_nombre text default null, p_integrantes text[] default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; a public.armados_clasificatorias%rowtype; grupos jsonb;
begin
  perform private.exigir_organizacion_fecha(private.fecha_recurso('inscripcion', p_id));
  select f1.* into f from public.fechas f1 join public.inscripciones i on i.fecha_id = f1.id where i.id = p_id for update of f1;
  if f.armado_clasis = 'manual' and p_accion = 'reactivar' then raise exception 'Reincorporá al participante desde un lugar de una ronda.'; end if;
  perform private.modificar_inscripcion_sin_armado(p_id, p_version, p_accion, p_nombre, p_integrantes);
  if f.armado_clasis = 'manual' and p_accion = 'retirar' then
    select * into a from public.armados_clasificatorias where fecha_id = f.id;
    select jsonb_agg(jsonb_set(g.v, '{tandas}', coalesce((select jsonb_agg(jsonb_set(t.v, '{posiciones}',
      (select jsonb_agg(case when p.v = to_jsonb(p_id) then 'null'::jsonb else p.v end order by p.n)
       from jsonb_array_elements(t.v->'posiciones') with ordinality p(v,n))) order by t.n)
      from jsonb_array_elements(g.v->'tandas') with ordinality t(v,n)), '[]'::jsonb)) order by g.n)
      into grupos from jsonb_array_elements(a.grupos) with ordinality g(v,n);
    perform public.guardar_armado_clasificatorias(f.id, a.version, grupos);
  end if;
  return p_id;
end;
$$;
revoke all on function public.modificar_inscripcion(uuid,integer,text,text,text[]) from public,anon;
grant execute on function public.modificar_inscripcion(uuid,integer,text,text,text[]) to authenticated;

alter function public.generar_sorteo(uuid) set schema private;
alter function private.generar_sorteo(uuid) rename to generar_sorteo_automatico;
revoke all on function private.generar_sorteo_automatico(uuid) from public,anon,authenticated;
create function public.generar_sorteo(p_fecha_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; s public.sorteos%rowtype; a public.armados_clasificatorias%rowtype;
  gs jsonb := '[]'; ts jsonb; entradas jsonb; g jsonb; t record; n integer; total integer := 0;
begin
  perform private.exigir_organizacion_fecha(p_fecha_id);
  select * into f from public.fechas where id = p_fecha_id for update;
  if f.armado_clasis = 'sorteo' then return private.generar_sorteo_automatico(f.id); end if;
  select * into s from public.sorteos where fecha_id = f.id and vigente;
  if found then return to_jsonb(s); end if;
  if f.estado not in ('borrador', 'inscripciones') then raise exception 'La fecha ya comenzó.'; end if;
  select * into a from public.armados_clasificatorias where fecha_id = f.id;
  perform private.validar_armado_clasificatorias(f.id, coalesce(a.grupos, '[]'));
  for g in select value from jsonb_array_elements(a.grupos) loop
    ts := '[]'; n := 0;
    for t in select value, ordinality from jsonb_array_elements(g->'tandas') with ordinality loop
      select jsonb_agg(jsonb_build_object('id', i.id, 'nombre', i.nombre, 'version', i.version,
        'integrantes', (select jsonb_agg(alias order by orden) from public.inscripcion_integrantes where inscripcion_id = i.id)) order by p.n)
        into entradas from jsonb_array_elements_text(t.value->'posiciones') with ordinality p(id,n)
        join public.inscripciones i on i.id = p.id::uuid;
      entradas := coalesce(entradas, '[]');
      if jsonb_array_length(entradas) = 0 then continue; end if;
      n := n + jsonb_array_length(entradas);
      ts := ts || jsonb_build_array(jsonb_build_object('numero', t.ordinality, 'inscripciones', entradas));
    end loop;
    if n = 0 then continue; end if;
    total := total + n;
    gs := gs || jsonb_build_array(jsonb_build_object('nombre', g->>'nombre', 'total', n, 'tandas', ts));
  end loop;
  if total < 2 then raise exception 'Necesitás al menos dos inscripciones activas.'; end if;
  insert into public.sorteos(fecha_id, plan, creado_por, eliminatorias_aleatorias)
    values (f.id, jsonb_build_object('version_algoritmo', 3, 'tipo', 'clasificatorias', 'total', total,
      'integrantes_por_equipo', f.integrantes_por_equipo, 'fase_inicial', f.fase_inicial,
      'por_cruce', f.por_cruce, 'clasifican', f.cupos, 'maximo_tanda', f.maximo_tanda,
      'configuracion_version', f.configuracion_version, 'armado_clasis', 'manual', 'grupos', gs), auth.uid(), not f.llave_fija)
    returning * into s;
  return to_jsonb(s);
end;
$$;
revoke all on function public.generar_sorteo(uuid) from public,anon;
grant execute on function public.generar_sorteo(uuid) to authenticated;

alter function public.iniciar_clasificatorias(uuid) set schema private;
alter function private.iniciar_clasificatorias(uuid) rename to iniciar_clasificatorias_preparadas;
revoke all on function private.iniciar_clasificatorias_preparadas(uuid) from public,anon,authenticated;
create function public.iniciar_clasificatorias(p_fecha_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.exigir_organizacion_fecha(p_fecha_id);
  if (select armado_clasis from public.fechas where id = p_fecha_id) = 'manual' then perform public.generar_sorteo(p_fecha_id); end if;
  return private.iniciar_clasificatorias_preparadas(p_fecha_id);
end;
$$;
revoke all on function public.iniciar_clasificatorias(uuid) from public,anon;
grant execute on function public.iniciar_clasificatorias(uuid) to authenticated;

revoke all on function private.exigir_armado_editable(uuid,integer),private.validar_armado_clasificatorias(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.guardar_armado_clasificatorias(uuid,integer,jsonb),public.inscribir_en_ronda(uuid,integer,uuid,integer,text,text[],uuid) from public,anon;
grant execute on function public.guardar_armado_clasificatorias(uuid,integer,jsonb),public.inscribir_en_ronda(uuid,integer,uuid,integer,text,text[],uuid) to authenticated;

-- El cierre conserva la modalidad y la solicitud para recuperar reintentos.
alter table public.cierres_clasificatorias
  add column modo_armado text not null default 'sorteo' check (modo_armado in ('sorteo','puntaje','manual')),
  add column solicitud_cruces jsonb;

create function private.crear_cuadro_con_cruces(p_sorteo uuid, p_cruces jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; s public.sorteos%rowtype; c jsonb; fase_ text; n integer; i integer;
begin
  select * into s from public.sorteos where id = p_sorteo;
  select * into f from public.fechas where id = s.fecha_id;
  for c in select value from jsonb_array_elements(p_cruces) loop
    insert into public.cruces_eliminatorias(fecha_id, sorteo_id, fase, numero, entradas)
      values (f.id, s.id, coalesce(f.fase_inicial,'octavos'), (c->>'numero')::integer, c->'inscripciones');
  end loop;
  foreach fase_ in array case f.fase_inicial when 'dieciseisavos' then array['octavos','cuartos','semifinal','final']
    else array['cuartos','semifinal','final'] end loop
    n := case fase_ when 'octavos' then 8 when 'cuartos' then 4 when 'semifinal' then 2 else 1 end;
    for i in 1..n loop
      insert into public.cruces_eliminatorias(fecha_id,sorteo_id,fase,numero) values (f.id,s.id,fase_,i);
    end loop;
  end loop;
  perform private.actualizar_llaves(s.id);
end;
$$;
revoke all on function private.crear_cuadro_con_cruces(uuid,jsonb) from public,anon,authenticated;

create or replace function public.configurar_fecha(p_fecha_id uuid,p_configuracion jsonb,p_version integer,p_regenerar boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; fase_ text; por_ integer; modo_ text; grupos_ integer; max_ integer; fija_ boolean; armado_ text;
 nuevo jsonb; anterior jsonb; clasi public.clasificatorias%rowtype; sorteo public.sorteos%rowtype; solo_cupo boolean;
begin
 perform private.exigir_organizacion_fecha(p_fecha_id);
 select * into f from public.fechas where id=p_fecha_id for update;
 armado_:=coalesce(p_configuracion->>'armado_clasis',f.armado_clasis);
 if armado_ not in ('sorteo','manual') then raise exception 'Elegí sorteo o armado manual.';end if;
 fase_:=p_configuracion->>'fase_inicial';por_:=(p_configuracion->>'por_cruce')::integer;
 modo_:=p_configuracion->>'clasis_modo';grupos_:=(p_configuracion->>'grupos_clasi')::integer;
 max_:=(p_configuracion->>'maximo_tanda')::integer;fija_:=(p_configuracion->>'llave_fija')::boolean;
 if fase_ is null or fase_ not in ('octavos','dieciseisavos') or por_ is null or por_ not between 2 and 4
   or modo_ is null or modo_ not in ('automaticas','siempre') or max_ is null or max_ not between 1 and 6
   or (grupos_ is not null and grupos_ not between 1 and 3) or fija_ is null then raise exception 'Configuración incompatible.';end if;
 nuevo:=jsonb_build_object('fase_inicial',fase_,'por_cruce',por_,'clasis_modo',modo_,'grupos_clasi',grupos_,'maximo_tanda',max_,'llave_fija',fija_,'armado_clasis',armado_);
 anterior:=jsonb_build_object('fase_inicial',f.fase_inicial,'por_cruce',f.por_cruce,'clasis_modo',f.clasis_modo,'grupos_clasi',f.grupos_clasi,'maximo_tanda',f.maximo_tanda,'llave_fija',f.llave_fija,'armado_clasis',f.armado_clasis);
 if armado_ is distinct from f.armado_clasis and exists(select 1 from public.inscripciones where fecha_id=f.id and activa) then
   raise exception 'Elegí el modo de clasis antes de inscribir participantes.';end if;
 if armado_='manual' and exists(select 1 from public.armados_clasificatorias where fecha_id=f.id)
   and (max_ is distinct from f.maximo_tanda or grupos_ is distinct from f.grupos_clasi) then
   raise exception 'El máximo por ronda se define antes de preparar el armado manual.';end if;
 if nuevo=anterior then return f.configuracion_version;end if;
 if p_version is distinct from f.configuracion_version then raise exception 'La configuración cambió. Actualizá antes de guardar.';end if;
 if f.estado in ('finalizada','archivada') or exists(select 1 from public.cierres_clasificatorias c join public.clasificatorias cl on cl.id=c.clasificatoria_id where cl.fecha_id=f.id)
   or exists(select 1 from public.cruces_eliminatorias c join public.sorteos s on s.id=c.sorteo_id where s.fecha_id=f.id and s.vigente and c.resolucion='manual') then
   raise exception 'El cierre de clasis o una batalla disputada bloquea el cambio de formato.';
 end if;
 select * into sorteo from public.sorteos where fecha_id=f.id and vigente;
 select * into clasi from public.clasificatorias where sorteo_id=sorteo.id for update;
 solo_cupo:=(nuevo-'por_cruce')=(anterior-'por_cruce');
 if clasi.id is not null then
   if not solo_cupo then raise exception 'Durante clasis solo podés ajustar el tipo de cruce y sus cupos. Se conservan grupos, jurados, tandas y puntos.';end if;
   update public.clasificatorias set clasifican=(case fase_ when 'octavos' then 8 else 16 end)*por_ where id=clasi.id;
   update public.sorteos set plan=plan||jsonb_build_object('clasifican',(case fase_ when 'octavos' then 8 else 16 end)*por_,
     'por_cruce',por_,'configuracion_version',f.configuracion_version+1) where id=sorteo.id;
   -- No se cancelan clasis al aumentar cupos. La nueva versión invalida el corte.
 elsif sorteo.id is not null then
   if not coalesce(p_regenerar,false) then raise exception 'El cambio invalida el sorteo pendiente y sus pases libres. Confirmá su regeneración; el anterior queda en el historial.';end if;
   update public.sorteos set vigente=false,cancelado_por=auth.uid(),cancelado_en=now() where id=sorteo.id;
 end if;
 insert into public.historial_configuracion_fecha(fecha_id,antes,despues,usuario_id) values(f.id,anterior||jsonb_build_object('sorteo',to_jsonb(sorteo)),nuevo,auth.uid());
 update public.fechas set fase_inicial=fase_,por_cruce=por_,clasis_modo=modo_,grupos_clasi=grupos_,maximo_tanda=max_,llave_fija=fija_,armado_clasis=armado_,
   configuracion_version=configuracion_version+1,
   estado=case when clasi.id is null and sorteo.id is not null then 'inscripciones' else estado end
 where id=f.id;
 if clasi.id is null and sorteo.id is not null then perform public.generar_sorteo(f.id);end if;
 return f.configuracion_version+1;
end;
$$;

create or replace function public.copiar_configuracion_fecha(p_origen uuid,p_nombre text,p_solicitud uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; id_ uuid; copia private.copias_fecha%rowtype;
begin
 perform private.exigir_organizacion_fecha(p_origen);
 select * into f from public.fechas where id=p_origen;
 if p_solicitud is null then raise exception 'Falta el identificador de solicitud.';end if;
 select * into copia from private.copias_fecha where solicitud_id=p_solicitud;
 if found then
   if copia.usuario_id<>auth.uid() or copia.origen_id<>p_origen or copia.nombre<>trim(p_nombre) then raise exception 'Solicitud usada con otros datos.';end if;
   return copia.fecha_id;
 end if;
 if f.fase_inicial is null then raise exception 'Configurá explícitamente el formato de la fecha histórica antes de copiarla.';end if;
 insert into public.fechas(competencia_id,nombre,integrantes_por_equipo,jurados_eliminatorias,jurados_por_grupo_clasi,fase_inicial,por_cruce,clasis_modo,grupos_clasi,maximo_tanda,llave_fija,armado_clasis)
 values(f.competencia_id,trim(p_nombre),f.integrantes_por_equipo,f.jurados_eliminatorias,f.jurados_por_grupo_clasi,f.fase_inicial,f.por_cruce,f.clasis_modo,f.grupos_clasi,f.maximo_tanda,f.llave_fija,f.armado_clasis) returning id into id_;
 insert into public.planillas_fecha(fecha_id,tipo,casillas,actualizado_por)
   select id_,tipo,casillas,auth.uid() from public.planillas_fecha where fecha_id=f.id;
 insert into public.planillas_fases(fecha_id,fase,configuracion,actualizado_por,actualizado_en,creado_en)
   select id_,fase,configuracion,auth.uid(),now(),now() from public.planillas_fases where fecha_id=f.id;
 insert into private.copias_fecha values(p_solicitud,auth.uid(),p_origen,id_,trim(p_nombre));
 return id_;
end;
$$;

create function public.cerrar_clasificatorias_con_armado(
  p_clasificatoria_id uuid,
  p_version text,
  p_ganadores_desempate uuid[],
  p_nota_desempate text,
  p_modo text,
  p_cruces jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_fecha_id uuid; v_fecha public.fechas%rowtype;
  v_clasi public.clasificatorias%rowtype;
  v_cierre public.cierres_clasificatorias%rowtype;
  v_ranking jsonb; v_corte jsonb;
  v_seleccion uuid[]; v_guardados uuid[]; v_ids uuid[];
  v_nota text := nullif(trim(p_nota_desempate), '');
  v_cruces jsonb; v_cruce jsonb; v_canonicos jsonb; v_todos uuid[];
  v_clasificados jsonb; v_aleatorios jsonb; v_entradas jsonb;
  v_cantidad integer; v_por_cruce integer;
  i integer;
begin
  if not private.exigir_organizacion_fecha(private.fecha_recurso('clasi',p_clasificatoria_id)) then
    raise exception 'No tenés permiso para cerrar clasificatorias.';
  end if;
  select fecha_id into v_fecha_id from public.clasificatorias where id = p_clasificatoria_id;
  if not found then raise exception 'La clasificatoria no existe.'; end if;
  select * into v_fecha from public.fechas where id = v_fecha_id for update;
  select * into v_clasi from public.clasificatorias where id = p_clasificatoria_id for update;
  if p_modo is null or p_modo not in ('sorteo','puntaje','manual') then raise exception 'Elegí cómo armar los cruces.';end if;
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
      and v_nota is not distinct from v_cierre.nota_desempate
      and p_modo = v_cierre.modo_armado and p_cruces is not distinct from v_cierre.solicitud_cruces then
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
  if cardinality(v_ids)<2 then raise exception 'Se necesitan al menos dos inscripciones puntuadas para iniciar eliminatorias.';end if;
  v_cantidad := case v_fecha.fase_inicial when 'dieciseisavos' then 16 else 8 end;
  v_por_cruce := coalesce(v_fecha.por_cruce, ceil(v_clasi.clasifican::numeric / v_cantidad)::integer);
  if p_modo = 'puntaje' then
    select jsonb_agg(f.value->'entrada' order by (f.value->>'puntos')::numeric desc, f.pos) into v_clasificados
      from jsonb_array_elements(v_ranking->'filas') with ordinality f(value,pos)
      where (f.value->>'inscripcion_id')::uuid = any(v_ids);
    select jsonb_agg(jsonb_build_object('numero', n, 'inscripciones', coalesce(
      (select jsonb_agg(e.value->>'id' order by e.pos) from jsonb_array_elements(v_clasificados) with ordinality e(value,pos)
       where e.pos > (n-1)*v_por_cruce and e.pos <= n*v_por_cruce), '[]'::jsonb)) order by n)
      into v_cruces from generate_series(1,v_cantidad) s(n);
    if p_cruces is not null and p_cruces <> v_cruces then raise exception 'La vista previa no coincide con el orden por puntaje. Actualizá los resultados.';end if;
  elsif p_modo = 'sorteo' and p_cruces is null then
    select jsonb_agg(e.value order by random()) into v_aleatorios from jsonb_array_elements(v_clasificados) e(value);
    select jsonb_agg(jsonb_build_object('numero', (c->>'numero')::integer, 'inscripciones',
      coalesce((select jsonb_agg(e->>'id') from jsonb_array_elements(c->'inscripciones') e),'[]')) order by (c->>'numero')::integer)
      into v_cruces from jsonb_array_elements(private.repartir_cruces(v_aleatorios,v_cantidad)) c;
  else
    v_cruces := p_cruces;
  end if;
  if jsonb_typeof(v_cruces) is distinct from 'array' then raise exception 'Completá el armado de los cruces.';end if;
  if jsonb_array_length(v_cruces) <> v_cantidad then raise exception 'La cantidad de cruces no coincide con la fase inicial.';end if;
  v_todos := '{}'; v_canonicos := '[]'; i := 0;
  for v_cruce in select value from jsonb_array_elements(v_cruces) loop
    i := i+1;
    if (v_cruce->>'numero')::integer is distinct from i or jsonb_typeof(v_cruce->'inscripciones') is distinct from 'array' then
      raise exception 'Los cruces deben estar numerados en orden.';end if;
    if jsonb_array_length(v_cruce->'inscripciones') > v_por_cruce then raise exception 'Un cruce supera la cantidad configurada.';end if;
    select coalesce(array_agg(id::uuid), '{}') into v_guardados from jsonb_array_elements_text(v_cruce->'inscripciones') t(id);
    if array_position(v_guardados, null) is not null then raise exception 'Completá o quitá los lugares vacíos del cruce.';end if;
    v_todos := v_todos || v_guardados;
    select coalesce(jsonb_agg(e.value order by ids.pos), '[]') into v_entradas
      from unnest(v_guardados) with ordinality ids(id,pos)
      join jsonb_array_elements(v_clasificados) e(value) on (e.value->>'id')::uuid = ids.id;
    v_canonicos := v_canonicos || jsonb_build_array(jsonb_build_object('numero', i, 'inscripciones', v_entradas));
  end loop;
  if cardinality(v_todos) <> cardinality(v_ids) or
    (select count(distinct id) from unnest(v_todos) t(id)) <> cardinality(v_ids) or
    exists(select 1 from unnest(v_todos) t(id) where not (id = any(v_ids))) then
    raise exception 'Ubicá a cada clasificado una sola vez, sin agregar otros participantes.';end if;
  perform private.crear_cuadro_con_cruces(v_clasi.sorteo_id, v_canonicos);
  insert into public.cierres_clasificatorias(clasificatoria_id, sorteo_id,
    version_consulta, ranking, clasificados, ganadores_desempate, nota_desempate, cerrado_por, modo_armado, solicitud_cruces)
  values (v_clasi.id, v_clasi.sorteo_id, p_version, v_ranking,
    v_clasificados, v_seleccion, v_nota, auth.uid(), p_modo, p_cruces);
  update public.clasificatorias set estado = 'finalizada', finalizado_en = now() where id = v_clasi.id;
  return v_clasi.sorteo_id;
end;
$$;

create or replace function public.cerrar_clasificatorias_y_sortear_octavos(
  p_clasificatoria_id uuid, p_version text, p_ganadores_desempate uuid[] default '{}', p_nota_desempate text default null
) returns uuid language sql security definer set search_path = '' as $$
  select public.cerrar_clasificatorias_con_armado(p_clasificatoria_id,p_version,p_ganadores_desempate,p_nota_desempate,'sorteo',null);
$$;
revoke all on function public.cerrar_clasificatorias_con_armado(uuid,text,uuid[],text,text,jsonb) from public,anon;
grant execute on function public.cerrar_clasificatorias_con_armado(uuid,text,uuid[],text,text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
