import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
import { nuevaBase,como } from './database.mjs';
const db=await nuevaBase(15);
const ids=Object.fromEntries(['admin','a','b','j1','j2','sin'].map(n=>[n,randomUUID()]));
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const valor=async(sql,args=[]) => Object.values((await q(sql,args))[0])[0];
const rpc=(name,args=[])=>valor(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args);
for(const [nombre,id] of Object.entries(ids)) await q('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`${nombre}@test.local`,{nombre}]);
await q("update public.perfiles set rol='organizacion' where id=$1",[ids.a]);
const historica=await valor("insert into public.fechas(nombre,creado_por) values('Histórica',$1) returning id",[ids.admin]);
for(const file of readdirSync('supabase/migrations').filter(f=>Number(f.slice(0,3))>=16 && Number(f.slice(0,3))<=26).sort()) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
console.log('PASS actualización 001–015 → nuevas migraciones');
await assert.rejects(como(db,ids.admin,()=>rpc('crear_competencia',['No autorizado aún'])));
await assert.rejects(q("select private.instalar_iconic($1,'correo-equivocado@test.local')",[ids.admin]));
const iconic=await valor('select private.instalar_iconic($1,$2)',[ids.admin,'admin@test.local']);
assert.equal(await valor('select competencia_id from public.fechas where id=$1',[historica]),iconic);
assert.equal(await valor('select fase_inicial from public.fechas where id=$1',[historica]),null);
await assert.rejects(como(db,ids.a,()=>rpc('crear_competencia',['Otra'])));
await assert.rejects(como(db,ids.a,()=>q('select private.instalar_iconic($1,$2)',[ids.a,'a@test.local'])));
const otra=await como(db,ids.admin,()=>rpc('crear_competencia',['Otra']));
await q("insert into public.vinculos_competencia(competencia_id,usuario_id,rol,estado) values($1,$2,'organizacion','activo'),($3,$4,'jurado','activo'),($3,$5,'jurado','activo')",[otra,ids.b,iconic,ids.j1,ids.j2]);
async function fecha(comp,opciones={}) {
 const { fase='octavos',por=2,modo='automaticas',max=5,grupos=null,fija=false,jurados=2,integrantes=1 }=opciones;
 return valor(`insert into public.fechas(competencia_id,nombre,creado_por,fase_inicial,por_cruce,clasis_modo,maximo_tanda,grupos_clasi,llave_fija,jurados_por_grupo_clasi,integrantes_por_equipo)
 values($1,'Fecha de prueba',$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,[comp,ids.admin,fase,por,modo,max,grupos,fija,jurados,integrantes]);
}
async function inscribir(f,n,actor=ids.a,integrantes=1) {
 for(let i=0;i<n;i++) await como(db,actor,()=>rpc('crear_inscripcion',[f,`Equipo ${i}`,Array.from({length:integrantes},(_,j)=>`Alias ${i}/${j}`)]));
}
const fb=await fecha(otra);
await inscribir(fb,2,ids.b);
for(const actor of [ids.a,ids.j1,ids.sin]) {
 await como(db,actor,async()=>{
   assert.equal((await q('select * from public.fechas where id=$1',[fb])).length,0);
   assert.equal((await q('select * from public.inscripciones where fecha_id=$1',[fb])).length,0);
   await assert.rejects(rpc('generar_sorteo',[fb]));
   await assert.rejects(rpc('crear_inscripcion',[fb,'Intruso',['Intruso']]));
   await assert.rejects(rpc('buscar_cuentas',[otra,'',null,0]));
 });
}
assert.equal((await como(db,ids.sin,()=>q('select * from public.fechas'))).length,0);
const ib=await valor('select id from public.inscripciones where fecha_id=$1 limit 1',[fb]);
await assert.rejects(como(db,ids.a,()=>rpc('modificar_inscripcion',[ib,1,'editar','intruso',['intruso']])));
console.log('PASS bootstrap explícito, sin autopromoción, RLS y RPC directas entre competencias');

for(const fase of ['octavos','dieciseisavos']) for(const por of [2,3,4]) {
 const cupos=(fase==='octavos'?8:16)*por;
 for(const n of [Math.max(2,cupos-1),cupos,cupos+1]) {
   const f=await fecha(iconic,{fase,por});await inscribir(f,n);
   const sorteo=await como(db,ids.a,()=>rpc('generar_sorteo',[f]));
   assert.equal(sorteo.plan.tipo,n>cupos?'clasificatorias':fase);
   assert.equal(sorteo.plan.clasifican,cupos);
   const repetido=await como(db,ids.a,()=>rpc('generar_sorteo',[f]));assert.equal(repetido.id,sorteo.id);
   if(n<=cupos) {
     assert.equal(sorteo.plan.cruces.length,cupos/por);
     assert.equal(sorteo.plan.cruces.flatMap(c=>c.inscripciones).length,n);
     assert.ok(sorteo.plan.cruces.every(c=>c.inscripciones.length<=por));
   }
 }
}
const f20=await fecha(iconic);await inscribir(f20,20);assert.equal((await como(db,ids.a,()=>rpc('generar_sorteo',[f20]))).plan.tipo,'clasificatorias');
console.log('PASS seis combinaciones y cantidades debajo/en/encima del cupo; 20/16 y más de 28/32');

const fc=await fecha(iconic,{modo:'siempre',max:2,grupos:2,por:4});await inscribir(fc,5);
await como(db,ids.a,async()=>{
 await rpc('guardar_planilla_fecha',[fc,'clasificatorias',['Métrica','Respuesta'],0]);
 for(const g of ['a','b']) for(const j of ['j1','j2']) await rpc('configurar_jurado_fecha',[fc,ids[j],`clasi_${g}`,true]);
});
const sc=await como(db,ids.a,()=>rpc('generar_sorteo',[fc]));
assert.ok(sc.plan.grupos.every(g=>g.tandas.every(t=>t.inscripciones.length<=2)));
const clasi=await como(db,ids.a,()=>rpc('iniciar_clasificatorias',[fc]));
const tandas=await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id where g.clasificatoria_id=$1 order by t.id',[clasi]);
await assert.rejects(como(db,ids.a,()=>rpc('configurar_jurado_fecha',[fc,ids.j1,'clasi_a',false])));
let primerId=tandas[0].entradas[0].id;
let segundoId=tandas.flatMap(t=>t.entradas).find(e=>e.id!==primerId).id;
for(const t of tandas) for(const j of ['j1','j2']) {
 const puntos=t.entradas.map(e=>({inscripcion_id:e.id,casillas:e.id===primerId?[0,null]:e.id===segundoId?[2.5,1]:[null,null]}));
 const version=await como(db,ids[j],()=>rpc('guardar_votacion_clasificatoria',[t.id,puntos,0,true]));
 assert.equal(await como(db,ids[j],()=>rpc('guardar_votacion_clasificatoria',[t.id,puntos,0,true])),version);
 await assert.rejects(como(db,ids[j],()=>rpc('guardar_votacion_clasificatoria',[t.id,puntos.map(p=>({...p,casillas:[4,4]})),version,true])));
}
let ranking=await como(db,ids.a,()=>rpc('consultar_ranking_clasificatoria',[clasi]));
assert.equal(ranking.lista_para_cerrar,true);assert.equal(ranking.efectivos,2);
assert.equal(ranking.filas.find(f=>f.inscripcion_id===primerId).puntos,0);
assert.equal(ranking.filas.find(f=>f.inscripcion_id===segundoId).puntos,7);
assert.ok(ranking.filas.filter(f=>f.sin_puntuar).every(f=>f.puesto===null && f.puntos===null && f.completa));
assert.equal((await como(db,ids.j1,()=>q('select * from public.votaciones_clasificatorias where jurado_id=$1',[ids.j2]))).length,0);
await assert.rejects(como(db,ids.j1,()=>rpc('consultar_ranking_clasificatoria',[clasi])));
await assert.rejects(como(db,ids.j1,()=>rpc('retirar_participante_clasi',[tandas[0].id,primerId,1])));
const config={fase_inicial:'octavos',por_cruce:2,clasis_modo:'siempre',grupos_clasi:2,maximo_tanda:2,llave_fija:false};
await como(db,ids.a,()=>rpc('configurar_fecha',[fc,config,1,false]));
await assert.rejects(como(db,ids.a,()=>rpc('cerrar_clasificatorias_y_sortear_octavos',[clasi,ranking.version,[],null])));
const r2=await como(db,ids.a,()=>rpc('consultar_ranking_clasificatoria',[clasi]));assert.notEqual(r2.version,ranking.version);
assert.equal(r2.filas.find(f=>f.inscripcion_id===segundoId).puntos,7);
const cierre=await como(db,ids.a,()=>rpc('cerrar_clasificatorias_y_sortear_octavos',[clasi,r2.version,[],null]));
assert.equal(await como(db,ids.a,()=>rpc('cerrar_clasificatorias_y_sortear_octavos',[clasi,r2.version,[],null])),cierre);
await assert.rejects(como(db,ids.a,()=>rpc('configurar_fecha',[fc,{...config,por_cruce:3},2,false])));
console.log('PASS planillas parciales/vacías, cero/null, versiones, privacidad, cambio de cupo sin perder puntos y cierre idempotente');

await como(db,ids.a,()=>rpc('cambiar_vinculo',[iconic,ids.j1,'jurado','inactivo']));
await assert.rejects(como(db,ids.j1,()=>rpc('consultar_tandas_jurado',[tandas[0].grupo_id])));
assert.equal((await como(db,ids.j1,()=>q('select * from public.votaciones_clasificatorias'))).length,0);
assert.ok((await q('select * from public.votaciones_clasificatorias where jurado_id=$1',[ids.j1])).length>0);
await assert.rejects(como(db,ids.a,()=>rpc('cambiar_vinculo',[iconic,ids.b,'organizacion','activo'])));
// Organizador de A que también juzga B: solo asignaciones autorizadas de B.
await q("insert into public.vinculos_competencia values($1,$2,'jurado','activo',now())",[otra,ids.a]);
const ctx=await como(db,ids.a,()=>rpc('mis_contextos'));assert.equal(ctx.administrador,false);assert.equal(ctx.competencias.length,2);
await assert.rejects(como(db,ids.a,()=>rpc('generar_sorteo',[fb])));
console.log('PASS revocación con sesión vieja sin borrar votos y roles por contexto');

const invite1=await como(db,ids.a,()=>rpc('preparar_invitacion',[iconic,' SIN@test.local ','jurado']));
assert.equal(await como(db,ids.a,()=>rpc('preparar_invitacion',[iconic,'sin@test.local','jurado'])),invite1);
await assert.rejects(como(db,ids.a,()=>rpc('preparar_invitacion',[iconic,'sin@test.local','organizacion'])));
await assert.rejects(como(db,ids.j2,()=>rpc('aceptar_invitacion',[invite1])));
await como(db,ids.sin,()=>rpc('aceptar_invitacion',[invite1]));
assert.equal((await como(db,ids.sin,()=>rpc('mis_contextos'))).competencias.length,1);
// El rol histórico organizacion no impide juzgar en otra competencia.
const multi=await fecha(otra,{modo:'siempre',jurados:1});await inscribir(multi,2,ids.b);
await como(db,ids.b,async()=>{await rpc('guardar_planilla_fecha',[multi,'clasificatorias',['Puntos'],0]);await rpc('configurar_jurado_fecha',[multi,ids.a,'clasi_a',true]);await rpc('generar_sorteo',[multi]);});
const mc=await como(db,ids.b,()=>rpc('iniciar_clasificatorias',[multi]));
const mt=(await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id where g.clasificatoria_id=$1',[mc]))[0];
await como(db,ids.a,()=>rpc('consultar_tandas_jurado',[mt.grupo_id]));
await como(db,ids.a,()=>rpc('guardar_votacion_clasificatoria',[mt.id,mt.entradas.map(e=>({inscripcion_id:e.id,casillas:[0]})),0,true]));
const copiaSolicitud=randomUUID();
const copia=await como(db,ids.a,()=>rpc('copiar_configuracion_fecha',[fc,'Nueva edición',copiaSolicitud]));
assert.equal(await como(db,ids.a,()=>rpc('copiar_configuracion_fecha',[fc,'Nueva edición',copiaSolicitud])),copia);
assert.equal(await valor('select count(*)::int from public.inscripciones where fecha_id=$1',[copia]),0);
assert.equal(await valor('select count(*)::int from public.jurados_fecha where fecha_id=$1',[copia]),0);
assert.equal(await valor('select count(*)::int from public.planillas_fecha where fecha_id=$1',[copia]),1);
await assert.rejects(como(db,ids.b,()=>rpc('copiar_configuracion_fecha',[fc,'Robo',randomUUID()])));
console.log('PASS invitaciones normalizadas, aceptación personal y copia sin actividad ni identidades');

for(const fase of ['octavos','dieciseisavos']) for(const fija of [false,true]) {
 const f=await fecha(iconic,{fase,fija,integrantes:2});await inscribir(f,5,ids.a,2);
 await como(db,ids.a,()=>rpc('generar_sorteo',[f]));
 const sid=await como(db,ids.a,()=>rpc('iniciar_eliminatorias',[f]));
 for(const faseActual of (fase==='octavos'?['octavos','cuartos','semifinal','final']:['dieciseisavos','octavos','cuartos','semifinal','final'])) {
   let cruces=await q('select * from public.cruces_eliminatorias where sorteo_id=$1 and fase=$2 order by numero',[sid,faseActual]);
   if(cruces.some(c=>!c.listo) && !fija && faseActual!=='final') await como(db,ids.a,()=>rpc('sortear_fase_eliminatoria',[f,faseActual]));
   if(!fija && faseActual!==fase && faseActual!=='final') {
     const previo=await valor('select participantes from public.sorteos_fases_eliminatorias where sorteo_id=$1 and fase=$2',[sid,faseActual]);
     await como(db,ids.a,()=>rpc('sortear_fase_eliminatoria',[f,faseActual]));
     assert.deepEqual(await valor('select participantes from public.sorteos_fases_eliminatorias where sorteo_id=$1 and fase=$2',[sid,faseActual]),previo);
   }
   cruces=await q('select * from public.cruces_eliminatorias where sorteo_id=$1 and fase=$2 order by numero',[sid,faseActual]);
   for(const c of cruces) if(c.estado==='pendiente') {
     assert.ok(c.listo);assert.ok(c.entradas.length>=2);
     await como(db,ids.a,()=>rpc('confirmar_ganador_cruce',[c.id,c.entradas[0].id,c.version]));
   }
 }
 assert.equal(await valor('select estado from public.fechas where id=$1',[f]),'finalizada');
 assert.ok(await valor("select ganador_id from public.cruces_eliminatorias where sorteo_id=$1 and fase='final'",[sid]));
 const final= (await q("select * from public.cruces_eliminatorias where sorteo_id=$1 and fase='final'",[sid]))[0];
 if(final.resolucion==='manual') {
   await como(db,ids.a,()=>rpc('deshacer_resultado_cruce',[final.id,final.version]));
   const actual=(await q('select * from public.cruces_eliminatorias where id=$1',[final.id]))[0];
   await como(db,ids.a,()=>rpc('confirmar_ganador_cruce',[final.id,actual.entradas[1].id,actual.version]));
   assert.equal(await valor('select estado from public.fechas where id=$1',[f]),'finalizada');
 }
}
console.log('PASS recorrido hasta campeón, equipos, pases libres, ambas fases iniciales y modalidades');

// Edición pendiente: ninguna combinación inválida llega al sorteo vigente.
const fp=await fecha(iconic,{por:4});await inscribir(fp,21);const pendiente=await como(db,ids.a,()=>rpc('generar_sorteo',[fp]));
const configPendiente={...config,clasis_modo:'automaticas',grupos_clasi:null,maximo_tanda:5,por_cruce:3};
await assert.rejects(como(db,ids.a,()=>rpc('configurar_fecha',[fp,configPendiente,1,false])),/regeneración/);
await como(db,ids.a,()=>rpc('configurar_fecha',[fp,configPendiente,1,true]));
assert.equal(await valor('select vigente from public.sorteos where id=$1',[pendiente.id]),false);
assert.equal(await valor('select count(*)::int from public.sorteos where fecha_id=$1 and vigente',[fp]),1);
assert.equal(await valor('select count(*)::int from public.historial_configuracion_fecha where fecha_id=$1',[fp]),1);
assert.equal(await como(db,ids.a,()=>rpc('configurar_fecha',[fp,configPendiente,1,true])),2);
await assert.rejects(como(db,ids.a,()=>rpc('configurar_fecha',[fp,{...configPendiente,por_cruce:5},2,true])));
await assert.rejects(como(db,ids.a,()=>rpc('configurar_fecha',[fp,{...configPendiente,maximo_tanda:0},2,true])));
console.log('PASS formato pendiente: confirmación puntual, historial, regeneración atómica y reintento');

// Cero o una inscripción puntuada permite entregar todo, pero no un cuadro inválido.
for(const puntuados of [0,1]) {
 const f=await fecha(iconic,{modo:'siempre',max:1,jurados:1});await inscribir(f,2);
 await como(db,ids.a,async()=>{
   await rpc('guardar_planilla_fecha',[f,'clasificatorias',['Puntos'],0]);
   await rpc('configurar_jurado_fecha',[f,ids.j2,'clasi_a',true]);await rpc('generar_sorteo',[f]);
 });
 const ci=await como(db,ids.a,()=>rpc('iniciar_clasificatorias',[f]));
 const ts=await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id where g.clasificatoria_id=$1',[ci]);
 for(const [i,t] of ts.entries()) await como(db,ids.j2,()=>rpc('guardar_votacion_clasificatoria',[t.id,t.entradas.map(e=>({inscripcion_id:e.id,casillas:[i<puntuados?0:null]})),0,true]));
 const r=await como(db,ids.a,()=>rpc('consultar_ranking_clasificatoria',[ci]));assert.equal(r.lista_para_cerrar,true);assert.equal(r.efectivos,puntuados);
 await assert.rejects(como(db,ids.a,()=>rpc('cerrar_clasificatorias_y_sortear_octavos',[ci,r.version,[],null])),/al menos dos/);
}
// Altas tardías: el máximo menor a cinco rige en servidor y respeta borradores.
const fl=await fecha(iconic,{modo:'siempre',max:2,jurados:1});await inscribir(fl,3);
await como(db,ids.a,async()=>{await rpc('guardar_planilla_fecha',[fl,'clasificatorias',['Puntos'],0]);await rpc('configurar_jurado_fecha',[fl,ids.j2,'clasi_a',true]);await rpc('generar_sorteo',[fl]);});
const cl=await como(db,ids.a,()=>rpc('iniciar_clasificatorias',[fl]));
const tl=await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id where g.clasificatoria_id=$1',[cl]);
const pequena=tl.find(t=>t.entradas.length===1);
await como(db,ids.j2,()=>rpc('guardar_votacion_clasificatoria',[pequena.id,pequena.entradas.map(e=>({inscripcion_id:e.id,casillas:[3]})),0,false]));
const solicitud=randomUUID();
const alta=await como(db,ids.j2,()=>rpc('agregar_participante_clasi',[pequena.grupo_id,pequena.id,'Tardío',['Tardío'],solicitud]));
assert.deepEqual(await como(db,ids.j2,()=>rpc('agregar_participante_clasi',[pequena.grupo_id,pequena.id,'Tardío',['Tardío'],solicitud])),alta);
await assert.rejects(como(db,ids.j2,()=>rpc('agregar_participante_clasi',[pequena.grupo_id,pequena.id,'Exceso',['Exceso'],randomUUID()])),/máximo/);
const guardado=await valor('select puntuaciones from public.votaciones_clasificatorias where tanda_id=$1',[pequena.id]);assert.equal(guardado[0].casillas[0],3);assert.equal(guardado[1].casillas[0],null);
await assert.rejects(como(db,ids.j2,()=>rpc('guardar_votacion_clasificatoria',[pequena.id,guardado,1,true])),/otro dispositivo/);
await como(db,ids.j2,()=>rpc('guardar_votacion_clasificatoria',[pequena.id,guardado,2,true]));
await assert.rejects(como(db,ids.j2,()=>rpc('agregar_participante_clasi',[pequena.grupo_id,pequena.id,'Finalizada',['Finalizada'],randomUUID()])));
console.log('PASS cero/una puntuadas, máximo por tanda, alta tardía idempotente y borrador/versiones conservados');

// Un repechaje obsoleto no se puede confirmar después de ampliar el cupo.
const fr=await fecha(iconic,{modo:'siempre',jurados:1});await inscribir(fr,17);
await como(db,ids.a,async()=>{await rpc('guardar_planilla_fecha',[fr,'clasificatorias',['Puntos'],0]);await rpc('configurar_jurado_fecha',[fr,ids.j2,'clasi_a',true]);await rpc('generar_sorteo',[fr]);});
const cr=await como(db,ids.a,()=>rpc('iniciar_clasificatorias',[fr]));
for(const t of await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id where g.clasificatoria_id=$1',[cr])) await como(db,ids.j2,()=>rpc('guardar_votacion_clasificatoria',[t.id,t.entradas.map(e=>({inscripcion_id:e.id,casillas:[1]})),0,true]));
const empate=await como(db,ids.a,()=>rpc('consultar_ranking_clasificatoria',[cr]));assert.equal(empate.corte.requiere_desempate,true);assert.equal(empate.corte.cupos,16);
await como(db,ids.a,()=>rpc('configurar_fecha',[fr,{...configPendiente,clasis_modo:'siempre'},1,false]));
await assert.rejects(como(db,ids.a,()=>rpc('cerrar_clasificatorias_y_sortear_octavos',[cr,empate.version,empate.corte.empatados.slice(0,16),'Ganaron el repechaje'])),/La tabla cambió/);
const ampliada=await como(db,ids.a,()=>rpc('consultar_ranking_clasificatoria',[cr]));assert.equal(ampliada.efectivos,17);assert.equal(ampliada.corte.requiere_desempate,false);
await como(db,ids.a,()=>rpc('cerrar_clasificatorias_y_sortear_octavos',[cr,ampliada.version,[],null]));
console.log('PASS cambio de cupo conserva clasis, invalida selección vieja y elimina repechaje artificial');

// Directorio limitado y filtrado por servidor; jamás descargar para buscar.
for(let i=0;i<25;i++) {const id=randomUUID();await q('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,`extra${i}@test.local`,{nombre:`Extra ${i}`}]);await q("insert into public.vinculos_competencia values($1,$2,'jurado','activo',now())",[iconic,id]);}
const p1=await como(db,ids.a,()=>rpc('buscar_jurados_competencia',[iconic,'Extra',0]));const p2=await como(db,ids.a,()=>rpc('buscar_jurados_competencia',[iconic,'Extra',1]));assert.equal(p1.filas.length,20);assert.equal(p1.hay_mas,true);assert.equal(p2.filas.length,5);assert.equal(p2.hay_mas,false);
const dir=await como(db,ids.a,()=>rpc('buscar_cuentas',[iconic,'Extra',null,0]));assert.ok(dir.filas.every(c=>c.email===null && c.vinculos.every(v=>v.competencia_id===iconic)));
const invitacionPendiente=await como(db,ids.a,()=>rpc('preparar_invitacion',[iconic,'b@test.local','jurado']));
assert.ok((await como(db,ids.a,()=>rpc('buscar_invitaciones',[iconic,'b@test',0]))).filas.some(i=>i.id===invitacionPendiente));
await assert.rejects(como(db,ids.b,()=>rpc('buscar_invitaciones',[iconic,'',0])));
await assert.rejects(como(db,ids.a,()=>rpc('reservar_envio_invitacion',[invitacionPendiente,ids.admin,false])));
await como(db,ids.a,()=>rpc('cancelar_invitacion',[invitacionPendiente]));
await assert.rejects(como(db,ids.b,()=>rpc('aceptar_invitacion',[invitacionPendiente])));
assert.equal(await como(db,ids.a,()=>rpc('preparar_invitacion',[iconic,'B@test.local','jurado'])),invitacionPendiente);
await db.exec('set role service_role');
const reserva=await rpc('reservar_envio_invitacion',[invitacionPendiente,ids.a,false]);assert.equal(reserva.existe,true);
await assert.rejects(rpc('reservar_envio_invitacion',[invitacionPendiente,ids.a,false]),/envío en curso/);
await rpc('registrar_envio_invitacion',[invitacionPendiente,reserva.lease,true]);
assert.equal((await rpc('reservar_envio_invitacion',[invitacionPendiente,ids.a,false])).enviada,true);
await db.exec('reset role');
await como(db,ids.b,()=>rpc('aceptar_invitacion',[invitacionPendiente]));
const inactivos=await como(db,ids.admin,()=>rpc('buscar_cuentas',[null,'j1','inactivo',0]));assert.equal(inactivos.filas.length,1);
console.log('PASS invitaciones pendientes, cancelación/renovación, reserva exclusiva de servidor y respuesta perdida');
// Integridad incluso con un escritor privilegiado y IDs mezclados.
await assert.rejects(q("insert into public.cruces_eliminatorias(fecha_id,sorteo_id,fase,numero,entradas) values($1,$2,'octavos',1,'[]')",[fb,pendiente.id]),/otra fecha|foreign key/);
const accesibles=await q("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')");assert.equal(accesibles.length,0);
await assert.rejects(como(db,ids.a,()=>q("select private.fecha_recurso('inscripcion',$1)",[ib])));
await db.exec(readFileSync('supabase/preflight.sql','utf8'));
console.log('PASS directorio paginado, ocultación de vínculos ajenos, IDs mezclados, ACL y preflight de solo lectura');
const fSeis=await fecha(iconic);
const configSeis={fase_inicial:'octavos',por_cruce:2,clasis_modo:'siempre',grupos_clasi:1,maximo_tanda:6,llave_fija:false};
assert.equal(await como(db,ids.a,()=>rpc('configurar_fecha',[fSeis,configSeis,1,false])),2);
await assert.rejects(como(db,ids.a,()=>rpc('configurar_fecha',[fSeis,{...configSeis,maximo_tanda:7},2,false])),/Configuración incompatible/);
await assert.rejects(fecha(iconic,{max:7}));
await inscribir(fSeis,18);
const sorteoSeis=await como(db,ids.a,()=>rpc('generar_sorteo',[fSeis]));
const tandasSeis=sorteoSeis.plan.grupos.flatMap(g=>g.tandas);
assert.equal(tandasSeis.length,3);
assert.ok(tandasSeis.every(t=>t.inscripciones.length===6));
console.log('PASS máximo de seis: configuración, rechazo de siete y sorteo de tres tandas de seis');
// Comprobar la actualización sobre fechas y clasificatorias históricas ya activas.
const votosAntes027=await q('select * from public.votaciones_clasificatorias order by id');
await db.exec(readFileSync('supabase/migrations/027_clasificatorias_por_cupo.sql','utf8'));
assert.deepEqual(await q('select * from public.votaciones_clasificatorias order by id'),votosAntes027);
for(const modo of ['automaticas','siempre']) for(const n of [12,16,17]) {
 const f=await fecha(iconic,{modo});await inscribir(f,n);
 const s=await como(db,ids.a,()=>rpc('generar_sorteo',[f]));
 assert.equal(s.plan.tipo,n>16?'clasificatorias':'octavos');
 assert.equal((await como(db,ids.a,()=>rpc('generar_sorteo',[f]))).id,s.id);
}
const una=await fecha(iconic,{modo:'siempre'});await inscribir(una,1);
await assert.rejects(como(db,ids.a,()=>rpc('generar_sorteo',[una])),/al menos dos/);
console.log('PASS 027: clasificatorias solo por exceso de cupo en ambos modos históricos; conserva votos y sorteos existentes');
await db.exec(readFileSync('supabase/migrations/028_retiro_por_ausencia_con_contexto.sql','utf8'));
const juradoRetiro=randomUUID();await q('insert into auth.users(id,email) values($1,$2)',[juradoRetiro,'retiro@test.local']);
await q("insert into public.vinculos_competencia(competencia_id,usuario_id,rol,estado) values($1,$2,'jurado','activo')",[iconic,juradoRetiro]);
const fRetiro=await fecha(iconic,{max:6,jurados:2});await inscribir(fRetiro,17);
await como(db,ids.a,async()=>{
 await rpc('guardar_planilla_fecha',[fRetiro,'clasificatorias',['Puntos'],0]);
 for(const j of [ids.j2,juradoRetiro]) await rpc('configurar_jurado_fecha',[fRetiro,j,'clasi_a',true]);
 await rpc('generar_sorteo',[fRetiro]);await rpc('iniciar_clasificatorias',[fRetiro]);
});
const tsRetiro=await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id join public.clasificatorias c on c.id=g.clasificatoria_id where c.fecha_id=$1 order by t.numero',[fRetiro]);
const tr=tsRetiro[0], retirarId=tr.entradas[0].id;
for(const j of [ids.j2,juradoRetiro]) await como(db,j,()=>rpc('guardar_votacion_clasificatoria',[tr.id,tr.entradas.map((e,i)=>({inscripcion_id:e.id,casillas:[i===1?0:3.5]})),0,false]));
const antesRetiro=await q('select * from public.votaciones_clasificatorias where tanda_id=$1 order by id',[tr.id]);
for(const actor of [ids.a,ids.b,ids.sin,ids.j1]) await assert.rejects(como(db,actor,()=>rpc('retirar_participante_clasi',[tr.id,retirarId,tr.version])),/asignado|revocado/);
await assert.rejects(como(db,juradoRetiro,()=>rpc('retirar_participante_clasi',[tr.id,retirarId,tr.version+1])),/cambió/);
await como(db,juradoRetiro,()=>rpc('retirar_participante_clasi',[tr.id,retirarId,tr.version]));
await como(db,ids.j2,()=>rpc('retirar_participante_clasi',[tr.id,retirarId,tr.version]));
assert.equal(await valor('select count(*)::int from private.retiros_clasificatorias where tanda_id=$1',[tr.id]),1);
const auditoria=await q('select * from private.retiros_clasificatorias where tanda_id=$1',[tr.id]);const normalizarVotos=vs=>vs.map(v=>({...v,creado_en:new Date(v.creado_en).toISOString(),actualizado_en:new Date(v.actualizado_en).toISOString()}));assert.deepEqual(normalizarVotos(auditoria[0].votos_anteriores),normalizarVotos(antesRetiro));
const despuesRetiro=await q('select * from public.votaciones_clasificatorias where tanda_id=$1 order by id',[tr.id]);
for(let i=0;i<antesRetiro.length;i++) {
 assert.deepEqual(despuesRetiro[i].puntuaciones,antesRetiro[i].puntuaciones.filter(p=>p.inscripcion_id!==retirarId));
 assert.equal(despuesRetiro[i].version,antesRetiro[i].version+1);
}
assert.equal(await valor('select activa from public.inscripciones where id=$1',[retirarId]),true);
const vistaRetiro=await como(db,juradoRetiro,()=>rpc('consultar_tandas_jurado',[tr.grupo_id]));
assert.equal(vistaRetiro.tandas[0].entradas.length,5);assert.equal(vistaRetiro.tandas[0].retirados[0].id,retirarId);
await assert.rejects(como(db,juradoRetiro,()=>q('select * from private.retiros_clasificatorias')));
const votoActual=despuesRetiro.find(v=>v.jurado_id===juradoRetiro);
await assert.rejects(como(db,juradoRetiro,()=>rpc('guardar_votacion_clasificatoria',[tr.id,antesRetiro.find(v=>v.jurado_id===juradoRetiro).puntuaciones,1,false])));
await como(db,juradoRetiro,()=>rpc('guardar_votacion_clasificatoria',[tr.id,votoActual.puntuaciones,2,true]));
await assert.rejects(como(db,ids.j2,()=>rpc('retirar_participante_clasi',[tr.id,tr.entradas[1].id,tr.version+1])),/finalizó/);
const vaciar=tsRetiro[1];let versionRetiro=vaciar.version;
for(const e of vaciar.entradas) await como(db,ids.j2,()=>rpc('retirar_participante_clasi',[vaciar.id,e.id,versionRetiro++]));
assert.equal(await valor('select estado from public.tandas_clasificatorias where id=$1',[vaciar.id]),'finalizada');
await como(db,ids.admin,()=>rpc('cambiar_vinculo',[iconic,juradoRetiro,'jurado','inactivo']));
await assert.rejects(como(db,juradoRetiro,()=>rpc('retirar_participante_clasi',[tr.id,retirarId,tr.version])),/revocado/);
console.log('PASS 028: retiro por jurados asignados, versiones, reintento, auditoría privada, cero y notas restantes, bloqueo por finalización y revocación');
await db.close();
