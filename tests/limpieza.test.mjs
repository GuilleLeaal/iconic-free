import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nuevaBase, como } from './database.mjs';
const limpieza=readFileSync('supabase/limpiar-datos-conservar-admin.sql','utf8');

async function escenario() {
 const db=await nuevaBase();
 const q=async(s,a=[]) => (await db.query(s,a)).rows;
 const v=async(s,a=[]) => Object.values((await q(s,a))[0])[0];
 const rpc=(n,a=[])=>v(`select public.${n}(${a.map((_,i)=>'$'+(i+1)).join(',')})`,a);
 const admin=randomUUID(),jurado=randomUUID(),otro=randomUUID();
 for(const [id,email] of [[admin,'principal@test.local'],[jurado,'jurado@test.local'],[otro,'otro@test.local']]) await q('insert into auth.users(id,email) values($1,$2)',[id,email]);
 const comp=await v("select private.instalar_iconic($1,'principal@test.local')",[admin]);
 await como(db,admin,()=>rpc('actualizar_nombre_usuario',['cuenta_principal']));
 await q("insert into public.vinculos_competencia(competencia_id,usuario_id,rol,estado) values($1,$2,'jurado','activo')",[comp,jurado]);
 const f=await como(db,admin,()=>v("insert into public.fechas(competencia_id,nombre,jurados_por_grupo_clasi) values($1,'Fecha',1) returning id",[comp]));
 await como(db,admin,async()=>{
  for(let i=0;i<17;i++) await rpc('crear_inscripcion',[f,null,['MC '+i]]);
  await rpc('guardar_planilla_fecha',[f,'clasificatorias',['Puntos'],0]);
  await rpc('configurar_jurado_fecha',[f,jurado,'clasi_a',true]);
  await rpc('generar_sorteo',[f]);await rpc('iniciar_clasificatorias',[f]);
 });
 const t=(await q('select * from public.tandas_clasificatorias order by numero'))[0];
 await como(db,jurado,()=>rpc('guardar_votacion_clasificatoria',[t.id,t.entradas.map(e=>({inscripcion_id:e.id,casillas:[0]})),0,false]));
 await como(db,admin,()=>rpc('copiar_configuracion_fecha',[f,'Copia',randomUUID()]));
 const invitacion=await como(db,admin,()=>rpc('preparar_invitacion',[comp,'nuevo@test.local','jurado']));
 // Simular las dependencias que Auth mantiene para cada cuenta.
 await db.exec('create table auth.identities(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);');
 for(const id of [admin,jurado,otro]) for(const tabla of ['identities','sessions']) await q(`insert into auth.${tabla}(id,user_id) values($1,$2)`,[randomUUID(),id]);
 return {db,q,v,rpc,admin,jurado,comp,invitacion};
}

test('limpieza conserva exactamente Auth/perfil/acceso/sesiones del administrador y permite empezar de nuevo',async()=>{
 const {db,q,v,rpc,admin}=await escenario();
 try {
  const perfil=await q('select * from public.perfiles where id=$1',[admin]);
  const cuenta=await q('select * from auth.users where id=$1',[admin]);
  await db.exec(limpieza);
  assert.deepEqual(await q('select * from public.perfiles'),perfil);
  assert.deepEqual(await q('select * from auth.users'),cuenta);
  for(const tabla of ['identities','sessions']) assert.deepEqual(await q(`select distinct user_id from auth.${tabla}`),[{user_id:admin}]);
  const tablas=await q("select table_schema,table_name from information_schema.tables where table_schema in ('public','private') and table_type='BASE TABLE' and table_name not in ('perfiles','administrador_plataforma')");
  for(const t of tablas) assert.equal(await v(`select count(*)::int from ${t.table_schema}.${t.table_name}`),0,t.table_name);
  assert.deepEqual(await como(db,admin,()=>rpc('mis_contextos')),{administrador:true,competencias:[]});
  const comp=await como(db,admin,()=>rpc('crear_competencia',['Competencia nueva']));assert.ok(comp);
  const invitacion=await como(db,admin,()=>rpc('preparar_invitacion',[comp,'jurado@test.local','jurado']));assert.ok(invitacion);
  // Repetir la limpieza también es válido y conserva la misma cuenta.
  await db.exec(limpieza);assert.deepEqual(await q('select * from auth.users'),cuenta);
 } finally {await db.close();}
});

test('sin administrador o con un envío en curso la limpieza no borra datos',async()=>{
 const {db,q,v,rpc,admin,invitacion}=await escenario();
 try {
  await db.exec('set role service_role');await rpc('reservar_envio_invitacion',[invitacion,admin,false]);await db.exec('reset role');
  await assert.rejects(db.exec(limpieza),/invitaciones enviándose/);await db.exec('rollback');
  assert.equal(await v('select count(*)::int from auth.users'),3);assert.equal(await v('select count(*)::int from public.inscripciones'),17);
  await q('update private.invitaciones set lease_hasta=null');
  await q('delete from private.administrador_plataforma');
  await assert.rejects(db.exec(limpieza),/exactamente un administrador/);await db.exec('rollback');
  assert.equal(await v('select count(*)::int from auth.users'),3);assert.equal(await v('select count(*)::int from public.inscripciones'),17);
 } finally {await db.close();}
});

test('detecta modalidades históricas y sus dependencias sin truncar el perfil principal',async()=>{
 const {db,q,v,admin}=await escenario();
 try {
  await db.exec('create table public.modalidades_jurados_fecha(id uuid primary key,fecha_id uuid references public.fechas(id),jurado_id uuid references public.perfiles(id));create table private.notas_modalidad(id integer generated always as identity primary key,modalidad_id uuid references public.modalidades_jurados_fecha(id));');
  const fecha=await v('select id from public.fechas limit 1'),modalidad=randomUUID();
  await q('insert into public.modalidades_jurados_fecha values($1,$2,$3)',[modalidad,fecha,admin]);
  await q('insert into private.notas_modalidad(modalidad_id) values($1)',[modalidad]);
  await db.exec(limpieza);
  assert.equal(await v('select count(*)::int from public.modalidades_jurados_fecha'),0);
  assert.equal(await v('select count(*)::int from private.notas_modalidad'),0);
  assert.equal(await v('select id from public.perfiles'),admin);
  assert.equal(await v('select id from auth.users'),admin);
 } finally {await db.close();}
});

test('si una dependencia histórica incluye perfiles se detiene antes del borrado',async()=>{
 const {db,q,v,admin}=await escenario();
 try {
  await db.exec('alter table public.perfiles add column ultima_fecha uuid references public.fechas(id)');
  await q('update public.perfiles set ultima_fecha=(select id from public.fechas limit 1) where id=$1',[admin]);
  await assert.rejects(db.exec(limpieza),/esquema protegido/);await db.exec('rollback');
  assert.equal(await v('select count(*)::int from public.inscripciones'),17);
  assert.equal(await v('select count(*)::int from auth.users'),3);
 } finally {await db.close();}
});
