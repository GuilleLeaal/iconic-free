begin;
-- El contexto personal no descarga el directorio global de competencias.
create or replace function public.mis_contextos() returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('administrador',private.es_admin(),'competencias',coalesce((
 select jsonb_agg(jsonb_build_object('id',c.id,'nombre',c.nombre,'organizacion',private.organiza_competencia(c.id),'jurado',private.tiene_vinculo(c.id,'jurado')) order by c.nombre,c.id)
 from public.competencias c where c.activa and private.tiene_vinculo(c.id)),'[]'::jsonb));
$$;
create function public.buscar_jurados_competencia(p_competencia uuid,p_busqueda text default '',p_pagina integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if not private.organiza_competencia(p_competencia) then raise exception 'No tenés permiso para consultar esta competencia.';end if;
 if p_pagina is null or p_pagina<0 then raise exception 'Página inválida.';end if;
 return (with candidatos as(select p.id,p.nombre from public.perfiles p join public.vinculos_competencia v on v.usuario_id=p.id
 where v.competencia_id=p_competencia and v.rol='jurado' and v.estado='activo' and position(lower(trim(p_busqueda)) in lower(p.nombre))>0
 order by p.nombre,p.id limit 21 offset p_pagina*20)
 select jsonb_build_object('filas',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from candidatos limit 20)x),'[]'),'hay_mas',(select count(*)>20 from candidatos)));
end;
$$;
revoke all on function public.buscar_jurados_competencia(uuid,text,integer) from public,anon;
grant execute on function public.buscar_jurados_competencia(uuid,text,integer) to authenticated;
commit;
