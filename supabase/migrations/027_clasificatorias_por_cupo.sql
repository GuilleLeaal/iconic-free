begin;
-- El modo histórico se conserva por compatibilidad; los sorteos nuevos dependen del cupo.
-- Los sorteos guardados y las puntuaciones existentes se conservan.
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
 if total<2 then raise exception 'Necesitás al menos dos inscripciones activas.'; end if;
 if total=0 then raise exception 'Agregá al menos una inscripción para preparar las planillas.'; end if;
 plan:=jsonb_build_object('version_algoritmo',2,'total',total,'integrantes_por_equipo',f.integrantes_por_equipo,
 'fase_inicial',f.fase_inicial,'por_cruce',f.por_cruce,'clasifican',f.cupos,'maximo_tanda',f.maximo_tanda,
 'configuracion_version',f.configuracion_version);
 if total<=f.cupos then
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


commit;

