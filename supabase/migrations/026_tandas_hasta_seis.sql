begin;
-- Ampliar el límite sin modificar las fechas existentes ni su valor por defecto.
alter table public.fechas drop constraint fechas_maximo_tanda_check;
alter table public.fechas add constraint fechas_maximo_tanda_check check (maximo_tanda between 1 and 6);

create or replace function public.configurar_fecha(p_fecha_id uuid,p_configuracion jsonb,p_version integer,p_regenerar boolean default false)
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
   or modo_ is null or modo_ not in ('automaticas','siempre') or max_ is null or max_ not between 1 and 6
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


commit;

