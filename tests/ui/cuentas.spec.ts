import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const actor='20000000-0000-4000-8000-000000000001';
const objetivo='20000000-0000-4000-8000-000000000002';
const comp='20000000-0000-4000-8000-000000000003';
const otra='20000000-0000-4000-8000-000000000004';

async function preparar(page:Page,{global=true,falloBorrado=false,invitacion=false}={}) {
 const errores:string[]=[];page.on('pageerror',e=>errores.push(e.message));
 const borrados:unknown[]=[];const competenciasBorradas:unknown[]=[];
 let usuarioEliminado=false,competenciaEliminada=false,nombreUsuario:string|null=null;
 const user={id:actor,email:'admin@prueba.local',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01'};
 const token=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:actor,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')+'.test';
 await page.route('http://127.0.0.1:54321/**',async route=>{
  const req=route.request(),u=new URL(req.url()),body=req.postDataJSON()??{};
  const json=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
  if(req.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
  if(u.pathname.includes('/auth/v1/token')) return json({access_token:token,refresh_token:'test',expires_in:3600,token_type:'bearer',user});
  if(u.pathname.endsWith('/auth/v1/user')) return json(user);
  if(u.pathname.endsWith('/perfiles')) return json({id:actor,nombre:nombreUsuario??'Cuenta personal',nombre_usuario:nombreUsuario});
  if(u.pathname.endsWith('/rpc/mis_contextos')) return json({administrador:global,competencias:[...(!competenciaEliminada?[{id:comp,nombre:'Iconic',organizacion:true,jurado:false}]:[]),{id:otra,nombre:'Otra competencia',organizacion:true,jurado:false}]});
  if(u.pathname.endsWith('/rpc/mis_invitaciones')||u.pathname.endsWith('/fechas')) return json([]);
  if(u.pathname.endsWith('/rpc/buscar_invitaciones')) return json({filas:[],hay_mas:false});
  if(u.pathname.endsWith('/rpc/buscar_competencias')) return json({filas:[...(!competenciaEliminada?[{id:comp,nombre:'Iconic',activa:true}]:[]),{id:otra,nombre:'Otra competencia',activa:true}],hay_mas:false});
  if(u.pathname.endsWith('/rpc/buscar_cuentas')) return json({filas:[{id:actor,nombre:nombreUsuario??'Cuenta personal',email:'admin@prueba.local',vinculos:[]},...(!usuarioEliminado?[{id:objetivo,nombre:'jurado_uy',email:'jurado@prueba.local',vinculos:[{competencia_id:comp,competencia:'Iconic',rol:'jurado',estado:'activo'}]}]:[])],hay_mas:false});
  if(u.pathname.endsWith('/functions/v1/administrar-borrados')) {
   borrados.push(body);
   if(falloBorrado && borrados.length===1) return json({error:'No se pudo confirmar el borrado de la cuenta. Actualizá el directorio y reintentá.'},400);
   usuarioEliminado=true;return json({eliminado:true});
  }
  if(u.pathname.endsWith('/rpc/eliminar_competencia_definitiva')) {competenciasBorradas.push(body);competenciaEliminada=true;return json(null);}
  if(u.pathname.endsWith('/rpc/actualizar_nombre_usuario')) {
   if(body.p_nombre_usuario==='ocupado') return json({code:'P0001',message:'Ese nombre de usuario ya está en uso.'},400);
   nombreUsuario=body.p_nombre_usuario;return json(null);
  }
  throw Error('Solicitud sin fixture: '+u.pathname);
 });
 await page.goto(invitacion?'/#type=invite':'/');
 await page.getByLabel('Correo',{exact:true}).fill('admin@prueba.local');await page.getByLabel('Contraseña',{exact:true}).fill('password-test');
 await page.getByRole('button',{name:'Ingresar',exact:true}).click();
 return {borrados,competenciasBorradas,errores};
}

test('mi cuenta valida nombre duplicado y actualiza el nombre visible',async({page},testInfo)=>{
 const {errores}=await preparar(page);
 await page.getByRole('button',{name:'Mi cuenta',exact:true}).click();
 await page.getByLabel('Nombre de usuario',{exact:true}).fill('ocupado');await page.getByRole('button',{name:'Guardar nombre de usuario'}).click();
 await expect(page.getByRole('alert')).toContainText('ya está en uso');
 await page.getByLabel('Nombre de usuario',{exact:true}).fill('Luna_UY');await page.getByRole('button',{name:'Guardar nombre de usuario'}).click();
 await expect(page.locator('.workspace-cuenta strong')).toHaveText('luna_uy');
 await page.getByRole('button',{name:'Mi cuenta',exact:true}).click();await expect(page.getByLabel('Nombre de usuario',{exact:true})).toHaveValue('luna_uy');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('mi-cuenta.png'),fullPage:true});expect(errores).toEqual([]);
});

test('borrar cuenta exige correo, protege la propia y conserva el reintento ante error',async({page},testInfo)=>{
 const {borrados,errores}=await preparar(page,{falloBorrado:true});
 await page.getByRole('button',{name:'Administración global',exact:true}).click();
 const boton=page.getByRole('button',{name:'Eliminar definitivamente usuario jurado_uy',exact:true});
 await expect(page.getByRole('button',{name:'Eliminar definitivamente usuario Cuenta personal',exact:true})).toBeDisabled();
 page.once('dialog',d=>d.dismiss());await boton.click();expect(borrados).toHaveLength(0);
 page.once('dialog',d=>d.accept('otro@prueba.local'));await boton.click();await expect(page.getByRole('alert')).toContainText('no coincide');expect(borrados).toHaveLength(0);
 page.once('dialog',d=>d.accept('jurado@prueba.local'));await boton.click();await expect(page.getByRole('alert')).toContainText('No se pudo confirmar');await expect(boton).toBeVisible();
 page.once('dialog',d=>d.accept('jurado@prueba.local'));await boton.click();await expect(boton).toHaveCount(0);
 await expect(page.getByRole('status')).toContainText('Cuenta eliminada definitivamente');
 expect(borrados).toEqual(Array.from({length:2},()=>({usuario_id:objetivo,confirmacion:'jurado@prueba.local'})));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('cuenta-eliminada.png'),fullPage:true});expect(errores).toEqual([]);
});

test('borrar competencia exige nombre y limpia la competencia seleccionada',async({page})=>{
 const {competenciasBorradas,errores}=await preparar(page);
 await page.getByRole('button',{name:'Administración global',exact:true}).click();
 await page.locator('summary').filter({hasText:/^Competencias/}).click();
 const boton=page.getByRole('button',{name:'Eliminar definitivamente competencia Iconic',exact:true});
 page.once('dialog',d=>d.dismiss());await boton.click();expect(competenciasBorradas).toHaveLength(0);
 page.once('dialog',d=>d.accept('otro nombre'));await boton.click();await expect(page.getByRole('alert')).toContainText('no coincide');expect(competenciasBorradas).toHaveLength(0);
 page.once('dialog',async d=>{expect(d.message()).toContain('fechas, inscripciones, sorteos, votos y resultados');await d.accept('Iconic');});await boton.click();
 await expect(page.getByRole('combobox',{name:'Competencia activa',exact:true})).toHaveValue(otra);
 await expect(page.getByRole('button',{name:'Eliminar definitivamente competencia Iconic',exact:true})).toHaveCount(0);
 expect(competenciasBorradas).toEqual([{p_competencia:comp,p_confirmacion:'Iconic'}]);expect(errores).toEqual([]);
});

test('organización no tiene controles de borrado global',async({page})=>{
 await preparar(page,{global:false});await page.getByRole('button',{name:'Administrar cuentas',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Vínculos de Iconic'})).toBeVisible();
 await expect(page.getByRole('button',{name:/Eliminar definitivamente/})).toHaveCount(0);
});

test('aceptar invitación permite elegir usuario y contraseña',async({page})=>{
 const {errores}=await preparar(page,{invitacion:true});
 await expect(page.getByRole('heading',{name:'Preparar tu acceso personal'})).toBeVisible();
 await page.getByLabel('Nombre de usuario',{exact:true}).fill('jurado_nuevo');
 await page.getByLabel('Nueva contraseña',{exact:true}).fill('nueva-password');await page.getByLabel('Repetir contraseña',{exact:true}).fill('nueva-password');
 await page.getByRole('button',{name:'Guardar y continuar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Mi cuenta',exact:true})).toBeVisible();
 await expect(page.locator('.workspace-cuenta strong')).toHaveText('jurado_nuevo');expect(errores).toEqual([]);
});
