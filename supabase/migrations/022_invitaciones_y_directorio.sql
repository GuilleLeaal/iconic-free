begin;
create table private.invitaciones (
 id uuid primary key default gen_random_uuid(), competencia_id uuid not null references public.competencias(id),
 email text not null check(email=lower(trim(email)) and position('@' in email)>1),
 rol text not null check(rol in ('organizacion','jurado')),
 creada_por uuid not null references public.perfiles(id),
 estado text not null default 'pendiente' check(estado in ('pendiente','aceptada','cancelada')),
 entrega text not null default 'pendiente' check(entrega in ('pendiente','enviada','error')),
 lease uuid,lease_hasta timestamptz, intentos integer not null default 0,
 vence_en timestamptz not null default now()+interval '7 days',
 creado_en timestamptz not null default now(),
 unique(competencia_id,email,rol)
);
alter table private.invitaciones enable row level security;
revoke all on private.invitaciones from public,anon,authenticated;

create function public.preparar_invitacion(p_competencia uuid,p_email text,p_rol text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare id_ uuid;
begin
 if not private.organiza_competencia(p_competencia) or (p_rol='organizacion' and not private.es_admin()) then raise exception 'No tenés permiso para invitar esta cuenta.';end if;
 if p_email is null or p_rol is null or p_rol not in ('organizacion','jurado') or length(trim(p_email))>254 or trim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Correo o rol inválido.';end if;
 insert into private.invitaciones(competencia_id,email,rol,creada_por) values(p_competencia,lower(trim(p_email)),p_rol,auth.uid())
 on conflict(competencia_id,email,rol) do update set vence_en=now()+interval '7 days',
 estado=case when private.invitaciones.estado='aceptada' then 'aceptada' else 'pendiente' end,
 creada_por=auth.uid()
 returning id into id_;
 insert into public.auditoria_accesos(competencia_id,actor_id,accion,detalle) values(p_competencia,auth.uid(),'preparar_invitacion',jsonb_build_object('invitacion_id',id_,'rol',p_rol));
 return id_;
end;
$$;
-- Solo Edge Function. El actor proviene de getUser(token), nunca del payload.
create function public.reservar_envio_invitacion(p_id uuid,p_actor uuid,p_reenviar boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i private.invitaciones%rowtype; lease_ uuid:=gen_random_uuid(); existe_ boolean; autorizado boolean;
begin
 select * into i from private.invitaciones where id=p_id for update;
 if not found then raise exception 'Invitación no disponible.';end if;
 select exists(select 1 from private.administrador_plataforma where usuario_id=p_actor) or
   (i.rol='jurado' and exists(select 1 from public.vinculos_competencia v join public.competencias c on c.id=v.competencia_id where v.competencia_id=i.competencia_id and v.usuario_id=p_actor and v.rol='organizacion' and v.estado='activo' and c.activa)) into autorizado;
 if not autorizado then raise exception 'Tu permiso fue revocado.';end if;
 if i.estado<>'pendiente' or i.vence_en<=now() then raise exception 'Invitación aceptada, cancelada o vencida. Prepará una nueva.';end if;
 if i.lease_hasta>now() then raise exception 'Ya hay un envío en curso. Reintentá en un minuto.';end if;
 if i.entrega='enviada' and not p_reenviar then return jsonb_build_object('enviada',true);end if;
 select exists(select 1 from auth.users where lower(trim(email))=i.email) into existe_;
 update private.invitaciones set lease=lease_,lease_hasta=now()+interval '90 seconds',intentos=intentos+1 where id=i.id;
 return jsonb_build_object('email',i.email,'existe',existe_,'lease',lease_,'enviada',false);
end;
$$;
create function public.registrar_envio_invitacion(p_id uuid,p_lease uuid,p_exito boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
 update private.invitaciones set entrega=case when p_exito then 'enviada' else 'error' end,lease=null,lease_hasta=null where id=p_id and lease=p_lease;
 if not found then raise exception 'El envío cambió. Consultá su estado antes de reintentar.';end if;
end;
$$;
create function public.mis_invitaciones() returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'competencia',c.nombre,'rol',i.rol,'vence_en',i.vence_en) order by i.creado_en),'[]')
 from private.invitaciones i join public.competencias c on c.id=i.competencia_id
 where i.estado='pendiente' and i.vence_en>now() and c.activa
 and i.email=(select lower(trim(email)) from auth.users where id=auth.uid());
$$;
create function public.aceptar_invitacion(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare i private.invitaciones%rowtype; permitido boolean;
begin
 select * into i from private.invitaciones where id=p_id for update;
 if not found or i.email is distinct from (select lower(trim(email)) from auth.users where id=auth.uid()) then raise exception 'Esta invitación no corresponde a tu cuenta.';end if;
 if i.estado='aceptada' then return;end if;
 if i.estado<>'pendiente' or i.vence_en<=now() then raise exception 'La invitación venció o fue cancelada. Solicitá su reenvío.';end if;
 select exists(select 1 from private.administrador_plataforma where usuario_id=i.creada_por) or
   (i.rol='jurado' and exists(select 1 from public.vinculos_competencia where competencia_id=i.competencia_id and usuario_id=i.creada_por and rol='organizacion' and estado='activo')) into permitido;
 if not permitido or not exists(select 1 from public.competencias where id=i.competencia_id and activa) then raise exception 'La invitación ya no está habilitada.';end if;
 insert into public.vinculos_competencia(competencia_id,usuario_id,rol,estado) values(i.competencia_id,auth.uid(),i.rol,'activo')
 on conflict(competencia_id,usuario_id,rol) do update set estado='activo',actualizado_en=now();
 update private.invitaciones set estado='aceptada' where id=i.id;
 insert into public.auditoria_accesos(competencia_id,actor_id,usuario_id,accion,detalle) values(i.competencia_id,auth.uid(),auth.uid(),'aceptar_invitacion',jsonb_build_object('rol',i.rol));
end;
$$;

-- Búsqueda y paginación en servidor. Organización solo consulta vínculos propios.
create function public.buscar_cuentas(p_competencia uuid default null,p_busqueda text default '',p_estado text default null,p_pagina integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare resultado jsonb;
begin
 if (p_competencia is null and not private.es_admin()) or (p_competencia is not null and not private.organiza_competencia(p_competencia)) then raise exception 'No tenés permiso para consultar estas cuentas.';end if;
 if p_pagina is null or p_pagina<0 then raise exception 'Página inválida.';end if;
 with candidatos as (
 select p.id,p.nombre,case when private.es_admin() then u.email else null end as email,
 coalesce((select jsonb_agg(jsonb_build_object('competencia_id',v.competencia_id,'competencia',c.nombre,'rol',v.rol,'estado',v.estado))
   from public.vinculos_competencia v join public.competencias c on c.id=v.competencia_id
   where v.usuario_id=p.id and (p_competencia is null or v.competencia_id=p_competencia)),'[]') as vinculos
 from public.perfiles p join auth.users u on u.id=p.id
 where (p_competencia is null or exists(select 1 from public.vinculos_competencia v where v.usuario_id=p.id and v.competencia_id=p_competencia))
 and (p_estado is null or exists(select 1 from public.vinculos_competencia v where v.usuario_id=p.id and (p_competencia is null or v.competencia_id=p_competencia) and v.estado=p_estado))
 and (position(lower(trim(p_busqueda)) in lower(p.nombre))>0 or (private.es_admin() and position(lower(trim(p_busqueda)) in lower(u.email))>0))
 order by p.nombre,p.id limit 21 offset p_pagina*20
 ) select jsonb_build_object('filas',coalesce((select jsonb_agg(to_jsonb(c)) from (select * from candidatos limit 20)c),'[]'),
 'hay_mas',(select count(*)>20 from candidatos)) into resultado;
 return resultado;
end;
$$;
create function public.buscar_competencias(p_busqueda text default '',p_pagina integer default 0,p_activa boolean default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if not private.es_admin() then raise exception 'Acceso exclusivo de administración global.';end if;
 if p_pagina is null or p_pagina<0 then raise exception 'Página inválida.';end if;
 return (with c as(select * from public.competencias where position(lower(trim(p_busqueda)) in lower(nombre))>0 and (p_activa is null or activa=p_activa) order by nombre,id limit 21 offset p_pagina*20)
 select jsonb_build_object('filas',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from c limit 20)x),'[]'),'hay_mas',(select count(*)>20 from c)));
end;
$$;
create function public.cambiar_competencia(p_id uuid,p_nombre text,p_activa boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform id from public.fechas where competencia_id=p_id order by id for update;
 if not private.es_admin() then raise exception 'Acceso exclusivo de administración global.';end if;
 update public.competencias set nombre=trim(p_nombre),activa=p_activa where id=p_id;
 if not found then raise exception 'Competencia no disponible.';end if;
 insert into public.auditoria_accesos(competencia_id,actor_id,accion,detalle) values(p_id,auth.uid(),'cambiar_competencia',jsonb_build_object('nombre',trim(p_nombre),'activa',p_activa));
end;
$$;
create function public.buscar_invitaciones(p_competencia uuid default null,p_busqueda text default '',p_pagina integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if (p_competencia is null and not private.es_admin()) or (p_competencia is not null and not private.organiza_competencia(p_competencia)) then raise exception 'No tenés permiso para consultar estas invitaciones.';end if;
 if p_pagina is null or p_pagina<0 then raise exception 'Página inválida.';end if;
 return (with candidatos as(select i.id,i.email,i.rol,i.entrega,i.vence_en,(i.vence_en<=now()) as vencida,i.competencia_id,c.nombre as competencia
   from private.invitaciones i join public.competencias c on c.id=i.competencia_id
   where i.estado='pendiente' and (p_competencia is null or i.competencia_id=p_competencia)
   and position(lower(trim(p_busqueda)) in i.email)>0 order by i.creado_en desc,i.id limit 21 offset p_pagina*20)
 select jsonb_build_object('filas',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from candidatos limit 20)x),'[]'),'hay_mas',(select count(*)>20 from candidatos)));
end;
$$;
create function public.cancelar_invitacion(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i private.invitaciones%rowtype;
begin
 select * into i from private.invitaciones where id=p_id for update;
 if not found or not private.organiza_competencia(i.competencia_id) or (i.rol='organizacion' and not private.es_admin()) then raise exception 'No tenés permiso para cancelar esta invitación.';end if;
 if i.estado='cancelada' then return;end if;
 if i.estado='aceptada' then raise exception 'La persona ya aceptó. Desactivá su vínculo desde el directorio.';end if;
 update private.invitaciones set estado='cancelada' where id=i.id;
 insert into public.auditoria_accesos(competencia_id,actor_id,accion,detalle) values(i.competencia_id,auth.uid(),'cancelar_invitacion',jsonb_build_object('invitacion_id',i.id));
end;
$$;
revoke all on function public.buscar_invitaciones(uuid,text,integer),public.cancelar_invitacion(uuid) from public,anon;
grant execute on function public.buscar_invitaciones(uuid,text,integer),public.cancelar_invitacion(uuid) to authenticated;
revoke all on function public.reservar_envio_invitacion(uuid,uuid,boolean),public.registrar_envio_invitacion(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.reservar_envio_invitacion(uuid,uuid,boolean),public.registrar_envio_invitacion(uuid,uuid,boolean) to service_role;
revoke all on function public.preparar_invitacion(uuid,text,text),public.mis_invitaciones(),public.aceptar_invitacion(uuid),public.buscar_cuentas(uuid,text,text,integer),public.buscar_competencias(text,integer,boolean),public.cambiar_competencia(uuid,text,boolean) from public,anon;
grant execute on function public.preparar_invitacion(uuid,text,text),public.mis_invitaciones(),public.aceptar_invitacion(uuid),public.buscar_cuentas(uuid,text,text,integer),public.buscar_competencias(text,integer,boolean),public.cambiar_competencia(uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
