import { readFileSync,writeFileSync } from 'node:fs';
const source=readFileSync('supabase/migrations/014_ranking_y_pase_a_octavos.sql','utf8').replace(/\r/g,'');
const fn=(name)=>source.match(new RegExp(`create function ${name.replaceAll('.','\\.')}\\([\\s\\S]*?\\$\\$;`))[0].replace('create function','create or replace function');
let ranking=fn('private.datos_ranking_clasi');
ranking=ranking.replace('else false end) as valida',"else jsonb_typeof(p.value) = 'null' end) as valida");
ranking=ranking.replace('sum(total_jurado) as total,',`sum(total_jurado) as total,
      count(*) filter(where voto_estado='finalizada')::integer as entregados,`);
ranking=ranking.replace('coalesce(d.finalizados, 0) as jurados_finalizados', 'coalesce(d.entregados, 0) as jurados_finalizados');
ranking=ranking.replaceAll('d.finalizados = e.esperados','d.entregados = e.esperados');
ranking=ranking.replace('case when completa then rank()', 'case when completa and puntos is not null then rank()');
ranking=ranking.replace('and r.total = r.distintos and r.total >= c.clasifican','and r.total = r.distintos');
ranking=ranking.replace('where d.lista order by', 'where d.lista and o.puntos is not null order by');
ranking=ranking.replace('offset (select greatest(clasifican - 1, 0) from configuracion)',`offset (select greatest(least(c.clasifican,(select count(*) from ordenadas where puntos is not null)) - 1,0) from configuracion c)`);
ranking=ranking.replace("'casillas', c.casillas, 'total'",`'fase_inicial', coalesce((select fase_inicial from public.fechas where id=c.fecha_id),'octavos'),
  'efectivos',least(c.clasifican,(select count(*) from ordenadas where puntos is not null)),
  'puntuados',(select count(*) from ordenadas where puntos is not null),
  'casillas', c.casillas, 'total'`);
ranking=ranking.replace("'completa', o.completa, 'puntos', o.puntos,",`'completa', o.completa, 'puntos', o.puntos,
    'sin_puntuar',o.completa and o.puntos is null,
    'casillas_vacias',exists(select 1 from public.votaciones_clasificatorias v
      cross join lateral jsonb_array_elements(v.puntuaciones) f
      cross join lateral jsonb_array_elements(f->'casillas') p
      where v.tanda_id=o.tanda_id and v.estado='finalizada' and f->>'inscripcion_id'=o.inscripcion_id and p='null'::jsonb),`);
ranking=ranking.replaceAll('c.clasifican - jsonb_array_length(k.directos)',`least(c.clasifican,(select count(*) from ordenadas where puntos is not null)) - jsonb_array_length(k.directos)`);
let cierre=fn('public.cerrar_clasificatorias_y_sortear_octavos');
cierre=cierre.replaceAll('private.es_organizacion()',"private.exigir_organizacion_fecha(private.fecha_recurso('clasi',p_clasificatoria_id))");
cierre=cierre.replaceAll('> 28','> 64');
cierre=cierre.replace(/  if v_clasi.clasifican not between 2 and 28 then[\s\S]*?  end if;\n/,'');
cierre=cierre.replace('cardinality(v_ids) <> v_clasi.clasifican',"cardinality(v_ids) <> (v_ranking->>'efectivos')::integer");
const start=cierre.indexOf('  for i in 1..least(');
const end=cierre.indexOf('  insert into public.cierres_clasificatorias',start);
cierre=cierre.slice(0,start)+`  if cardinality(v_ids)<2 then raise exception 'Se necesitan al menos dos inscripciones puntuadas para iniciar eliminatorias.';end if;
  perform private.crear_cuadro(v_clasi.sorteo_id,v_aleatorios);
`+cierre.slice(end);
writeFileSync('supabase/migrations/019_ranking_con_vacios.sql',`begin;\n-- Generado por scripts/generar-ranking-correctivo.mjs.\n${ranking}\n${cierre}\ncommit;\n`);

// Generalización de sorteo posterior y corrección conservando idempotencia.
const extra=[];
for(const [file,name] of [['009_sorteos_por_fase.sql','sortear_fase_eliminatoria'],['010_correccion_resultados.sql','deshacer_resultado_cruce']]) {
 let sql=readFileSync(`supabase/migrations/${file}`,'utf8').replace(/\r/g,'').match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0];
 sql=sql.replaceAll('private.es_organizacion()',name==='sortear_fase_eliminatoria'?'private.exigir_organizacion_fecha(p_fecha_id)':"private.exigir_organizacion_fecha(private.fecha_recurso('cruce',p_cruce_id))");
 if(name==='sortear_fase_eliminatoria') {
   sql=sql.replace("not in ('cuartos', 'semifinal')","not in ('octavos','cuartos', 'semifinal')");
   sql=sql.replace("v_anterior := case p_fase", "v_anterior := case p_fase\n    when 'octavos' then 'dieciseisavos'");
   sql=sql.replace("v_esperados := case p_fase", "v_esperados := case p_fase\n    when 'octavos' then 16");
   sql=sql.replace("v_destinos := case p_fase", "v_destinos := case p_fase\n    when 'octavos' then 8");
   // Una fase puede recibir un único ganador y avanzar con pases libres.
   sql=sql.replace('jsonb_array_length(v_participantes) < 2','jsonb_array_length(v_participantes) < 1');
 } else {
   sql=sql.replaceAll("when 'octavos' then 1", "when 'dieciseisavos' then 0\n            when 'octavos' then 1");
   sql=sql.replace("v_siguiente := case v_cruce.fase", "v_siguiente := case v_cruce.fase\n      when 'dieciseisavos' then 'octavos'");
 }
 extra.push(sql);
}
writeFileSync('supabase/migrations/020_fases_generalizadas.sql',`begin;\n${extra.join('\n')}\ncommit;\n`);
