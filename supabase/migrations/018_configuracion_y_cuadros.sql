begin;
-- Sin backfill: las fechas históricas conservan su sorteo y configuración.
alter table public.fechas
  add column fase_inicial text check(fase_inicial in ('octavos','dieciseisavos')),
  add column por_cruce integer check(por_cruce between 2 and 4),
  add column clasis_modo text check(clasis_modo in ('automaticas','siempre')),
  add column grupos_clasi integer check(grupos_clasi between 1 and 3),
  add column maximo_tanda integer check(maximo_tanda between 1 and 5),
  add column llave_fija boolean,
  add column configuracion_version integer not null default 1,
  add column cupos integer generated always as
    ((case fase_inicial when 'octavos' then 8 when 'dieciseisavos' then 16 end)*por_cruce) stored;
alter table public.fechas alter column fase_inicial set default 'octavos',
  alter column por_cruce set default 2, alter column clasis_modo set default 'automaticas',
  alter column maximo_tanda set default 5, alter column llave_fija set default false;
grant insert(fase_inicial,por_cruce,clasis_modo,grupos_clasi,maximo_tanda,llave_fija) on public.fechas to authenticated;

create table public.historial_configuracion_fecha (
  id bigint generated always as identity primary key,
  fecha_id uuid not null references public.fechas(id),
  antes jsonb not null, despues jsonb not null,
  usuario_id uuid not null references public.perfiles(id),
  creado_en timestamptz not null default now()
);
alter table public.historial_configuracion_fecha enable row level security;
revoke all on public.historial_configuracion_fecha from public,anon,authenticated;
grant select on public.historial_configuracion_fecha to authenticated;
create policy configuracion_historial on public.historial_configuracion_fecha for select to authenticated using(private.organiza_fecha(fecha_id));

-- La 007 del repo está vacía, pero algunas instalaciones tienen estos objetos.
-- Adoptar solo un contrato compatible; no borrar filas ni ignorar diferencias.
do $adoptar_fases$
declare
  tabla regclass := to_regclass('public.planillas_fases');
  r record;
  atributo smallint;
  fases text[];
  expresion text;
  funcion regprocedure := to_regprocedure('public.guardar_planilla_fase(uuid,text,jsonb,integer)');
begin
  if tabla is not null then
    if (select relkind from pg_class where oid=tabla) <> 'r'
      or exists(select 1 from pg_inherits where inhrelid=tabla or inhparent=tabla) then
      raise exception 'planillas_fases existe, pero no es una tabla ordinaria independiente. Ejecutá supabase/inspeccionar-planillas-fases.sql.';
    end if;
    -- Evita cambios de estructura concurrentes mientras se valida el contrato.
    lock table public.planillas_fases in access exclusive mode;
    for r in select * from (values
      ('id','uuid'::regtype),('fecha_id','uuid'::regtype),('fase','text'::regtype),
      ('configuracion','jsonb'::regtype),('version','integer'::regtype)
    ) contrato(nombre,tipo) loop
      if not exists(select 1 from pg_attribute a where a.attrelid=tabla and a.attname=r.nombre
        and a.atttypid=r.tipo and a.attnotnull and not a.attisdropped and a.attgenerated='') then
        raise exception 'planillas_fases: la columna % debe existir con tipo % y NOT NULL. Ejecutá supabase/inspeccionar-planillas-fases.sql; no se modificaron sus datos.',r.nombre,r.tipo;
      end if;
    end loop;
    -- La RPC histórica auditaba cada escritura con estos campos. Se validan
    -- por tipo; no se inventa un autor ni timestamps para las filas antiguas.
    for r in select * from (values
      ('actualizado_por','uuid'::regtype),('actualizado_en','timestamptz'::regtype),
      ('creado_en','timestamptz'::regtype)
    ) auditoria(nombre,tipo) loop
      if exists(select 1 from pg_attribute a where a.attrelid=tabla and a.attname=r.nombre
        and not a.attisdropped and (a.atttypid<>r.tipo or a.attgenerated<>'' or a.attidentity<>'')) then
        raise exception 'planillas_fases: el campo de auditoría % tiene un tipo o generación incompatible. Ejecutá supabase/inspeccionar-planillas-fases.sql.',r.nombre;
      end if;
    end loop;
    if exists(select 1 from pg_attribute a where a.attrelid=tabla and a.attnum>0 and not a.attisdropped
      and a.attname not in ('id','fecha_id','fase','configuracion','version','actualizado_por','actualizado_en','creado_en')
      and a.attnotnull and not a.atthasdef and a.attidentity='' and a.attgenerated='') then
      raise exception 'planillas_fases tiene columnas adicionales obligatorias sin valor predeterminado. Ejecutá supabase/inspeccionar-planillas-fases.sql para adaptar su escritura sin perder información.';
    end if;
    if exists(select 1 from pg_trigger t where t.tgrelid=tabla and not t.tgisinternal
      and t.tgfoid <> 'private.actualizar_timestamp()'::regprocedure) then
      raise exception 'planillas_fases tiene triggers propios que requieren revisión. Ejecutá supabase/inspeccionar-planillas-fases.sql.';
    end if;
    select attnum into atributo from pg_attribute where attrelid=tabla and attname='fase';
    -- Solo reconocer el CHECK enumerado histórico (o el contrato nuevo).
    -- Otros CHECK sobre fase deben revisarse, en lugar de eliminarlos a ciegas.
    for r in select conname,conkey,pg_get_expr(conbin,conrelid) as expr
      from pg_constraint where conrelid=tabla and contype='c' and atributo=any(conkey)
    loop
      expresion:=r.expr;
      if r.conkey<>array[atributo] or expresion !~ '^\(fase = ANY \(ARRAY\[.*\]\)\)$' then
        raise exception 'CHECK de fase no reconocido (%): %. Ejecutá supabase/inspeccionar-planillas-fases.sql.',r.conname,expresion;
      end if;
      select array_agg(m[1] order by m[1]) into fases from regexp_matches(expresion,'''([^'']*)''','g') m;
      if fases is distinct from array['cuartos','final','octavos','semifinal']::text[]
        and fases is distinct from array['cuartos','dieciseisavos','final','octavos','semifinal']::text[] then
        raise exception 'Lista de fases histórica no reconocida en %. Ejecutá supabase/inspeccionar-planillas-fases.sql.',r.conname;
      end if;
      execute format('alter table public.planillas_fases drop constraint %I',r.conname);
    end loop;
  else
    create table public.planillas_fases (
  id uuid primary key default gen_random_uuid(),
  fecha_id uuid not null,
  fase text not null,
  configuracion jsonb not null,
  version integer not null default 1,
  actualizado_por uuid not null references public.perfiles(id),
  actualizado_en timestamptz not null default now(),
  creado_en timestamptz not null default now(),
  unique(fecha_id,fase)
);
    tabla:='public.planillas_fases'::regclass;
  end if;
  -- En tablas mínimas anteriores, conservar null en el historial desconocido.
  -- Todas las escrituras nuevas de guardar/copiar completan los tres campos.
  if not exists(select 1 from pg_attribute where attrelid=tabla and attname='actualizado_por' and not attisdropped) then
    alter table public.planillas_fases add column actualizado_por uuid references public.perfiles(id);
  end if;
  if not exists(select 1 from pg_attribute where attrelid=tabla and attname='actualizado_en' and not attisdropped) then
    alter table public.planillas_fases add column actualizado_en timestamptz;
  end if;
  if not exists(select 1 from pg_attribute where attrelid=tabla and attname='creado_en' and not attisdropped) then
    alter table public.planillas_fases add column creado_en timestamptz;
  end if;
  -- Validan también los datos ya existentes; cualquier error revierte toda 018.
  select attnum into atributo from pg_attribute where attrelid=tabla and attname='id';
  if not exists(select 1 from pg_constraint where conrelid=tabla and contype='p' and conkey=array[atributo]) then
    raise exception 'planillas_fases necesita una clave primaria exclusivamente sobre id. Ejecutá supabase/inspeccionar-planillas-fases.sql.';
  end if;
  if not exists(select 1 from pg_index i where i.indrelid=tabla and i.indisunique and i.indisvalid
    and i.indpred is null and i.indexprs is null and i.indnkeyatts=2
    and (select array_agg(a.attname::text order by a.attname) from unnest(i.indkey::smallint[]) with ordinality k(num,pos)
      join pg_attribute a on a.attrelid=tabla and a.attnum=k.num where k.pos<=i.indnkeyatts)=array['fase','fecha_id']::text[]) then
    alter table public.planillas_fases add constraint planillas_fases_fecha_fase_plataforma_unique unique(fecha_id,fase);
  end if;
  alter table public.planillas_fases
    add constraint planillas_fases_fase_plataforma_check check(fase in ('dieciseisavos','octavos','cuartos','semifinal','final')),
    add constraint planillas_fases_configuracion_plataforma_check check(jsonb_typeof(configuracion)='object'),
    add constraint planillas_fases_version_plataforma_check check(version>0),
    add constraint planillas_fases_fecha_plataforma_fk foreign key(fecha_id) references public.fechas(id);
  alter table public.planillas_fases alter column id set default gen_random_uuid(),alter column version set default 1;
  -- Sustituir las políticas de la tabla adoptada, incluidas las globales viejas.
  for r in select policyname from pg_policies where schemaname='public' and tablename='planillas_fases' loop
    execute format('drop policy %I on public.planillas_fases',r.policyname);
  end loop;
  if funcion is not null and exists(select 1 from pg_proc where oid=funcion
    and (prorettype<>'void'::regtype or prokind<>'f' or proretset
      or (proargnames is not null and proargnames<>array['p_fecha_id','p_fase','p_configuracion','p_version']::text[]))) then
    raise exception 'guardar_planilla_fase existente tiene un contrato distinto. Ejecutá supabase/inspeccionar-planillas-fases.sql.';
  end if;
  -- Un overload antiguo no debe conservarse como vía de acceso alternativa.
  for r in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='guardar_planilla_fase' and p.prokind='f' loop
    execute format('revoke all on function %s from public,anon,authenticated',r.firma);
  end loop;
end;
$adoptar_fases$;
alter table public.planillas_fases enable row level security;
revoke all on public.planillas_fases from public,anon,authenticated;
grant select on public.planillas_fases to authenticated;
create policy fases_lectura on public.planillas_fases for select to authenticated using(private.organiza_fecha(fecha_id));
create or replace function public.guardar_planilla_fase(p_fecha_id uuid,p_fase text,p_configuracion jsonb,p_version integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actual public.planillas_fases%rowtype; v_lista jsonb; v_ronda jsonb;
begin
  perform private.exigir_organizacion_fecha(p_fecha_id);
  if exists(select 1 from public.cruces_eliminatorias where fecha_id=p_fecha_id and fase=p_fase and resolucion='manual') then
    raise exception 'La fase ya tiene batallas disputadas.';
  end if;
  if p_configuracion is null or jsonb_typeof(p_configuracion)<>'object' then raise exception 'Configuración inválida.'; end if;
  foreach v_lista in array array[p_configuracion->'rondas',p_configuracion->'replica'] loop
    if v_lista is null or jsonb_typeof(v_lista)<>'array' or jsonb_array_length(v_lista)=0 then raise exception 'Agregá rondas y réplica.'; end if;
    for v_ronda in select value from jsonb_array_elements(v_lista) loop
      if nullif(trim(v_ronda->>'nombre'),'') is null or jsonb_typeof(v_ronda->'casillas') is distinct from 'array'
        or jsonb_array_length(v_ronda->'casillas')=0 then raise exception 'Completá las rondas y casillas.'; end if;
      if exists(select 1 from jsonb_array_elements(v_ronda->'casillas') e where jsonb_typeof(e)<>'string' or trim(e#>>'{}')='') then raise exception 'Casilla inválida.'; end if;
    end loop;
  end loop;
  select * into v_actual from public.planillas_fases where fecha_id=p_fecha_id and fase=p_fase for update;
  if found then
    if v_actual.configuracion=p_configuracion then return; end if;
    if p_version is distinct from v_actual.version then raise exception 'La planilla cambió. Actualizá.'; end if;
    update public.planillas_fases set configuracion=p_configuracion,version=version+1,
      actualizado_por=auth.uid(),actualizado_en=now() where id=v_actual.id;
  else
    if p_version is distinct from 0 then raise exception 'La planilla cambió. Actualizá.'; end if;
    insert into public.planillas_fases(fecha_id,fase,configuracion,actualizado_por,actualizado_en,creado_en)
      values(p_fecha_id,p_fase,p_configuracion,auth.uid(),now(),now());
  end if;
end;
$$;

-- Nuevas fases sin alterar resultados existentes.
alter table public.cruces_eliminatorias drop constraint cruces_eliminatorias_fase_check;
alter table public.cruces_eliminatorias add constraint cruces_fase_check check(fase in ('dieciseisavos','octavos','cuartos','semifinal','final'));
-- El CHECK de número fue creado sin nombre en 008. Identificarlo exactamente.
do $$ declare v_nombre text; begin
  select conname into strict v_nombre from pg_constraint where conrelid='public.cruces_eliminatorias'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%numero%' and pg_get_constraintdef(oid) like '%octavos%';
  execute format('alter table public.cruces_eliminatorias drop constraint %I',v_nombre);
end $$;
alter table public.cruces_eliminatorias add constraint cruce_numero_check check(numero between 1 and
  case fase when 'dieciseisavos' then 16 when 'octavos' then 8 when 'cuartos' then 4 when 'semifinal' then 2 else 1 end);
alter table public.sorteos_fases_eliminatorias drop constraint sorteos_fases_eliminatorias_fase_check;
alter table public.sorteos_fases_eliminatorias add constraint sorteo_fase_check check(fase in ('octavos','cuartos','semifinal'));

create function private.posicion_rama(p_pos integer,p_cruces integer) returns integer
language plpgsql immutable set search_path = '' as $$
declare v integer:=p_pos; r integer:=0; n integer:=p_cruces;
begin while n>1 loop r:=r*2+(v%2);v:=v/2;n:=n/2;end loop;return r+1;end;
$$;
create function private.repartir_cruces(p_entradas jsonb,p_cruces integer) returns jsonb
language sql immutable set search_path = '' as $$
 select jsonb_agg(jsonb_build_object('numero',n,'inscripciones',coalesce((select jsonb_agg(e order by pos)
 from jsonb_array_elements(p_entradas) with ordinality t(e,pos)
 where private.posicion_rama(((pos-1)%p_cruces)::integer,p_cruces)=n),'[]'::jsonb)) order by n)
 from generate_series(1,p_cruces) s(n);
$$;

create or replace function public.generar_sorteo(p_fecha_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; s public.sorteos%rowtype; entradas jsonb; plan jsonb;
 total integer; grupos integer; g integer; t integer; n integer; nt integer; base integer; resto integer;
 eg jsonb; et jsonb; gs jsonb:='[]'; ts jsonb; cursor_ integer;
begin
 perform private.exigir_organizacion_fecha(p_fecha_id);
 select * into f from public.fechas where id=p_fecha_id;
 select * into s from public.sorteos where fecha_id=p_fecha_id and vigente;
 if found then return to_jsonb(s); end if;
 if f.estado not in ('borrador','inscripciones') then raise exception 'La fecha no admite sortear.'; end if;
 if f.cupos is null then raise exception 'Elegí explícitamente la configuración de esta fecha histórica.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'nombre',i.nombre,'version',i.version,'integrantes',
   (select jsonb_agg(alias order by orden) from public.inscripcion_integrantes where inscripcion_id=i.id)) order by random()),'[]')
 into entradas from public.inscripciones i where fecha_id=p_fecha_id and activa;
 total:=jsonb_array_length(entradas);
 if total<2 and f.clasis_modo<>'siempre' then raise exception 'Necesitás al menos dos inscripciones activas.'; end if;
 if total=0 then raise exception 'Agregá al menos una inscripción para preparar las planillas.'; end if;
 plan:=jsonb_build_object('version_algoritmo',2,'total',total,'integrantes_por_equipo',f.integrantes_por_equipo,
 'fase_inicial',f.fase_inicial,'por_cruce',f.por_cruce,'clasifican',f.cupos,'maximo_tanda',f.maximo_tanda,
 'configuracion_version',f.configuracion_version);
 if total<=f.cupos and f.clasis_modo='automaticas' then
   plan:=plan||jsonb_build_object('tipo',f.fase_inicial,'cruces',private.repartir_cruces(entradas,case f.fase_inicial when 'octavos' then 8 else 16 end));
 else
   grupos:=coalesce(f.grupos_clasi,least(3,ceil(total::numeric/50)::integer));
   if grupos>total then raise exception 'La cantidad de grupos supera las inscripciones.'; end if;
   for g in 1..grupos loop
     select jsonb_agg(e order by pos) into eg from jsonb_array_elements(entradas) with ordinality x(e,pos) where (pos-1)%grupos=g-1;
     n:=jsonb_array_length(eg);nt:=ceil(n::numeric/f.maximo_tanda)::integer;base:=n/nt;resto:=n%nt;cursor_:=0;ts:='[]';
     for t in 1..nt loop
       select jsonb_agg(e order by pos) into et from jsonb_array_elements(eg) with ordinality x(e,pos)
         where pos>cursor_ and pos<=cursor_+base+case when t<=resto then 1 else 0 end;
       cursor_:=cursor_+base+case when t<=resto then 1 else 0 end;
       ts:=ts||jsonb_build_array(jsonb_build_object('numero',t,'inscripciones',et));
     end loop;
     gs:=gs||jsonb_build_array(jsonb_build_object('nombre',chr(64+g),'total',n,'tandas',ts));
   end loop;
   plan:=plan||jsonb_build_object('tipo','clasificatorias','grupos',gs);
 end if;
 insert into public.sorteos(fecha_id,plan,creado_por,eliminatorias_aleatorias) values(p_fecha_id,plan,auth.uid(),not f.llave_fija) returning * into s;
 return to_jsonb(s);
end;
$$;

create function private.crear_cuadro(p_sorteo uuid,p_entradas jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare f public.fechas%rowtype; s public.sorteos%rowtype; fase_ text; n integer; i integer; c jsonb; inicial text;
begin
 select * into s from public.sorteos where id=p_sorteo;
 select * into f from public.fechas where id=s.fecha_id;
 inicial:=coalesce(f.fase_inicial,'octavos');
 if jsonb_array_length(p_entradas)<2 then raise exception 'Se necesitan al menos dos inscripciones puntuadas para iniciar eliminatorias.'; end if;
 for c in select value from jsonb_array_elements(private.repartir_cruces(p_entradas,case inicial when 'octavos' then 8 else 16 end)) loop
   insert into public.cruces_eliminatorias(fecha_id,sorteo_id,fase,numero,entradas) values(f.id,s.id,inicial,(c->>'numero')::integer,c->'inscripciones');
 end loop;
 foreach fase_ in array case inicial when 'dieciseisavos' then array['octavos','cuartos','semifinal','final'] else array['cuartos','semifinal','final'] end loop
   n:=case fase_ when 'octavos' then 8 when 'cuartos' then 4 when 'semifinal' then 2 else 1 end;
   for i in 1..n loop insert into public.cruces_eliminatorias(fecha_id,sorteo_id,fase,numero) values(f.id,s.id,fase_,i);end loop;
 end loop;
 perform private.actualizar_llaves(s.id);
end;
$$;
create or replace function public.iniciar_eliminatorias(p_fecha_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.sorteos%rowtype; e jsonb;
begin
 perform private.exigir_organizacion_fecha(p_fecha_id);
 select * into s from public.sorteos where fecha_id=p_fecha_id and vigente;
 if not found then raise exception 'Generá el sorteo antes de comenzar.';end if;
 if exists(select 1 from public.cruces_eliminatorias where sorteo_id=s.id) then return s.id;end if;
 if s.plan->>'tipo'='clasificatorias' then raise exception 'Completá y cerrá las clasis primero.';end if;
 if (select estado from public.fechas where id=p_fecha_id) not in ('borrador','inscripciones') then raise exception 'La fecha ya comenzó.';end if;
 select jsonb_agg(x.value) into e from jsonb_array_elements(s.plan->'cruces') c cross join lateral jsonb_array_elements(c->'inscripciones') x;
 perform private.crear_cuadro(s.id,e);
 update public.fechas set estado='en_curso' where id=p_fecha_id;
 return s.id;
end;
$$;

-- Integridad de recursos con más de una referencia. También protege SQL futuro.
create function private.validar_recurso_fecha() returns trigger language plpgsql security definer set search_path = '' as $$
declare j jsonb:=to_jsonb(new); fecha_ uuid; e jsonb;
begin
 if j ? 'fecha_id' then fecha_:=(j->>'fecha_id')::uuid;
 elsif j ? 'grupo_id' then fecha_:=private.fecha_recurso('grupo',(j->>'grupo_id')::uuid);
 elsif j ? 'tanda_id' then fecha_:=private.fecha_recurso('tanda',(j->>'tanda_id')::uuid);end if;
 if j ? 'sorteo_id' and fecha_ is distinct from private.fecha_recurso('sorteo',(j->>'sorteo_id')::uuid) then raise exception 'Sorteo de otra fecha.';end if;
 if j ? 'cruce_id' and fecha_ is distinct from private.fecha_recurso('cruce',(j->>'cruce_id')::uuid) then raise exception 'Cruce de otra fecha.';end if;
 if j ? 'entradas' then
   for e in select value from jsonb_array_elements(j->'entradas') loop
     if fecha_ is distinct from private.fecha_recurso('inscripcion',(e->>'id')::uuid) then raise exception 'Inscripción de otra fecha.';end if;
   end loop;
 end if;
 if j->>'ganador_id' is not null and fecha_ is distinct from private.fecha_recurso('inscripcion',(j->>'ganador_id')::uuid) then raise exception 'Ganador de otra fecha.';end if;
 return new;
end;
$$;
do $$ declare tabla text;begin
 foreach tabla in array array['clasificatorias','cruces_eliminatorias','sorteos_fases_eliminatorias','historial_resultados_eliminatorias','tandas_clasificatorias'] loop
 execute format('create trigger integridad_fecha before insert or update on public.%I for each row execute function private.validar_recurso_fecha()',tabla);
 end loop;
end $$;

create or replace function private.actualizar_llaves(p_sorteo_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sorteos%rowtype; inicial text; fase_ text; anterior text; c public.cruces_eliminatorias%rowtype;
 e jsonb; listo_ boolean; n integer; res integer; estado_ text; ganador uuid; resolucion_ text;
begin
 select * into s from public.sorteos where id=p_sorteo_id;
 inicial:=coalesce(s.plan->>'fase_inicial','octavos');
 foreach fase_ in array array['dieciseisavos','octavos','cuartos','semifinal','final'] loop
   anterior:=case fase_ when 'octavos' then 'dieciseisavos' when 'cuartos' then 'octavos' when 'semifinal' then 'cuartos' when 'final' then 'semifinal' end;
   for c in select * from public.cruces_eliminatorias where sorteo_id=p_sorteo_id and fase=fase_ order by numero for update loop
     if c.estado<>'pendiente' then continue;end if;
     if fase_=inicial or (s.eliminatorias_aleatorias and fase_<>'final') then
       e:=c.entradas;listo_:=fase_=inicial or c.listo;
     else
       select count(*),count(*) filter(where estado<>'pendiente' and listo) into n,res from public.cruces_eliminatorias
         where sorteo_id=p_sorteo_id and fase=anterior and numero in(c.numero*2-1,c.numero*2);
       listo_:=n=2 and res=2;
       select coalesce(jsonb_agg(v order by x.numero),'[]') into e from public.cruces_eliminatorias x
         cross join lateral jsonb_array_elements(x.entradas) v where x.sorteo_id=p_sorteo_id and x.fase=anterior
         and x.numero in(c.numero*2-1,c.numero*2) and x.estado='resuelto' and (v->>'id')::uuid=x.ganador_id;
     end if;
     estado_:='pendiente';ganador:=null;resolucion_:=null;
     if listo_ and jsonb_array_length(e)<=1 then
       estado_:=case jsonb_array_length(e) when 0 then 'vacante' else 'resuelto' end;
       ganador:=(e->0->>'id')::uuid;resolucion_:='automatica';
     end if;
     if c.entradas is distinct from e or c.listo is distinct from listo_ or c.estado<>estado_ then
       update public.cruces_eliminatorias set entradas=e,listo=listo_,estado=estado_,ganador_id=ganador,resolucion=resolucion_,
         confirmado_en=case when estado_<>'pendiente' then now() end,version=version+1 where id=c.id;
     end if;
   end loop;
 end loop;
end;
$$;

revoke all on function private.posicion_rama(integer,integer),private.repartir_cruces(jsonb,integer),private.crear_cuadro(uuid,jsonb),private.validar_recurso_fecha() from public,anon,authenticated;
revoke all on function public.guardar_planilla_fase(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.guardar_planilla_fase(uuid,text,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;
