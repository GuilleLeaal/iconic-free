import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { nuevaBase,como } from './database.mjs';

const migracion=readFileSync('supabase/migrations/018_configuracion_y_cuadros.sql','utf8');
async function existente(extra='') {
 const db=await nuevaBase(17);
 const usuario=randomUUID(),fecha=randomUUID();
 await db.query('insert into auth.users(id,email) values($1,$2)',[usuario,'historico@test.local']);
 await db.query("insert into public.fechas(id,nombre,creado_por) values($1,'Histórica',$2)",[fecha,usuario]);
 await db.exec(`create table public.planillas_fases(
 id uuid primary key default gen_random_uuid(),fecha_id uuid not null references public.fechas(id),
 fase text not null constraint fases_legacy_check check(fase in ('octavos','cuartos','semifinal','final')),
 configuracion jsonb not null,version integer not null default 1,
 creado_en timestamptz not null default '2025-01-01'::timestamptz ${extra},unique(fecha_id,fase));
 alter table public.planillas_fases enable row level security;
 grant all on public.planillas_fases to authenticated;
 create policy permiso_global_anterior on public.planillas_fases for all to authenticated using(true) with check(true);
 create function public.guardar_planilla_fase(p_fecha_id uuid,p_fase text,p_configuracion jsonb,p_version integer)
 returns void language sql security definer as $$ select; $$;
 create function public.guardar_planilla_fase(p_fecha_id uuid,p_fase text,p_configuracion jsonb)
 returns void language sql security definer as $$ select; $$;`);
 return {db,usuario,fecha};
}

test('018 adopta tabla/RPC preexistentes sin cambiar planillas, IDs, versiones ni timestamps',async()=>{
 const {db,usuario,fecha}=await existente();
 try {
  const configuracion={rondas:[{nombre:'Histórica',casillas:['Respuesta']}],replica:[{nombre:'Réplica',casillas:['Métrica']}]};
  await db.query("insert into public.planillas_fases(fecha_id,fase,configuracion,version) values($1,'octavos',$2,7)",[fecha,configuracion]);
  const antes=(await db.query('select * from public.planillas_fases')).rows;
  await db.exec(migracion);
  const despues=(await db.query('select * from public.planillas_fases')).rows;
  assert.deepEqual(despues.map(({actualizado_por: _autor,actualizado_en: _fecha,...fila})=>fila),antes);
  assert.equal(despues[0].actualizado_por,null);
  assert.equal(despues[0].actualizado_en,null);
  assert.deepEqual((await db.query("select policyname from pg_policies where tablename='planillas_fases'")).rows,[{policyname:'fases_lectura'}]);
  assert.equal((await como(db,usuario,()=>db.query('select * from public.planillas_fases'))).rows.length,0);
  await assert.rejects(como(db,usuario,()=>db.query("select public.guardar_planilla_fase($1,'octavos',$2,7)",[fecha,configuracion])),/permiso/);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.guardar_planilla_fase(uuid,text,jsonb)','execute') as permiso")).rows[0].permiso,false);
  await db.query("insert into public.planillas_fases(fecha_id,fase,configuracion) values($1,'dieciseisavos',$2)",[fecha,configuracion]);
  assert.equal((await db.query('select count(*)::int as cantidad from public.planillas_fases')).rows[0].cantidad,2);
 } finally {await db.close();}
});

test('018 rechaza columnas adicionales obligatorias y revierte la migración completa',async()=>{
 const {db}=await existente(', propietario_extra uuid not null');
 try {
  await assert.rejects(db.exec(migracion),/columnas adicionales obligatorias/);
  await db.exec('rollback');
  assert.equal((await db.query("select count(*)::int as cantidad from information_schema.columns where table_schema='public' and table_name='fechas' and column_name='fase_inicial'")).rows[0].cantidad,0);
  assert.equal((await db.query("select count(*)::int as cantidad from pg_policies where tablename='planillas_fases' and policyname='permiso_global_anterior'")).rows[0].cantidad,1);
 } finally {await db.close();}
});

test('018 no elimina un CHECK de fase desconocido para intentar continuar',async()=>{
 const {db}=await existente();
 try {
  await db.exec("alter table public.planillas_fases add constraint fase_no_vacia check(length(fase)>0)");
  await assert.rejects(db.exec(migracion),/CHECK de fase no reconocido/);
  await db.exec('rollback');
  assert.equal((await db.query("select count(*)::int as cantidad from pg_constraint where conrelid='public.planillas_fases'::regclass and conname in ('fase_no_vacia','fases_legacy_check')")).rows[0].cantidad,2);
 } finally {await db.close();}
});

test('018 rechaza una RPC existente con retorno incompatible sin borrarla',async()=>{
 const {db}=await existente();
 try {
  await db.exec(`drop function public.guardar_planilla_fase(uuid,text,jsonb,integer);
  create function public.guardar_planilla_fase(p_fecha_id uuid,p_fase text,p_configuracion jsonb,p_version integer)
  returns integer language sql as $$ select 1 $$;`);
  await assert.rejects(db.exec(migracion),/contrato distinto/);
  await db.exec('rollback');
  assert.equal((await db.query("select prorettype::regtype::text as retorno from pg_proc where oid='public.guardar_planilla_fase(uuid,text,jsonb,integer)'::regprocedure")).rows[0].retorno,'integer');
 } finally {await db.close();}
});

test('018 conserva auditoría histórica NOT NULL sin defaults y audita guardar/crear/copiar',async()=>{
 const {db,usuario,fecha}=await existente(', actualizado_por uuid not null references public.perfiles(id), actualizado_en timestamptz not null');
 try {
  const inicial={rondas:[{nombre:'Histórica',casillas:['Respuesta']}],replica:[{nombre:'Réplica',casillas:['Métrica']}]};
  await db.query("insert into public.planillas_fases(fecha_id,fase,configuracion,version,actualizado_por,actualizado_en) values($1,'octavos',$2,7,$3,'2025-01-02')",[fecha,inicial,usuario]);
  await db.exec('create trigger timestamp_historico before update on public.planillas_fases for each row execute function private.actualizar_timestamp()');
  const diagnostico=(await db.query(readFileSync('supabase/inspeccionar-planillas-fases.sql','utf8'))).rows[0].diagnostico;
  assert.ok(diagnostico.columnas.some(c=>c.nombre==='actualizado_por' && c.no_nula && c.predeterminado===null));
  const antes=(await db.query('select * from public.planillas_fases')).rows;
  await db.exec(migracion);
  assert.deepEqual((await db.query('select * from public.planillas_fases')).rows,antes);
  const competencia=(await db.query("select private.instalar_iconic($1,'historico@test.local') as id",[usuario])).rows[0].id;
  const editor=randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)',[editor,'editor@test.local']);
  await db.query("insert into public.vinculos_competencia values($1,$2,'organizacion','activo',now())",[competencia,editor]);
  const modificada={...inicial,rondas:[{nombre:'Nueva ronda',casillas:['Fluidez']}]};
  await como(db,editor,()=>db.query("select public.guardar_planilla_fase($1,'octavos',$2,7)",[fecha,modificada]));
  const editada=(await db.query("select * from public.planillas_fases where fase='octavos'")).rows[0];
  assert.equal(editada.version,8);assert.equal(editada.actualizado_por,editor);
  assert.deepEqual(editada.creado_en,antes[0].creado_en);
  assert.ok(editada.actualizado_en>antes[0].actualizado_en);
  await como(db,editor,()=>db.query("select public.guardar_planilla_fase($1,'dieciseisavos',$2,0)",[fecha,inicial]));
  const nueva=(await db.query("select * from public.planillas_fases where fase='dieciseisavos'")).rows[0];
  assert.equal(nueva.actualizado_por,editor);assert.ok(nueva.actualizado_en);assert.ok(nueva.creado_en);
  for(const archivo of readdirSync('supabase/migrations').filter(f=>Number(f.slice(0,3))>=19).sort()) await db.exec(readFileSync(`supabase/migrations/${archivo}`,'utf8'));
  const configuracion={fase_inicial:'octavos',por_cruce:2,clasis_modo:'automaticas',grupos_clasi:null,maximo_tanda:5,llave_fija:false};
  await como(db,editor,()=>db.query('select public.configurar_fecha($1,$2,1,false)',[fecha,configuracion]));
  const origen=(await db.query('select * from public.planillas_fases order by fase')).rows;
  const copia=(await como(db,editor,()=>db.query("select public.copiar_configuracion_fecha($1,'Copia auditada',$2) as id",[fecha,randomUUID()]))).rows[0].id;
  const copiadas=(await db.query('select * from public.planillas_fases where fecha_id=$1 order by fase',[copia])).rows;
  assert.equal(copiadas.length,2);
  assert.ok(copiadas.every(p=>p.actualizado_por===editor && p.actualizado_en && p.creado_en && p.version===1));
  assert.deepEqual(copiadas.map(p=>p.configuracion),origen.map(p=>p.configuracion));
  assert.deepEqual((await db.query('select * from public.planillas_fases where fecha_id=$1 order by fase',[fecha])).rows,origen);
 } finally {await db.close();}
});

test('018 no trata como auditoría una columna con el tipo incorrecto',async()=>{
 const {db}=await existente(', actualizado_por text not null');
 try {
  await assert.rejects(db.exec(migracion),/campo de auditoría actualizado_por/);
  await db.exec('rollback');
  assert.equal((await db.query("select data_type from information_schema.columns where table_schema='public' and table_name='planillas_fases' and column_name='actualizado_por'")).rows[0].data_type,'text');
 } finally {await db.close();}
});
