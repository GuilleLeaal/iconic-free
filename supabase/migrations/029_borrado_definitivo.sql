begin;

-- Las referencias de propiedad se borran con su recurso. Las referencias de
-- autoría de fechas/resultados se vuelven anónimas al eliminar una cuenta.
-- No se concede DELETE directo ni se elimina ningún dato al aplicar la migración.
do $$
declare fk record; col record; accion text; locales text; remotas text;
begin
 for fk in
   select c.*,n.nspname as esquema,t.relname as tabla,
     a.relname as padre,pn.nspname as esquema_padre
   from pg_constraint c join pg_class t on t.oid=c.conrelid
   join pg_namespace n on n.oid=t.relnamespace
   join pg_class a on a.oid=c.confrelid join pg_namespace pn on pn.oid=a.relnamespace
   where c.contype='f' and n.nspname in ('public','private') and pn.nspname='public'
     and t.relname in ('competencias','perfiles','fechas','inscripciones','inscripcion_integrantes',
       'inscripciones_historial','sorteos','jurados_fecha','planillas_fecha','planillas_fases',
       'cruces_eliminatorias','sorteos_fases_eliminatorias','historial_resultados_eliminatorias',
       'clasificatorias','grupos_clasificatorias','jurados_clasificatorias','tandas_clasificatorias',
       'votaciones_clasificatorias','cierres_clasificatorias','vinculos_competencia','auditoria_accesos',
       'historial_configuracion_fecha','altas_clasificatorias','retiros_clasificatorias',
       'copias_fecha','invitaciones','administrador_plataforma')
     and a.relname in ('competencias','fechas','inscripciones','sorteos',
       'cruces_eliminatorias','clasificatorias','grupos_clasificatorias','tandas_clasificatorias','perfiles')
   order by c.oid
 loop
   if fk.padre='perfiles' and fk.esquema='private' and fk.tabla='administrador_plataforma' then continue;end if;
   select string_agg(quote_ident(a.attname),',' order by k.ord) into locales
     from unnest(fk.conkey) with ordinality k(num,ord)
     join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.num;
   select string_agg(quote_ident(a.attname),',' order by k.ord) into remotas
     from unnest(fk.confkey) with ordinality k(num,ord)
     join pg_attribute a on a.attrelid=fk.confrelid and a.attnum=k.num;
   accion:='CASCADE';
   if fk.padre='perfiles' and not (
     fk.tabla in ('vinculos_competencia','votaciones_clasificatorias','auditoria_accesos',
       'inscripciones_historial','historial_configuracion_fecha','historial_resultados_eliminatorias',
       'altas_clasificatorias','retiros_clasificatorias','copias_fecha','invitaciones')
     or (fk.tabla in ('jurados_fecha','jurados_clasificatorias') and locales='jurado_id')
   ) then
     accion:='SET NULL';
     for col in select a.attname from unnest(fk.conkey) k(num)
       join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.num
     loop
       execute format('alter table %I.%I alter column %I drop not null',fk.esquema,fk.tabla,col.attname);
     end loop;
   end if;
   execute format('alter table %I.%I drop constraint %I',fk.esquema,fk.tabla,fk.conname);
   execute format('alter table %I.%I add constraint %I foreign key (%s) references %I.%I (%s) on delete %s %s',
     fk.esquema,fk.tabla,fk.conname,locales,fk.esquema_padre,fk.padre,remotas,accion,
     case when fk.condeferrable then 'deferrable '||case when fk.condeferred then 'initially deferred' else 'initially immediate' end else '' end);
 end loop;
end;
$$;

-- Una fecha eliminada lógicamente puede sobrevivir a la cuenta de su autor.
alter table public.fechas drop constraint fecha_eliminacion_completa;
alter table public.fechas add constraint fecha_eliminacion_completa
  check(eliminado_en is not null or eliminado_por is null);

create function private.proteger_administrador_borrado() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from private.administrador_plataforma where usuario_id=old.id) then
   raise exception 'No se puede eliminar la cuenta de administración global.';
 end if;
 return old;
end;
$$;
create trigger proteger_administrador_borrado before delete on public.perfiles
  for each row execute function private.proteger_administrador_borrado();

-- Auth borra físicamente la cuenta; su FK borra el perfil y sus dependencias
-- en la misma transacción. Limpiar invitaciones aceptadas evita reutilizarlas
-- cuando el mismo correo vuelve a registrarse con un UUID nuevo.
create function private.limpiar_invitaciones_cuenta_borrada() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from private.administrador_plataforma where usuario_id=old.id) then
   raise exception 'No se puede eliminar la cuenta de administración global.';
 end if;
 -- Mismo orden que votos, cambios de vínculos y borrado de competencias.
 perform id from public.fechas order by id for update;
 perform id from private.invitaciones
   where email=lower(trim(old.email)) or creada_por=old.id order by id for update;
 if exists(select 1 from private.invitaciones where (email=lower(trim(old.email)) or creada_por=old.id)
   and lease_hasta>now()) then
   raise exception 'Hay un envío de invitación en curso. Esperá 90 segundos y reintentá.';
 end if;
 with borradas as (delete from private.invitaciones where email=lower(trim(old.email)) or creada_por=old.id returning id)
 delete from public.auditoria_accesos where detalle->>'invitacion_id' in (select id::text from borradas);
 -- Los snapshots privados de retiros tampoco conservan votos de esa cuenta.
 update private.retiros_clasificatorias r set votos_anteriores=coalesce((
   select jsonb_agg(v order by pos) from jsonb_array_elements(r.votos_anteriores) with ordinality e(v,pos)
   where v->>'jurado_id' is distinct from old.id::text),'[]'::jsonb)
 where exists(select 1 from jsonb_array_elements(r.votos_anteriores) v where v->>'jurado_id'=old.id::text);
 return old;
end;
$$;
create trigger limpiar_invitaciones_cuenta_borrada before delete on auth.users
  for each row execute function private.limpiar_invitaciones_cuenta_borrada();

-- Exclusiva de servidor: el actor se obtiene verificando su JWT en la función
-- Edge. El navegador jamás elige el actor ni recibe una clave privilegiada.
create function public.validar_borrado_usuario(p_actor uuid,p_usuario uuid,p_confirmacion text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare correo text;
begin
 if p_actor is null or not exists(select 1 from private.administrador_plataforma where usuario_id=p_actor) then
   raise exception 'Acceso exclusivo de administración global.';
 end if;
 if p_usuario is null or p_usuario=p_actor or exists(select 1 from private.administrador_plataforma where usuario_id=p_usuario) then
   raise exception 'No se puede eliminar tu cuenta ni la de administración global.';
 end if;
 if nullif(trim(p_confirmacion),'') is null then raise exception 'Escribí el correo de la cuenta para confirmar.';end if;
 select lower(trim(email)) into correo from auth.users where id=p_usuario;
 if not found then return jsonb_build_object('existe',false);end if;
 if correo is distinct from lower(trim(p_confirmacion)) then raise exception 'El correo de confirmación no coincide.';end if;
 return jsonb_build_object('existe',true);
end;
$$;

create function public.eliminar_competencia_definitiva(p_competencia uuid,p_confirmacion text)
returns void language plpgsql security definer set search_path = '' as $$
declare nombre_ text;
begin
 if not private.es_admin() then raise exception 'Acceso exclusivo de administración global.';end if;
 -- Orden de bloqueo compartido con votos/configuración/cambios de vínculos.
 perform id from public.fechas where competencia_id=p_competencia order by id for update;
 select nombre into nombre_ from public.competencias where id=p_competencia for update;
 if not found then return;end if;
 if p_confirmacion is null or trim(p_confirmacion)<>nombre_ then raise exception 'El nombre de confirmación no coincide.';end if;
 perform id from private.invitaciones where competencia_id=p_competencia order by id for update;
 if exists(select 1 from private.invitaciones where competencia_id=p_competencia and lease_hasta>now()) then
   raise exception 'Hay un envío de invitación en curso. Esperá 90 segundos y reintentá.';
 end if;
 delete from public.competencias where id=p_competencia;
end;
$$;

revoke all on function private.proteger_administrador_borrado(),private.limpiar_invitaciones_cuenta_borrada() from public,anon,authenticated;
revoke all on function public.validar_borrado_usuario(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.validar_borrado_usuario(uuid,uuid,text) to service_role;
revoke all on function public.eliminar_competencia_definitiva(uuid,text) from public,anon,authenticated;
grant execute on function public.eliminar_competencia_definitiva(uuid,text) to authenticated;
notify pgrst, 'reload schema';
commit;
