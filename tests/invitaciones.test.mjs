import test from 'node:test';
import assert from 'node:assert/strict';
import { enviarInvitacion } from '../supabase/functions/gestionar-invitacion/workflow.ts';

test('cuenta nueva: envío de Auth y confirmación persistida',async()=>{
 const llamadas=[];
 await enviarInvitacion({reservar:async()=>({enviada:false,email:'a@test.local',existe:false,lease:'lease'}),invitar:async email=>llamadas.push(email),recuperar:async()=>assert.fail(),registrar:async(...args)=>llamadas.push(args)});
 assert.deepEqual(llamadas,['a@test.local',['lease',true]]);
});
test('cuenta existente: se reutiliza sin crearla ni cambiar contraseña',async()=>{
 let recuperada=false;
 await enviarInvitacion({reservar:async()=>({enviada:false,email:'a@test.local',existe:true,lease:'lease'}),invitar:async()=>assert.fail(),recuperar:async()=>{recuperada=true;},registrar:async(l,exito)=>assert.equal(exito,true)});
 assert.equal(recuperada,true);
});
test('respuesta perdida: envío ya registrado no repite Auth',async()=>{
 assert.deepEqual(await enviarInvitacion({reservar:async()=>({enviada:true}),invitar:async()=>assert.fail(),recuperar:async()=>assert.fail(),registrar:async()=>assert.fail()}),{enviada:true,reutilizada:true});
});
test('fallo de correo se registra como error y nunca se informa éxito',async()=>{
 let registrada;
 await assert.rejects(enviarInvitacion({reservar:async()=>({enviada:false,email:'a@test.local',existe:false,lease:'lease'}),invitar:async()=>{throw Error('SMTP');},recuperar:async()=>assert.fail(),registrar:async(l,exito)=>{registrada=exito;}}),/SMTP/);
 assert.equal(registrada,false);
});
test('fallo entre Auth y base conserva cuenta y permite recuperación por reserva',async()=>{
 let cuentaExiste=false;
 const puertos={reservar:async()=>({enviada:false,email:'a@test.local',existe:cuentaExiste,lease:'lease'}),invitar:async()=>{cuentaExiste=true;},recuperar:async()=>{},registrar:async()=>{throw Error('Base no disponible');}};
 await assert.rejects(enviarInvitacion(puertos),/Base no disponible/);assert.equal(cuentaExiste,true);
 await enviarInvitacion({...puertos,registrar:async()=>{}});assert.equal(cuentaExiste,true);
});
test('revocación en servidor impide llamar Auth',async()=>{
 await assert.rejects(enviarInvitacion({reservar:async()=>{throw Error('Permiso revocado');},invitar:async()=>assert.fail(),recuperar:async()=>assert.fail(),registrar:async()=>assert.fail()}),/Permiso revocado/);
});
