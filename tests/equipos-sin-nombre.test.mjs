import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nuevaBase, como } from './database.mjs';

async function base() {
 const db=await nuevaBase(30);
 const q=async(s,a=[]) => (await db.query(s,a)).rows;
 const v=async(s,a=[]) => Object.values((await q(s,a))[0])[0];
 const rpc=(n,a=[]) => v(`select public.${n}(${a.map((_,i)=>'$'+(i+1)).join(',')})`,a);
 const admin=randomUUID(),jurado=randomUUID();
 for(const [id,email] of [[admin,'admin@test.local'],[jurado,'jurado@test.local']]) await q('insert into auth.users(id,email) values($1,$2)',[id,email]);
 const comp=await v("select private.instalar_iconic($1,'admin@test.local')",[admin]);
 await q("insert into public.vinculos_competencia(competencia_id,usuario_id,rol,estado) values($1,$2,'jurado','activo')",[comp,jurado]);
 const fecha=async(cantidad)=>como(db,admin,()=>v("insert into public.fechas(competencia_id,nombre,integrantes_por_equipo,jurados_por_grupo_clasi,maximo_tanda) values($1,'Equipos',$2,1,6) returning id",[comp,cantidad]));
 return {db,q,v,rpc,admin,jurado,comp,fecha};
}

test('nombre opcional en alta y edición de duplas, tríos y equipos; alias siguen obligatorios',async()=>{
 const {db,q,v,rpc,admin,fecha}=await base();
 try {
  const historica=await fecha(2);
  const equipoPrevio=await como(db,admin,()=>rpc('crear_inscripcion',[historica,'Nombre anterior',['Antes A','Antes B']]));
  const antes=await q('select * from public.inscripciones where id=$1',[equipoPrevio]);
  await db.exec(readFileSync('supabase/migrations/031_nombre_equipo_opcional.sql','utf8'));
  assert.deepEqual(await q('select * from public.inscripciones where id=$1',[equipoPrevio]),antes);
  for(const cantidad of [2,3,5]) {
   const f=await fecha(cantidad);
   const alias=(prefijo)=>Array.from({length:cantidad},(_,i)=>prefijo+' '+(i+1));
   for(const [indice,nombre] of [null,'','   ','  Equipo elegido  '].entries()) {
    const integrantes=alias('MC '+indice);
    const id=await como(db,admin,()=>rpc('crear_inscripcion',[f,nombre,integrantes]));
    assert.equal(await v('select nombre from public.inscripciones where id=$1',[id]),indice===3?'Equipo elegido':integrantes.join(' / '));
    if(indice===3) {
     const nuevos=alias('Editado');
     await como(db,admin,()=>rpc('modificar_inscripcion',[id,1,'editar',' ',nuevos]));
     assert.equal(await v('select nombre from public.inscripciones where id=$1',[id]),nuevos.join(' / '));
     await como(db,admin,()=>rpc('modificar_inscripcion',[id,2,'editar','Nombre nuevo',nuevos]));
     assert.equal(await v('select nombre from public.inscripciones where id=$1',[id]),'Nombre nuevo');
     await como(db,admin,()=>rpc('modificar_inscripcion',[id,3,'editar',null,nuevos]));
     await como(db,admin,()=>rpc('modificar_inscripcion',[id,4,'retirar',null,null]));
     await como(db,admin,()=>rpc('modificar_inscripcion',[id,5,'reactivar',null,null]));
     assert.equal(await v('select nombre from public.inscripciones where id=$1',[id]),nuevos.join(' / '));
    }
   }
   await assert.rejects(como(db,admin,()=>rpc('crear_inscripcion',[f,'',alias('Incompleto').slice(1)])),/cantidad/);
   await assert.rejects(como(db,admin,()=>rpc('crear_inscripcion',[f,'',alias('Vacío').map((a,i)=>i===0?'':a)])),/alias/);
   await assert.rejects(como(db,admin,()=>rpc('crear_inscripcion',[f,'',alias('Duplicado').map(()=> 'Mismo')])),/repetir/);
   await assert.rejects(como(db,admin,()=>rpc('crear_inscripcion',[f,'',alias('MC 0')])),/ya está anotado/);
  }
  const individual=await fecha(1);
  const id=await como(db,admin,()=>rpc('crear_inscripcion',[individual,null,['  Individual  ']]));
  assert.equal(await v('select nombre from public.inscripciones where id=$1',[id]),'Individual');
 } finally {await db.close();}
});

test('alta tardía sin nombre conserva borradores, respeta formato y recupera reintentos',async()=>{
 const {db,q,v,rpc,admin,jurado,fecha}=await base();
 try {
  await db.exec(readFileSync('supabase/migrations/031_nombre_equipo_opcional.sql','utf8'));
  const f=await fecha(3);
  await como(db,admin,async()=>{
   for(let i=0;i<17;i++) await rpc('crear_inscripcion',[f,null,['A'+i,'B'+i,'C'+i]]);
   await rpc('guardar_planilla_fecha',[f,'clasificatorias',['Puntos'],0]);
   await rpc('configurar_jurado_fecha',[f,jurado,'clasi_a',true]);
   await rpc('generar_sorteo',[f]);await rpc('iniciar_clasificatorias',[f]);
  });
  const tandas=await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id join public.clasificatorias c on c.id=g.clasificatoria_id where c.fecha_id=$1 order by t.numero',[f]);
  const t=tandas.find(t=>t.entradas.length<6);
  const puntos=t.entradas.map(e=>({inscripcion_id:e.id,casillas:[0]}));
  await como(db,jurado,()=>rpc('guardar_votacion_clasificatoria',[t.id,puntos,0,false]));
  const solicitud=randomUUID();
  const alta=await como(db,jurado,()=>rpc('agregar_participante_clasi',[t.grupo_id,t.id,null,['  Luna  ','Norte','Sur'],solicitud]));
  assert.deepEqual(await como(db,jurado,()=>rpc('agregar_participante_clasi',[t.grupo_id,t.id,' ',['Luna','Norte','Sur'],solicitud])),alta);
  assert.equal(await v('select nombre from public.inscripciones where id=$1',[alta.inscripcion_id]),'Luna / Norte / Sur');
  assert.equal(await v('select count(*)::int from public.inscripciones where fecha_id=$1',[f]),18);
  const voto=await v('select puntuaciones from public.votaciones_clasificatorias where tanda_id=$1',[t.id]);
  assert.deepEqual(voto.slice(0,-1),puntos);assert.deepEqual(voto.at(-1),{inscripcion_id:alta.inscripcion_id,casillas:[null]});
  await assert.rejects(como(db,jurado,()=>rpc('agregar_participante_clasi',[t.grupo_id,null,'',['Vacío','','Alias'],randomUUID()])),/alias/);
  await assert.rejects(como(db,admin,()=>rpc('agregar_participante_clasi',[t.grupo_id,null,'',['Otro A','Otro B','Otro C'],randomUUID()])),/asignado/);
 } finally {await db.close();}
});
