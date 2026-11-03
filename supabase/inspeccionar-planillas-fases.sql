-- Una única salida JSON para que el editor muestre todo el diagnóstico.
-- Solo catálogos: no consulta usuarios, configuraciones ni puntuaciones.
select jsonb_build_object(
  'tabla',(select jsonb_build_object('tipo',c.relkind,'rls',c.relrowsecurity,
    'forzar_rls',c.relforcerowsecurity,'propietario',pg_get_userbyid(c.relowner))
    from pg_class c where c.oid=to_regclass('public.planillas_fases')),
  'columnas',(select coalesce(jsonb_agg(jsonb_build_object('nombre',a.attname,
    'tipo',format_type(a.atttypid,a.atttypmod),'no_nula',a.attnotnull,
    'predeterminado',pg_get_expr(d.adbin,d.adrelid),'identidad',a.attidentity,
    'generada',a.attgenerated) order by a.attnum),'[]'::jsonb)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=to_regclass('public.planillas_fases') and a.attnum>0 and not a.attisdropped),
  'restricciones',(select coalesce(jsonb_agg(jsonb_build_object('nombre',conname,
    'definicion',pg_get_constraintdef(oid)) order by conname),'[]'::jsonb)
    from pg_constraint where conrelid=to_regclass('public.planillas_fases')),
  'indices',(select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from (
    select indexname,indexdef from pg_indexes where schemaname='public' and tablename='planillas_fases')i),
  'politicas',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from (
    select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='planillas_fases')p),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object('definicion',pg_get_triggerdef(oid))), '[]'::jsonb)
    from pg_trigger where tgrelid=to_regclass('public.planillas_fases') and not tgisinternal),
  'rpc',(select coalesce(jsonb_agg(jsonb_build_object('firma',p.oid::regprocedure::text,
    'definicion',pg_get_functiondef(p.oid),'permisos',p.proacl)),'[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='guardar_planilla_fase' and p.prokind='f'),
  'columnas_018_en_fechas',(select coalesce(jsonb_agg(column_name),'[]'::jsonb)
    from information_schema.columns where table_schema='public' and table_name='fechas'
    and column_name in ('fase_inicial','por_cruce','configuracion_version','cupos'))
) as diagnostico;
