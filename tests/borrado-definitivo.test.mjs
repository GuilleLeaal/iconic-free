import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nuevaBase, como } from './database.mjs';
import { borrarCuenta } from '../supabase/functions/administrar-borrados/workflow.ts';

async function escenario() {
 const db=await nuevaBase(28);
 const q=async(s,a=[]) => (await db.query(s,a)).rows;
 const v=async(s,a=[]) => Object.values((await q(s,a))[0])[0];
 const rpc=(n,a=[]) => v(`select public.${n}(${a.map((_,i)=>'$'+(i+1)).join(',')})`,a);
 const ids=Object.fromEntries(['admin','org','jurado','otro','sin'].map(n=>[n,randomUUID()]));
 for(const [n,id] of Object.entries(ids)) await q('insert into auth.users(id,email) values($1,$2)',[id,n+'@test.local']);
 const comp=await v("select private.instalar_iconic($1,'admin@test.local')",[ids.admin]);
 const otra=await como(db,ids.admin,()=>rpc('crear_competencia',['Otra']));
 await q("insert into public.vinculos_competencia(competencia_id,usuario_id,rol,estado) values($1,$2,'organizacion','activo'),($1,$3,'jurado','activo'),($1,$4,'jurado','activo'),($5,$3,'jurado','activo')",[comp,ids.org,ids.jurado,ids.otro,otra]);
 const f=await como(db,ids.org,()=>v("insert into public.fechas(competencia_id,nombre,maximo_tanda,jurados_por_grupo_clasi) values($1,'Fecha',6,2) returning id",[comp]));
 const ajena=await como(db,ids.admin,()=>v("insert into public.fechas(competencia_id,nombre) values($1,'Ajena') returning id",[otra]));
 await como(db,ids.org,async()=>{
  for(let i=0;i<17;i++) await rpc('crear_inscripcion',[f,'MC '+i,['MC '+i]]);
  await rpc('guardar_planilla_fecha',[f,'clasificatorias',['Puntos'],0]);
  await rpc('guardar_planilla_fase',[f,'octavos',{rondas:[{nombre:'Ronda',casillas:['Puntos']}],replica:[{nombre:'Réplica',casillas:['Puntos']}]},0]);
  for(const j of [ids.jurado,ids.otro]) await rpc('configurar_jurado_fecha',[f,j,'clasi_a',true]);
  await rpc('generar_sorteo',[f]);await rpc('iniciar_clasificatorias',[f]);
 });
 const t=(await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id join public.clasificatorias c on c.id=g.clasificatoria_id where c.fecha_id=$1 order by t.numero',[f]))[0];
 for(const j of [ids.jurado,ids.otro]) await como(db,j,()=>rpc('guardar_votacion_clasificatoria',[t.id,t.entradas.map(e=>({inscripcion_id:e.id,casillas:[0]})),0,false]));
 await como(db,ids.otro,()=>rpc('retirar_participante_clasi',[t.id,t.entradas[0].id,t.version]));
 await como(db,ids.jurado,()=>rpc('agregar_participante_clasi',[t.grupo_id,t.id,'Tardío',['Tardío'],randomUUID()]));
 const copia=await como(db,ids.org,()=>rpc('copiar_configuracion_fecha',[f,'Copia',randomUUID()]));
 const invitacion=await como(db,ids.admin,()=>rpc('preparar_invitacion',[comp,'jurado@test.local','jurado']));
 await como(db,ids.jurado,()=>rpc('aceptar_invitacion',[invitacion]));
 // Aplicar sobre actividad real: la migración no borra nada por sí sola.
 const antes=await v('select count(*)::int from public.votaciones_clasificatorias');
 await db.exec(readFileSync('supabase/migrations/029_borrado_definitivo.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/030_nombres_de_usuario.sql','utf8'));
 assert.equal(await v('select count(*)::int from public.votaciones_clasificatorias'),antes);
 return {db,q,v,rpc,ids,comp,otra,f,ajena,t,copia,invitacion};
}

test('borrar cuenta elimina Auth, perfil, vínculos, votos e invitaciones y permite reinvitar con UUID nuevo',async()=>{
 const {db,q,v,rpc,ids,comp,f,t}=await escenario();
 try {
  await como(db,ids.jurado,()=>rpc('actualizar_nombre_usuario',['jurado_reutilizable']));
  for(const actor of [ids.admin,ids.org,ids.jurado]) await assert.rejects(como(db,actor,()=>rpc('validar_borrado_usuario',[ids.admin,ids.jurado,'jurado@test.local'])));
  await db.exec('set role service_role');
  await assert.rejects(rpc('validar_borrado_usuario',[ids.org,ids.jurado,'jurado@test.local']),/exclusivo/);
  await assert.rejects(rpc('validar_borrado_usuario',[ids.admin,ids.admin,'admin@test.local']),/tu cuenta/);
  await assert.rejects(rpc('validar_borrado_usuario',[ids.admin,ids.jurado,'equivocado@test.local']),/no coincide/);
  assert.deepEqual(await rpc('validar_borrado_usuario',[ids.admin,ids.jurado,'JURADO@test.local']),{existe:true});
  await db.exec('reset role');
  const otrosVotos=await q('select * from public.votaciones_clasificatorias where jurado_id=$1',[ids.otro]);
  await q('delete from auth.users where id=$1',[ids.jurado]);
  for(const [tabla,col] of [['auth.users','id'],['public.perfiles','id'],['public.vinculos_competencia','usuario_id'],['public.jurados_fecha','jurado_id'],['public.jurados_clasificatorias','jurado_id'],['public.votaciones_clasificatorias','jurado_id'],['private.altas_clasificatorias','usuario_id']]) assert.equal(await v(`select count(*)::int from ${tabla} where ${col}=$1`,[ids.jurado]),0);
  assert.equal(await v("select count(*)::int from private.invitaciones where email='jurado@test.local'"),0);
  assert.deepEqual(await q('select * from public.votaciones_clasificatorias where jurado_id=$1',[ids.otro]),otrosVotos);
  assert.equal(await v('select count(*)::int from public.fechas where id=$1',[f]),1);
  assert.equal(await v('select jsonb_array_length(votos_anteriores)::int from private.retiros_clasificatorias where tanda_id=$1',[t.id]),1);
  await assert.rejects(como(db,ids.jurado,()=>rpc('consultar_tandas_jurado',[t.grupo_id])),/revocado/);
  await db.exec('set role service_role');assert.deepEqual(await rpc('validar_borrado_usuario',[ids.admin,ids.jurado,'jurado@test.local']),{existe:false});await db.exec('reset role');
  const nueva=await como(db,ids.admin,()=>rpc('preparar_invitacion',[comp,'jurado@test.local','jurado']));
  await db.exec('set role service_role');const reserva=await rpc('reservar_envio_invitacion',[nueva,ids.admin,false]);await db.exec('reset role');assert.equal(reserva.existe,false);
  const nuevoId=randomUUID();await q("insert into auth.users(id,email) values($1,'jurado@test.local')",[nuevoId]);
  await como(db,nuevoId,()=>rpc('actualizar_nombre_usuario',['jurado_reutilizable']));
  await como(db,nuevoId,()=>rpc('aceptar_invitacion',[nueva]));
  assert.equal(await v('select count(*)::int from public.vinculos_competencia where usuario_id=$1',[nuevoId]),1);
  assert.equal(await v('select count(*)::int from public.votaciones_clasificatorias where jurado_id=$1',[nuevoId]),0);
 } finally {await db.close();}
});

test('borrar organizador conserva fechas y resultados sin autor y protege al administrador',async()=>{
 const {db,q,v,rpc,ids,f,copia,comp}=await escenario();
 try {
  await como(db,ids.org,()=>rpc('eliminar_fecha',[copia,comp]));
  await q('delete from auth.users where id=$1',[ids.org]);
  assert.equal(await v('select creado_por from public.fechas where id=$1',[f]),null);
  assert.equal(await v('select eliminado_por from public.fechas where id=$1',[copia]),null);
  assert.ok(await v('select eliminado_en from public.fechas where id=$1',[copia]));
  assert.equal(await v('select count(*)::int from public.sorteos where fecha_id=$1',[f]),1);
  assert.equal(await v('select actualizado_por from public.planillas_fases where fecha_id=$1',[f]),null);
  await assert.rejects(q('delete from auth.users where id=$1',[ids.admin]),/administración global/);
  assert.equal(await v('select count(*)::int from auth.users where id=$1',[ids.admin]),1);
 } finally {await db.close();}
});

test('borrar competencia destruye sus recursos y copias, conserva cuentas y otra competencia',async()=>{
 const {db,q,v,rpc,ids,comp,otra,ajena}=await escenario();
 try {
  const finalizada=await como(db,ids.org,()=>v("insert into public.fechas(competencia_id,nombre) values($1,'Torneo terminado') returning id",[comp]));
  await como(db,ids.org,async()=>{
   await rpc('configurar_fecha',[finalizada,{fase_inicial:'octavos',por_cruce:2,clasis_modo:'automaticas',grupos_clasi:null,maximo_tanda:6,llave_fija:false},1,false]);
   for(let i=0;i<16;i++) await rpc('crear_inscripcion',[finalizada,'Finalista '+i,['Finalista '+i]]);
   await rpc('generar_sorteo',[finalizada]);
   const sid=await rpc('iniciar_eliminatorias',[finalizada]);
   for(const fase of ['octavos','cuartos','semifinal','final']) {
    let cruces=await q('select * from public.cruces_eliminatorias where sorteo_id=$1 and fase=$2 order by numero',[sid,fase]);
    if(cruces.some(c=>!c.listo) && fase!=='final') await rpc('sortear_fase_eliminatoria',[finalizada,fase]);
    cruces=await q('select * from public.cruces_eliminatorias where sorteo_id=$1 and fase=$2 order by numero',[sid,fase]);
    for(const c of cruces) if(c.estado==='pendiente') await rpc('confirmar_ganador_cruce',[c.id,c.entradas[0].id,c.version]);
   }
  });
  assert.equal(await v('select estado from public.fechas where id=$1',[finalizada]),'finalizada');
  assert.ok(await v('select count(*)::int from public.historial_resultados_eliminatorias')>0);
  assert.ok(await v('select count(*)::int from public.sorteos_fases_eliminatorias')>0);
  for(const actor of [ids.org,ids.jurado,ids.sin]) await assert.rejects(como(db,actor,()=>rpc('eliminar_competencia_definitiva',[comp,'Iconic'])),/exclusivo/);
  await assert.rejects(como(db,ids.admin,()=>q('delete from public.competencias where id=$1',[comp])));
  await assert.rejects(como(db,ids.admin,()=>rpc('eliminar_competencia_definitiva',[comp,'otro nombre'])),/no coincide/);
  await como(db,ids.admin,()=>rpc('eliminar_competencia_definitiva',[comp,'Iconic']));
  await como(db,ids.admin,()=>rpc('eliminar_competencia_definitiva',[comp,'Iconic']));
  for(const tabla of ['inscripciones','inscripcion_integrantes','inscripciones_historial','sorteos','jurados_fecha','planillas_fecha','planillas_fases','clasificatorias','grupos_clasificatorias','jurados_clasificatorias','tandas_clasificatorias','votaciones_clasificatorias','cruces_eliminatorias','sorteos_fases_eliminatorias','historial_resultados_eliminatorias','historial_configuracion_fecha','cierres_clasificatorias']) assert.equal(await v(`select count(*)::int from public.${tabla}`),0,tabla);
  for(const tabla of ['altas_clasificatorias','retiros_clasificatorias','copias_fecha','invitaciones']) assert.equal(await v(`select count(*)::int from private.${tabla}`),0,tabla);
  assert.equal(await v('select count(*)::int from public.auditoria_accesos where competencia_id=$1',[comp]),0);
  assert.equal(await v('select count(*)::int from public.competencias where id=$1',[comp]),0);
  assert.equal(await v('select count(*)::int from public.fechas where id=$1 and competencia_id=$2',[ajena,otra]),1);
  assert.equal(await v('select count(*)::int from auth.users'),5);
  assert.equal(await v('select count(*)::int from public.perfiles'),5);
 } finally {await db.close();}
});

test('un envío en curso bloquea el borrado y la transacción conserva todo',async()=>{
 const {db,q,v,rpc,ids,comp}=await escenario();
 try {
  const id=await como(db,ids.admin,()=>rpc('preparar_invitacion',[comp,'jurado@test.local','organizacion']));
  await db.exec('set role service_role');await rpc('reservar_envio_invitacion',[id,ids.admin,true]);await db.exec('reset role');
  await assert.rejects(q('delete from auth.users where id=$1',[ids.jurado]),/envío.*curso/);
  await assert.rejects(como(db,ids.admin,()=>rpc('eliminar_competencia_definitiva',[comp,'Iconic'])),/envío.*curso/);
  assert.equal(await v('select count(*)::int from public.competencias where id=$1',[comp]),1);
  assert.equal(await v('select count(*)::int from auth.users where id=$1',[ids.jurado]),1);
 } finally {await db.close();}
});

test('nombre de usuario único, normalizado y modificable solo por su dueño',async()=>{
 const {db,q,v,rpc,ids}=await escenario();
 try {
  await como(db,ids.jurado,()=>rpc('actualizar_nombre_usuario',['  Luna_uy  ']));
  assert.deepEqual((await q('select nombre,nombre_usuario from public.perfiles where id=$1',[ids.jurado]))[0],{nombre:'luna_uy',nombre_usuario:'luna_uy'});
  await assert.rejects(como(db,ids.otro,()=>rpc('actualizar_nombre_usuario',['LUNA_UY'])),/ya está en uso/);
  for(const invalido of ['a','mail@algo.com','nombre con espacios','_nombre','a'.repeat(31),null]) await assert.rejects(como(db,ids.jurado,()=>rpc('actualizar_nombre_usuario',[invalido])));
  await db.exec('set role anon');await assert.rejects(rpc('actualizar_nombre_usuario',['intruso']));await db.exec('reset role');
  await assert.rejects(como(db,ids.otro,()=>q("update public.perfiles set nombre_usuario='intruso' where id=$1",[ids.jurado])));
  assert.equal(await v('select nombre_usuario from public.perfiles where id=$1',[ids.jurado]),'luna_uy');
 } finally {await db.close();}
});

test('servidor valida el actor antes de borrar Auth, usa borrado definitivo y admite reintentos',async()=>{
 let llamadas=0;
 await assert.rejects(borrarCuenta({validar:async()=>{throw Error('Sin permiso');},borrarAuth:async()=>{llamadas++;}}),/Sin permiso/);
 assert.equal(llamadas,0);
 await assert.rejects(borrarCuenta({validar:async()=>({existe:true}),borrarAuth:async()=>{throw Error('Auth');}}),/Auth/);
 assert.deepEqual(await borrarCuenta({validar:async()=>({existe:true}),borrarAuth:async()=>{llamadas++;}}),{eliminado:true});
 assert.deepEqual(await borrarCuenta({validar:async()=>({existe:false}),borrarAuth:async()=>{llamadas++;}}),{eliminado:true});
 assert.equal(llamadas,1);
});
