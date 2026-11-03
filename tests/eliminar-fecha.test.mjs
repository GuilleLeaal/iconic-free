import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nuevaBase,como } from './database.mjs';

test('eliminar fecha aísla competencias, bloquea sesiones viejas y conserva actividad y copias',async()=>{
 const db=await nuevaBase();
 const q=async(s,args=[]) => (await db.query(s,args)).rows;
 const valor=async(s,args=[]) => Object.values((await q(s,args))[0])[0];
 const rpc=(n,args=[])=>valor(`select public.${n}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args);
 const admin=randomUUID(),org=randomUUID(),otro=randomUUID(),jurado=randomUUID(),sin=randomUUID();
 try {
  for(const [id,nombre] of [[admin,'admin'],[org,'org'],[otro,'otro'],[jurado,'jurado'],[sin,'sin']]) await q('insert into auth.users(id,email) values($1,$2)',[id,`${nombre}@test.local`]);
  const competencia=await valor("select private.instalar_iconic($1,'admin@test.local')",[admin]);
  const ajena=await como(db,admin,()=>rpc('crear_competencia',['Ajena']));
  await q("insert into public.vinculos_competencia values($1,$2,'organizacion','activo',now()),($1,$3,'jurado','activo',now()),($4,$5,'organizacion','activo',now())",[competencia,org,jurado,ajena,otro]);
  const f=await como(db,org,()=>valor("insert into public.fechas(competencia_id,nombre,clasis_modo,jurados_por_grupo_clasi) values($1,'Fecha para eliminar','siempre',1) returning id",[competencia]));
  const fb=await como(db,otro,()=>valor("insert into public.fechas(competencia_id,nombre) values($1,'Ajena') returning id",[ajena]));
  await como(db,org,async()=>{
   for(let n=1;n<=17;n++) await rpc('crear_inscripcion',[f,'MC '+n,['MC '+n]]);
   await rpc('guardar_planilla_fecha',[f,'clasificatorias',['Puntos'],0]);
   await rpc('configurar_jurado_fecha',[f,jurado,'clasi_a',true]);await rpc('generar_sorteo',[f]);await rpc('iniciar_clasificatorias',[f]);
  });
  const t=(await q('select * from public.tandas_clasificatorias'))[0];
  const puntos=t.entradas.map(e=>({inscripcion_id:e.id,casillas:[3.5]}));
  await como(db,jurado,()=>rpc('guardar_votacion_clasificatoria',[t.id,puntos,0,false]));
  const copia=await como(db,org,()=>rpc('copiar_configuracion_fecha',[f,'Copia conservada',randomUUID()]));
  const antes=await q('select * from public.votaciones_clasificatorias');
  for(const actor of [otro,jurado,sin]) await assert.rejects(como(db,actor,()=>rpc('eliminar_fecha',[f,competencia])),/permiso/);
  await assert.rejects(como(db,org,()=>rpc('eliminar_fecha',[fb,competencia])),/permiso/);
  await assert.rejects(como(db,org,()=>rpc('eliminar_fecha',[fb,ajena])),/permiso/);
  await assert.rejects(como(db,org,()=>q('delete from public.fechas where id=$1',[f])));
  await assert.rejects(como(db,org,()=>q('update public.fechas set eliminado_en=now(),eliminado_por=$2 where id=$1',[f,org])));
  await como(db,org,()=>rpc('eliminar_fecha',[f,competencia]));
  await como(db,org,()=>rpc('eliminar_fecha',[f,competencia]));
  assert.equal(await valor("select count(*)::int from public.auditoria_accesos where accion='eliminar_fecha' and detalle->>'fecha_id'=$1",[f]),1);
  for(const actor of [org,admin,jurado]) {
   assert.equal((await como(db,actor,()=>q('select * from public.fechas where id=$1',[f]))).length,0);
   assert.equal((await como(db,actor,()=>q('select * from public.votaciones_clasificatorias where tanda_id=$1',[t.id]))).length,0);
  }
  await assert.rejects(como(db,jurado,()=>rpc('guardar_votacion_clasificatoria',[t.id,puntos,1,true])),/revocado/);
  await assert.rejects(como(db,jurado,()=>rpc('consultar_tandas_jurado',[t.grupo_id])),/revocado/);
  await assert.rejects(como(db,org,()=>rpc('crear_inscripcion',[f,'Nueva',['Nueva']])));
  await assert.rejects(como(db,org,()=>rpc('generar_sorteo',[f])));
  await assert.rejects(como(db,org,()=>rpc('copiar_configuracion_fecha',[f,'No permitida',randomUUID()])));
  assert.deepEqual(await q('select * from public.votaciones_clasificatorias'),antes);
  assert.equal(await valor('select count(*)::int from public.inscripciones where fecha_id=$1',[f]),17);
  assert.equal(await valor('select eliminado_por from public.fechas where id=$1',[f]),org);
  assert.equal((await como(db,org,()=>q('select * from public.fechas where id=$1',[copia]))).length,1);
  assert.equal((await como(db,otro,()=>q('select * from public.fechas where id=$1',[fb]))).length,1);
  await como(db,admin,()=>rpc('cambiar_vinculo',[competencia,org,'organizacion','inactivo']));
  await assert.rejects(como(db,org,()=>rpc('eliminar_fecha',[f,competencia])),/permiso/);
  // También se pueden quitar fechas sin actividad y fechas finalizadas.
  for(const estado of ['borrador','finalizada','archivada']) {
   const id=await como(db,admin,()=>valor('insert into public.fechas(competencia_id,nombre,estado) values($1,$2,$3) returning id',[competencia,estado,estado]));
   await como(db,admin,()=>rpc('eliminar_fecha',[id,competencia]));
   assert.equal((await como(db,admin,()=>q('select * from public.fechas where id=$1',[id]))).length,0);
  }
 } finally {await db.close();}
});
