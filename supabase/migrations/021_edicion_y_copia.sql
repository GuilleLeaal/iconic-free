begin;
create function private.proteger_contexto_fecha() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='INSERT' and new.competencia_id is null then raise exception 'Elegí una competencia.';end if;
 if tg_op='INSERT' and (new.fase_inicial is null or new.por_cruce is null or new.clasis_modo is null or new.maximo_tanda is null or new.llave_fija is null) then
   raise exception 'La fecha nueva necesita una configuración completa.';
 end if;
 if tg_op='UPDATE' and old.competencia_id is not null and new.competencia_id is distinct from old.competencia_id then
   raise exception 'No se puede mover una fecha a otra competencia.';
 end if;
 return new;
end;
$$;
create trigger proteger_contexto_fecha before insert or update on public.fechas for each row execute function private.proteger_contexto_fecha();

create function private.validar_maximo_tanda() returns trigger language plpgsql security definer set search_path = '' as $$
declare limite integer;
begin
 select coalesce(f.maximo_tanda,5) into limite from public.fechas f where f.id=private.fecha_recurso('grupo',new.grupo_id);
 if jsonb_array_length(new.entradas)>limite then raise exception 'La tanda supera el máximo configurado de % inscripciones.',limite;end if;
 return new;
end;
$$;
create trigger validar_maximo_tanda before insert or update of entradas on public.tandas_clasificatorias for each row execute function private.validar_maximo_tanda();

create function public.configurar_fecha(p_fecha_id uuid,p_configuracion jsonb,p_version integer,p_regenerar boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; fase_ text; por_ integer; modo_ text; grupos_ integer; max_ integer; fija_ boolean;
 nuevo jsonb; anterior jsonb; clasi public.clasificatorias%rowtype; sorteo public.sorteos%rowtype; solo_cupo boolean;
begin
 perform private.exigir_organizacion_fecha(p_fecha_id);
 select * into f from public.fechas where id=p_fecha_id;
 fase_:=p_configuracion->>'fase_inicial';por_:=(p_configuracion->>'por_cruce')::integer;
 modo_:=p_configuracion->>'clasis_modo';grupos_:=(p_configuracion->>'grupos_clasi')::integer;
 max_:=(p_configuracion->>'maximo_tanda')::integer;fija_:=(p_configuracion->>'llave_fija')::boolean;
 if fase_ is null or fase_ not in ('octavos','dieciseisavos') or por_ is null or por_ not between 2 and 4
   or modo_ is null or modo_ not in ('automaticas','siempre') or max_ is null or max_ not between 1 and 5
   or (grupos_ is not null and grupos_ not between 1 and 3) or fija_ is null then raise exception 'Configuración incompatible.';end if;
 nuevo:=jsonb_build_object('fase_inicial',fase_,'por_cruce',por_,'clasis_modo',modo_,'grupos_clasi',grupos_,'maximo_tanda',max_,'llave_fija',fija_);
 anterior:=jsonb_build_object('fase_inicial',f.fase_inicial,'por_cruce',f.por_cruce,'clasis_modo',f.clasis_modo,'grupos_clasi',f.grupos_clasi,'maximo_tanda',f.maximo_tanda,'llave_fija',f.llave_fija);
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
 update public.fechas set fase_inicial=fase_,por_cruce=por_,clasis_modo=modo_,grupos_clasi=grupos_,maximo_tanda=max_,llave_fija=fija_,
   configuracion_version=configuracion_version+1,
   estado=case when clasi.id is null and sorteo.id is not null then 'inscripciones' else estado end
 where id=f.id;
 if clasi.id is null and sorteo.id is not null then perform public.generar_sorteo(f.id);end if;
 return f.configuracion_version+1;
end;
$$;

create table private.copias_fecha (
 solicitud_id uuid primary key,usuario_id uuid not null references public.perfiles(id),
 origen_id uuid not null references public.fechas(id),fecha_id uuid not null references public.fechas(id),nombre text not null
);
revoke all on private.copias_fecha from public,anon,authenticated;
create function public.copiar_configuracion_fecha(p_origen uuid,p_nombre text,p_solicitud uuid) returns uuid
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
 insert into public.fechas(competencia_id,nombre,integrantes_por_equipo,jurados_eliminatorias,jurados_por_grupo_clasi,fase_inicial,por_cruce,clasis_modo,grupos_clasi,maximo_tanda,llave_fija)
 values(f.competencia_id,trim(p_nombre),f.integrantes_por_equipo,f.jurados_eliminatorias,f.jurados_por_grupo_clasi,f.fase_inicial,f.por_cruce,f.clasis_modo,f.grupos_clasi,f.maximo_tanda,f.llave_fija) returning id into id_;
 insert into public.planillas_fecha(fecha_id,tipo,casillas,actualizado_por)
   select id_,tipo,casillas,auth.uid() from public.planillas_fecha where fecha_id=f.id;
 insert into public.planillas_fases(fecha_id,fase,configuracion,actualizado_por,actualizado_en,creado_en)
   select id_,fase,configuracion,auth.uid(),now(),now() from public.planillas_fases where fecha_id=f.id;
 insert into private.copias_fecha values(p_solicitud,auth.uid(),p_origen,id_,trim(p_nombre));
 return id_;
end;
$$;
revoke all on function private.proteger_contexto_fecha(),private.validar_maximo_tanda() from public,anon,authenticated;
revoke all on function public.configurar_fecha(uuid,jsonb,integer,boolean),public.copiar_configuracion_fecha(uuid,text,uuid) from public,anon;
grant execute on function public.configurar_fecha(uuid,jsonb,integer,boolean),public.copiar_configuracion_fecha(uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
