begin;

create table public.competencias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) between 1 and 120),
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);
create table private.administrador_plataforma (
  singleton boolean primary key default true check (singleton),
  usuario_id uuid not null unique references public.perfiles(id)
);
create table public.vinculos_competencia (
  competencia_id uuid not null references public.competencias(id),
  usuario_id uuid not null references public.perfiles(id),
  rol text not null check (rol in ('organizacion','jurado')),
  estado text not null check (estado in ('pendiente','activo','inactivo')),
  actualizado_en timestamptz not null default now(),
  primary key (competencia_id, usuario_id, rol)
);
create index vinculos_usuario_idx on public.vinculos_competencia(usuario_id, estado, competencia_id);
create table public.auditoria_accesos (
  id bigint generated always as identity primary key,
  competencia_id uuid references public.competencias(id),
  actor_id uuid references public.perfiles(id),
  usuario_id uuid references public.perfiles(id),
  accion text not null,
  detalle jsonb not null default '{}',
  creado_en timestamptz not null default now()
);
create index auditoria_competencia_idx on public.auditoria_accesos(competencia_id, creado_en desc);
alter table public.fechas add column competencia_id uuid references public.competencias(id);
create index fechas_competencia_idx on public.fechas(competencia_id, creado_en desc, id);

create function private.es_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.administrador_plataforma where usuario_id = auth.uid());
$$;
create function private.tiene_vinculo(p_competencia uuid, p_rol text default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.vinculos_competencia v join public.competencias c on c.id=v.competencia_id
    where v.competencia_id=p_competencia and v.usuario_id=auth.uid() and v.estado='activo'
      and c.activa and (p_rol is null or v.rol=p_rol));
$$;
create function private.organiza_competencia(p_competencia uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_competencia is not null and (private.es_admin() or private.tiene_vinculo(p_competencia,'organizacion'));
$$;
create function private.organiza_fecha(p_fecha uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.organiza_competencia(competencia_id) from public.fechas where id=p_fecha),false);
$$;
-- Bloquea en el mismo orden que votos, cierre y configuración. Se vuelve a
-- comprobar el vínculo después del bloqueo, incluso con sesión vieja.
create function private.exigir_organizacion_fecha(p_fecha uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform id from public.fechas where id=p_fecha for update;
  if not found or not private.organiza_fecha(p_fecha) then
    raise exception 'No tenés permiso para operar esta fecha.';
  end if;
  return true;
end;
$$;
-- El helper antiguo falla cerrado. Ningún rol histórico otorga acceso.
create or replace function private.es_organizacion() returns boolean
language sql stable security definer set search_path = '' as $$ select false; $$;

create function private.fecha_recurso(p_tipo text,p_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select case p_tipo
    when 'inscripcion' then (select fecha_id from public.inscripciones where id=p_id)
    when 'sorteo' then (select fecha_id from public.sorteos where id=p_id)
    when 'cruce' then (select fecha_id from public.cruces_eliminatorias where id=p_id)
    when 'clasi' then (select fecha_id from public.clasificatorias where id=p_id)
    when 'grupo' then (select c.fecha_id from public.grupos_clasificatorias g join public.clasificatorias c on c.id=g.clasificatoria_id where g.id=p_id)
    when 'tanda' then (select c.fecha_id from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id join public.clasificatorias c on c.id=g.clasificatoria_id where t.id=p_id)
    else null end;
$$;
create function private.jurado_grupo(p_grupo uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.jurados_clasificatorias j
    join public.grupos_clasificatorias g on g.id=j.grupo_id
    join public.clasificatorias c on c.id=g.clasificatoria_id
    join public.fechas f on f.id=c.fecha_id
    where j.grupo_id=p_grupo and j.jurado_id=auth.uid()
      and private.tiene_vinculo(f.competencia_id,'jurado'));
$$;
create function private.organiza_recurso(p_tipo text,p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.organiza_fecha(private.fecha_recurso(p_tipo,p_id));
$$;
create function private.jurado_fecha(p_fecha uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.jurados_fecha j join public.fechas f on f.id=j.fecha_id
    where j.fecha_id=p_fecha and j.jurado_id=auth.uid() and private.tiene_vinculo(f.competencia_id,'jurado'));
$$;
create or replace function private.puede_ver_grupo_clasi(p_grupo_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select private.organiza_fecha(private.fecha_recurso('grupo',p_grupo_id)) or private.jurado_grupo(p_grupo_id);
$$;
create or replace function private.puede_ver_clasificatoria(p_clasificatoria_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select private.organiza_fecha(private.fecha_recurso('clasi',p_clasificatoria_id)) or exists
 (select 1 from public.grupos_clasificatorias where clasificatoria_id=p_clasificatoria_id and private.jurado_grupo(id));
$$;

-- Instalación explícita: solo propietario SQL. No expuesta a API ni service_role.
create function private.instalar_iconic(p_administrador uuid, p_email_confirmacion text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not exists(select 1 from auth.users u join public.perfiles p on p.id=u.id
    where u.id=p_administrador and lower(trim(u.email))=lower(trim(p_email_confirmacion))) then
    raise exception 'El UUID y el correo no identifican una cuenta Auth existente.';
  end if;
  if exists(select 1 from private.administrador_plataforma) then
    raise exception 'Bootstrap ya ejecutado. No se reemplaza al administrador.';
  end if;
  insert into private.administrador_plataforma(usuario_id) values(p_administrador);
  insert into public.competencias(nombre) values('Iconic') returning id into v_id;
  update public.fechas set competencia_id=v_id where competencia_id is null;
  insert into public.vinculos_competencia values(v_id,p_administrador,'organizacion','activo',now());
  -- Preserva operadores anteriores únicamente como organizadores de Iconic.
  insert into public.vinculos_competencia
    select v_id,id,'organizacion','activo',now() from public.perfiles where rol='organizacion'
    on conflict do nothing;
  insert into public.vinculos_competencia
    select distinct v_id,jurado_id,'jurado','activo',now() from public.jurados_fecha on conflict do nothing;
  insert into public.auditoria_accesos(competencia_id,usuario_id,accion) values(v_id,p_administrador,'bootstrap');
  return v_id;
end;
$$;

create function public.mis_contextos() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('administrador',private.es_admin(), 'competencias',coalesce((
    select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,
      'organizacion',private.organiza_competencia(c.id),'jurado',private.tiene_vinculo(c.id,'jurado')) order by c.nombre,c.id)
    from public.competencias c where c.activa and (private.es_admin() or private.tiene_vinculo(c.id))), '[]'::jsonb));
$$;
create function public.crear_competencia(p_nombre text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.es_admin() then raise exception 'Solo administración global puede crear competencias.'; end if;
  insert into public.competencias(nombre) values(trim(p_nombre)) returning id into v_id;
  insert into public.auditoria_accesos(competencia_id,actor_id,accion) values(v_id,auth.uid(),'crear_competencia');
  return v_id;
end;
$$;
create function public.cambiar_vinculo(p_competencia uuid,p_usuario uuid,p_rol text,p_estado text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Revocación y operaciones de fecha se serializan sin invertir bloqueos.
  perform id from public.fechas where competencia_id=p_competencia order by id for update;
  if not private.organiza_competencia(p_competencia) or (p_rol='organizacion' and not private.es_admin()) then
    raise exception 'No tenés permiso para cambiar este vínculo.';
  end if;
  if p_estado not in ('inactivo','activo') or p_rol not in ('organizacion','jurado') then raise exception 'Estado o rol inválido.'; end if;
  -- Solo habilitar cuentas que ya aceptaron; las nuevas pasan por invitación.
  update public.vinculos_competencia set estado=p_estado,actualizado_en=now()
    where competencia_id=p_competencia and usuario_id=p_usuario and rol=p_rol and estado<>'pendiente';
  if not found then raise exception 'La cuenta debe aceptar primero su invitación.'; end if;
  insert into public.auditoria_accesos(competencia_id,actor_id,usuario_id,accion,detalle)
    values(p_competencia,auth.uid(),p_usuario,'cambiar_vinculo',jsonb_build_object('rol',p_rol,'estado',p_estado));
end;
$$;

-- Reemplazar todas las políticas históricas de las tablas auditadas.
do $$ declare r record; begin
 for r in select schemaname,tablename,policyname from pg_policies where schemaname='public'
   and tablename=any(array['perfiles','fechas','inscripciones','inscripcion_integrantes','inscripciones_historial','sorteos','jurados_fecha','planillas_fecha','cruces_eliminatorias','sorteos_fases_eliminatorias','historial_resultados_eliminatorias','clasificatorias','grupos_clasificatorias','jurados_clasificatorias','tandas_clasificatorias','votaciones_clasificatorias','cierres_clasificatorias']) loop
   execute format('drop policy %I on %I.%I',r.policyname,r.schemaname,r.tablename);
 end loop;
end $$;
alter table public.competencias enable row level security;
alter table public.vinculos_competencia enable row level security;
alter table public.auditoria_accesos enable row level security;
alter table private.administrador_plataforma enable row level security;
revoke all on public.competencias,public.vinculos_competencia,public.auditoria_accesos,private.administrador_plataforma from public,anon,authenticated;
grant select on public.competencias,public.vinculos_competencia,public.auditoria_accesos to authenticated;
create policy competencia_lectura on public.competencias for select to authenticated using(private.es_admin() or private.tiene_vinculo(id));
create policy vinculo_lectura on public.vinculos_competencia for select to authenticated using(usuario_id=auth.uid() or private.organiza_competencia(competencia_id));
create policy auditoria_lectura on public.auditoria_accesos for select to authenticated using(private.organiza_competencia(competencia_id));
create policy perfil_lectura on public.perfiles for select to authenticated using(id=auth.uid() or private.es_admin() or exists(
  select 1 from public.vinculos_competencia v where v.usuario_id=perfiles.id and private.organiza_competencia(v.competencia_id)));
create policy perfil_nombre on public.perfiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy fecha_lectura on public.fechas for select to authenticated using(private.organiza_fecha(id) or private.jurado_fecha(id));
create policy fecha_creacion on public.fechas for insert to authenticated with check(private.organiza_competencia(competencia_id) and creado_por=auth.uid());
create policy fecha_edicion on public.fechas for update to authenticated using(private.organiza_fecha(id)) with check(private.organiza_competencia(competencia_id));
grant insert(competencia_id) on public.fechas to authenticated;

do $$ declare r record; begin
 for r in select * from (values
 ('inscripciones','private.organiza_fecha(fecha_id)'),('inscripcion_integrantes', 'private.organiza_recurso(''inscripcion'',inscripcion_id)'),
 ('inscripciones_historial','private.organiza_recurso(''inscripcion'',inscripcion_id)'),
 ('sorteos','private.organiza_fecha(fecha_id)'),('cruces_eliminatorias','private.organiza_fecha(fecha_id)'),('sorteos_fases_eliminatorias','private.organiza_fecha(fecha_id)'),
 ('historial_resultados_eliminatorias','private.organiza_fecha(fecha_id)'),('cierres_clasificatorias','private.organiza_recurso(''clasi'',clasificatoria_id)')
 ) t(tabla,permiso) loop
 execute format('create policy organizacion_lectura on public.%I for select to authenticated using(%s)',r.tabla,r.permiso);
 end loop;
end $$;
create policy jurados_lectura on public.jurados_fecha for select to authenticated using(private.organiza_fecha(fecha_id) or (jurado_id=auth.uid() and private.jurado_fecha(fecha_id)));
create policy planillas_lectura on public.planillas_fecha for select to authenticated using(private.organiza_fecha(fecha_id) or private.jurado_fecha(fecha_id));
create policy clasi_lectura on public.clasificatorias for select to authenticated using(private.puede_ver_clasificatoria(id));
create policy grupos_lectura on public.grupos_clasificatorias for select to authenticated using(private.puede_ver_grupo_clasi(id));
create policy jurados_clasi_lectura on public.jurados_clasificatorias for select to authenticated using(private.organiza_recurso('grupo',grupo_id) or (jurado_id=auth.uid() and private.jurado_grupo(grupo_id)));
create policy tandas_lectura on public.tandas_clasificatorias for select to authenticated using(private.puede_ver_grupo_clasi(grupo_id));
create policy votos_lectura on public.votaciones_clasificatorias for select to authenticated using(private.organiza_recurso('tanda',tanda_id) or (jurado_id=auth.uid() and exists(select 1 from public.tandas_clasificatorias t where t.id=tanda_id and private.jurado_grupo(t.grupo_id))));

-- Solo helpers públicos de lectura requeridos por RLS; el resto es interno.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.es_admin(),private.tiene_vinculo(uuid,text),private.organiza_competencia(uuid),private.organiza_fecha(uuid),private.organiza_recurso(text,uuid),private.jurado_grupo(uuid),private.jurado_fecha(uuid),private.puede_ver_grupo_clasi(uuid),private.puede_ver_clasificatoria(uuid) to authenticated;
revoke all on function public.mis_contextos(),public.crear_competencia(text),public.cambiar_vinculo(uuid,uuid,text,text) from public,anon;
grant execute on function public.mis_contextos(),public.crear_competencia(text),public.cambiar_vinculo(uuid,uuid,text,text) to authenticated;

commit;
