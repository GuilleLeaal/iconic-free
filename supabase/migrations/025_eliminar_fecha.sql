begin;

-- Eliminación lógica: conserva inscripciones, planillas, votos y resultados.
alter table public.fechas
  add column eliminado_en timestamptz,
  add column eliminado_por uuid references public.perfiles(id),
  add constraint fecha_eliminacion_completa check((eliminado_en is null)=(eliminado_por is null));
create index fechas_visibles_competencia_idx on public.fechas(competencia_id,creado_en desc,id) where eliminado_en is null;

create or replace function private.organiza_fecha(p_fecha uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select private.organiza_competencia(competencia_id)
    from public.fechas where id=p_fecha and eliminado_en is null),false);
$$;
create or replace function private.jurado_grupo(p_grupo uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.jurados_clasificatorias j
    join public.grupos_clasificatorias g on g.id=j.grupo_id
    join public.clasificatorias c on c.id=g.clasificatoria_id
    join public.fechas f on f.id=c.fecha_id
    where j.grupo_id=p_grupo and j.jurado_id=auth.uid() and f.eliminado_en is null
      and private.tiene_vinculo(f.competencia_id,'jurado'));
$$;
create or replace function private.jurado_fecha(p_fecha uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.jurados_fecha j join public.fechas f on f.id=j.fecha_id
    where j.fecha_id=p_fecha and j.jurado_id=auth.uid() and f.eliminado_en is null
      and private.tiene_vinculo(f.competencia_id,'jurado'));
$$;

-- Usar la competencia de la propia fila también permite INSERT ... RETURNING:
-- una función STABLE que vuelve a buscar la fila aún no ve esa inserción.
drop policy fecha_lectura on public.fechas;
create policy fecha_lectura on public.fechas for select to authenticated
  using(eliminado_en is null and (private.organiza_competencia(competencia_id) or private.jurado_fecha(id)));

create function public.eliminar_fecha(p_fecha_id uuid,p_competencia_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype;
begin
  -- El mismo bloqueo que inscripción, votos, configuración y cierre. Un voto
  -- anterior termina primero; las solicitudes posteriores pierden el acceso.
  select * into f from public.fechas where id=p_fecha_id for update;
  if not found or p_competencia_id is distinct from f.competencia_id
    or not private.organiza_competencia(f.competencia_id) then
    raise exception 'No tenés permiso para eliminar esta fecha.';
  end if;
  -- Reintentar una respuesta perdida no duplica la auditoría.
  if f.eliminado_en is not null then return;end if;
  update public.fechas set eliminado_en=now(),eliminado_por=auth.uid() where id=f.id;
  insert into public.auditoria_accesos(competencia_id,actor_id,accion,detalle)
    values(f.competencia_id,auth.uid(),'eliminar_fecha',
      jsonb_build_object('fecha_id',f.id,'nombre',f.nombre,'estado_anterior',f.estado));
end;
$$;
revoke all on function public.eliminar_fecha(uuid,uuid) from public,anon;
grant execute on function public.eliminar_fecha(uuid,uuid) to authenticated;
-- No se concede DELETE ni escritura directa de las marcas de eliminación.
notify pgrst,'reload schema';
commit;
