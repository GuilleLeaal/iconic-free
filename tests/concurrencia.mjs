import EmbeddedPostgres from 'embedded-postgres';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync,writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { prepararBase } from './database.mjs';

// Clúster nuevo en el workspace, jamás acepta una URL de base remota.
const directory=resolve('.test-postgres',randomUUID());mkdirSync(directory,{recursive:true});
const { pg_ctl } = await import(`@embedded-postgres/${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`);
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
let logs='';
const pg=new EmbeddedPostgres({databaseDir:directory,port,user:'postgres',password:randomUUID(),persistent:true,
 postgresFlags:['-h','127.0.0.1'],onLog:m=>{logs+=String(m)+'\n';},onError:m=>{logs+=String(m)+'\n';}});
const clients=[];
try {
 await pg.initialise();await pg.start();
 const cliente=async()=>{const c=pg.getPgClient('postgres','127.0.0.1');await c.connect();clients.push(c);return c;};
 const c=await cliente();
 await prepararBase({exec:s=>c.query(s)});
 console.log('PASS reconstrucción en '+(await c.query('select version()')).rows[0].version);
 const admin=randomUUID(),j1=randomUUID(),j2=randomUUID();
 for(const [id,email] of [[admin,'admin@test.local'],[j1,'j1@test.local'],[j2,'j2@test.local']]) await c.query('insert into auth.users(id,email) values($1,$2)',[id,email]);
 const comp=(await c.query("select private.instalar_iconic($1,'admin@test.local') id",[admin])).rows[0].id;
 await c.query("insert into public.vinculos_competencia values($1,$2,'jurado','activo',now()),($1,$3,'jurado','activo',now())",[comp,j1,j2]);
 await c.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 const f=(await c.query("insert into public.fechas(competencia_id,nombre,clasis_modo) values($1,'Concurrencia','siempre') returning id",[comp])).rows[0].id;
 for(const n of Array.from({length:17},(_,i)=>i+1)) await c.query('select public.crear_inscripcion($1,$2,$3)',[f,`Alias ${n}`,[`Alias ${n}`]]);
 await c.query("select public.guardar_planilla_fecha($1,'clasificatorias',array['Puntos'],0)",[f]);
 for(const j of [j1,j2]) await c.query("select public.configurar_jurado_fecha($1,$2,'clasi_a',true)",[f,j]);
 await c.query('select public.generar_sorteo($1)',[f]);
 const clasi=(await c.query('select public.iniciar_clasificatorias($1) id',[f])).rows[0].id;
 const t=(await c.query('select * from public.tandas_clasificatorias limit 1')).rows[0];
 const a=await cliente(),b=await cliente();
 async function sesion(conn,id){await conn.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await conn.query('set role authenticated');}
 await sesion(a,j1);await sesion(b,admin);
 const puntos=JSON.stringify(t.entradas.map(e=>({inscripcion_id:e.id,casillas:[2]})));
 // A mantiene el bloqueo adquirido por guardar un borrador; B intenta cambiar
 // el cupo sobre otra conexión real. Se espera bloqueo hasta COMMIT de A.
 await a.query('begin');await a.query('select public.guardar_votacion_clasificatoria($1,$2,0,false)',[t.id,puntos]);
 let termino=false;
 const cfg={fase_inicial:'octavos',por_cruce:3,clasis_modo:'siempre',grupos_clasi:null,maximo_tanda:5,llave_fija:false};
 const cambio=b.query('select public.configurar_fecha($1,$2,1,false)',[f,JSON.stringify(cfg)]).then(r=>{termino=true;return r;});
 await new Promise(r=>setTimeout(r,150));assert.equal(termino,false);
 await a.query('commit');await cambio;
 assert.equal((await c.query('select puntuaciones from public.votaciones_clasificatorias where tanda_id=$1',[t.id])).rows[0].puntuaciones[0].casillas[0],2);
 await a.query('select public.guardar_votacion_clasificatoria($1,$2,1,true)',[t.id,puntos]);
 const voto2=await cliente();await sesion(voto2,j2);await voto2.query('select public.guardar_votacion_clasificatoria($1,$2,0,true)',[t.id,puntos]);
 const ranking=(await b.query('select public.consultar_ranking_clasificatoria($1) r',[clasi])).rows[0].r;
 // Cierre espera cambio de configuración, y rechaza la versión obsoleta.
 await b.query('begin');await b.query('select public.configurar_fecha($1,$2,2,false)',[f,JSON.stringify({...cfg,por_cruce:2})]);
 const cierreConn=await cliente();await sesion(cierreConn,admin);
 const cierre=cierreConn.query("select public.cerrar_clasificatorias_y_sortear_octavos($1,$2,'{}',null)",[clasi,ranking.version]);
 const esperado=assert.rejects(cierre,/La tabla cambió/);
 await b.query('commit');await esperado;
 // Revocación espera a voto en curso y bloquea el siguiente intento de la
 // misma sesión sin depender de un refresh del token.
 await a.query('begin');await a.query('select public.guardar_votacion_clasificatoria($1,$2,2,true)',[t.id,puntos]);
 termino=false;
 const revocar=b.query("select public.cambiar_vinculo($1,$2,'jurado','inactivo')",[comp,j1]).then(()=>{termino=true;});
 await new Promise(r=>setTimeout(r,150));assert.equal(termino,false);await a.query('commit');await revocar;
 await assert.rejects(a.query('select public.guardar_votacion_clasificatoria($1,$2,2,true)',[t.id,puntos]),/revocado/);
 // Eliminar espera el voto de un jurado aún activo y conserva el voto guardado.
 await voto2.query('begin');await voto2.query('select public.guardar_votacion_clasificatoria($1,$2,1,true)',[t.id,puntos]);
 termino=false;
 const eliminar=b.query('select public.eliminar_fecha($1,$2)',[f,comp]).then(()=>{termino=true;});
 await new Promise(r=>setTimeout(r,150));assert.equal(termino,false);
 await voto2.query('commit');await eliminar;
 await assert.rejects(voto2.query('select public.guardar_votacion_clasificatoria($1,$2,1,true)',[t.id,puntos]),/revocado/);
 assert.equal((await c.query('select count(*)::int as cantidad from public.votaciones_clasificatorias where tanda_id=$1',[t.id])).rows[0].cantidad,2);
 assert.equal((await b.query('select * from public.fechas where id=$1',[f])).rows.length,0);
 console.log('PASS conexiones simultáneas: voto/configuración, cierre obsoleto y voto/revocación; sin pérdida de puntos');
 console.log('PASS voto/eliminación: espera al voto, conserva datos y bloquea nuevos intentos');
 // Finalizar y retirar comparten el bloqueo de fecha: nunca se borra una fila
 // que acaba de quedar finalizada ni se acepta un voto con participantes viejos.
 const fr=(await c.query("insert into public.fechas(competencia_id,nombre,maximo_tanda,jurados_por_grupo_clasi) values($1,'Retiro concurrente',6,1) returning id",[comp])).rows[0].id;
 for(let i=0;i<17;i++) await c.query('select public.crear_inscripcion($1,$2,$3)',[fr,`Retiro ${i}`,[`Retiro ${i}`]]);
 await c.query("select public.guardar_planilla_fecha($1,'clasificatorias',array['Puntos'],0)",[fr]);
 await c.query("select public.configurar_jurado_fecha($1,$2,'clasi_a',true)",[fr,j2]);
 await c.query('select public.generar_sorteo($1)',[fr]);await c.query('select public.iniciar_clasificatorias($1)',[fr]);
 const ts=(await c.query('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id join public.clasificatorias cl on cl.id=g.clasificatoria_id where cl.fecha_id=$1 order by t.numero',[fr])).rows;
 const retiroConn=await cliente();await sesion(retiroConn,j2);
 const pr=JSON.stringify(ts[0].entradas.map(e=>({inscripcion_id:e.id,casillas:[0]})));
 await voto2.query('begin');await voto2.query('select public.guardar_votacion_clasificatoria($1,$2,0,true)',[ts[0].id,pr]);
 let retiroTerminado=false;
 const retiroRechazado=assert.rejects(retiroConn.query('select public.retirar_participante_clasi($1,$2,$3)',[ts[0].id,ts[0].entradas[0].id,ts[0].version]).finally(()=>{retiroTerminado=true;}),/finalizó/);
 await new Promise(r=>setTimeout(r,150));assert.equal(retiroTerminado,false);
 await voto2.query('commit');await retiroRechazado;
 assert.equal((await c.query('select count(*)::int as n from private.retiros_clasificatorias where tanda_id=$1',[ts[0].id])).rows[0].n,0);
 await retiroConn.query('begin');await retiroConn.query('select public.retirar_participante_clasi($1,$2,$3)',[ts[1].id,ts[1].entradas[0].id,ts[1].version]);
 const viejos=JSON.stringify(ts[1].entradas.map(e=>({inscripcion_id:e.id,casillas:[2]})));
 let votoTerminado=false;
 const votoRechazado=assert.rejects(voto2.query('select public.guardar_votacion_clasificatoria($1,$2,0,true)',[ts[1].id,viejos]).finally(()=>{votoTerminado=true;}));
 await new Promise(r=>setTimeout(r,150));assert.equal(votoTerminado,false);
 await retiroConn.query('commit');await votoRechazado;
 console.log('PASS retiro/finalización en ambos órdenes: bloqueo mutuo, auditoría y rechazo de participantes obsoletos');
 // El borrado definitivo de competencia espera al voto que ya está en curso.
 await voto2.query('begin');await voto2.query('select public.guardar_votacion_clasificatoria($1,$2,1,true)',[ts[0].id,pr]);
 let competenciaBorrada=false;
 const borrarComp=b.query("select public.eliminar_competencia_definitiva($1,'Iconic')",[comp]).then(()=>{competenciaBorrada=true;});
 await new Promise(r=>setTimeout(r,150));assert.equal(competenciaBorrada,false);
 await voto2.query('commit');await borrarComp;
 assert.equal((await c.query('select count(*)::int as n from public.fechas where competencia_id=$1',[comp])).rows[0].n,0);
 await assert.rejects(voto2.query('select public.guardar_votacion_clasificatoria($1,$2,1,true)',[ts[0].id,pr]),/revocado/);
 assert.equal((await c.query('select count(*)::int as n from auth.users')).rows[0].n,3);
 // Auth y perfil se borran atómicamente y también esperan a los votos previos.
 const compNueva=(await c.query("select public.crear_competencia('Borrado de usuario') id")).rows[0].id;
 await c.query("insert into public.vinculos_competencia(competencia_id,usuario_id,rol,estado) values($1,$2,'jurado','activo')",[compNueva,j2]);
 const fn=(await c.query("insert into public.fechas(competencia_id,nombre,jurados_por_grupo_clasi) values($1,'Borrado de usuario',1) returning id",[compNueva])).rows[0].id;
 for(let i=0;i<17;i++) await c.query('select public.crear_inscripcion($1,$2,$3)',[fn,`Cuenta ${i}`,[`Cuenta ${i}`]]);
 await c.query("select public.guardar_planilla_fecha($1,'clasificatorias',array['Puntos'],0)",[fn]);
 await c.query("select public.configurar_jurado_fecha($1,$2,'clasi_a',true)",[fn,j2]);
 await c.query('select public.generar_sorteo($1)',[fn]);await c.query('select public.iniciar_clasificatorias($1)',[fn]);
 const tn=(await c.query('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id join public.clasificatorias cl on cl.id=g.clasificatoria_id where cl.fecha_id=$1 order by t.numero',[fn])).rows[0];
 const pn=JSON.stringify(tn.entradas.map(e=>({inscripcion_id:e.id,casillas:[2]})));
 await voto2.query('begin');await voto2.query('select public.guardar_votacion_clasificatoria($1,$2,0,false)',[tn.id,pn]);
 const authConn=await cliente();let usuarioBorrado=false;
 const borrarUsuario=authConn.query('delete from auth.users where id=$1',[j2]).then(()=>{usuarioBorrado=true;});
 await new Promise(r=>setTimeout(r,150));assert.equal(usuarioBorrado,false);
 await voto2.query('commit');await borrarUsuario;
 assert.equal((await c.query('select count(*)::int as n from public.votaciones_clasificatorias where jurado_id=$1',[j2])).rows[0].n,0);
 assert.equal((await c.query('select count(*)::int as n from public.perfiles where id=$1',[j2])).rows[0].n,0);
 await assert.rejects(voto2.query('select public.guardar_votacion_clasificatoria($1,$2,1,false)',[tn.id,pn]),/revocado/);
 assert.equal((await c.query('select count(*)::int as n from public.fechas where id=$1',[fn])).rows[0].n,1);
 console.log('PASS borrado definitivo/voto: espera transacciones previas, elimina dependencias y bloquea sesiones viejas');
} finally {
 for(const c of clients) await c.end();
 try { execFileSync(pg_ctl,['-D',directory,'-m','fast','-w','stop'],{windowsHide:true,stdio:'pipe'}); } catch { /* ver log si el arranque falló */ }
 writeFileSync(resolve(directory,'prueba.log'),logs);
}
