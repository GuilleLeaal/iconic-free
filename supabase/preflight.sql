-- SOLO LECTURA. Ejecutar como propietario antes de decidir qué migraciones faltan.
begin transaction read only;
select version(), current_database(), current_user;
select schemaname,tablename,rowsecurity from pg_tables
 where schemaname in ('public','private') order by schemaname,tablename;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
 where schemaname in ('public','private') order by schemaname,tablename,policyname;
select n.nspname as esquema,p.proname,pg_get_function_identity_arguments(p.oid) as argumentos,
 p.prosecdef as security_definer,p.proconfig as configuracion,p.proacl as acl,
 has_function_privilege('anon',p.oid,'execute') as ejecuta_anon,
 has_function_privilege('authenticated',p.oid,'execute') as ejecuta_authenticated,
 pg_get_functiondef(p.oid) as definicion
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prokind='f' order by n.nspname,p.proname,p.oid;
select table_schema,table_name,column_name,data_type,is_nullable,column_default
 from information_schema.columns where table_schema in ('public','private') order by table_schema,table_name,ordinal_position;
select table_schema,table_name,grantee,privilege_type from information_schema.table_privileges
 where table_schema in ('public','private') order by table_schema,table_name,grantee,privilege_type;
select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('public','private') order by schemaname,tablename,indexname;
select n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) from pg_constraint k
 join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','private') order by n.nspname,c.relname,k.conname;
select event_object_schema,event_object_table,trigger_name,action_statement
 from information_schema.triggers where event_object_schema in ('public','private','auth') order by 1,2,3;
select schemaname,viewname,definition from pg_views where schemaname in ('public','private');
select to_regclass('public.planillas_fases') as fases_007,
 to_regclass('supabase_migrations.schema_migrations') as registro_migraciones,
 to_regclass('public.votaciones_clasificatorias') as votos_012,
 to_regclass('private.retiros_clasificatorias') as retiros_015;
-- Detecta referencias incompatibles preexistentes que las nuevas FK rechazarán.
select 'clasi/sorteo' as problema,c.id from public.clasificatorias c join public.sorteos s on s.id=c.sorteo_id where c.fecha_id<>s.fecha_id
 union all select 'cruce/sorteo',c.id from public.cruces_eliminatorias c join public.sorteos s on s.id=c.sorteo_id where c.fecha_id<>s.fecha_id;
select lower(trim(email)) as email_normalizado,count(*) from auth.users
 where email is not null group by lower(trim(email)) having count(*)>1;
rollback;
