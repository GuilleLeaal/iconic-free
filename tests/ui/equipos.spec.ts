import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function preparar(page:Page,cantidad:number,jurado=false) {
 const usuario='30000000-0000-4000-8000-000000000001',competencia='30000000-0000-4000-8000-000000000002',fechaId='30000000-0000-4000-8000-000000000003';
 const fecha={id:fechaId,competencia_id:competencia,nombre:'Fecha en equipos',estado:jurado?'en_curso':'inscripciones',integrantes_por_equipo:cantidad,jurados_eliminatorias:3,jurados_por_grupo_clasi:1,fase_inicial:'octavos',por_cruce:2,cupos:16,maximo_tanda:6,grupos_clasi:1,clasis_modo:'automaticas',llave_fija:false,configuracion_version:1,fecha_evento:null,creado_en:'2026-11-03'};
 const user={id:usuario,email:'equipo@prueba.local',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01'};
 const token=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:usuario,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')+'.test';
 type Entrada={id:string;nombre:string;version:number;integrantes:string[]};
 const inscripciones:Entrada[]=jurado?[{id:'anterior',nombre:'Equipo anterior',version:1,integrantes:Array.from({length:cantidad},(_,i)=>'Anterior '+i)}]:[];
 const llamadas:Record<string,unknown>[]=[];
 await page.route('http://127.0.0.1:54321/**',async route=>{
  const req=route.request(),u=new URL(req.url()),body=req.postDataJSON()??{};
  const json=(data:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*','content-range':`0-${Math.max(0,inscripciones.length-1)}/${inscripciones.length}`}});
  if(req.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
  if(u.pathname.includes('/auth/v1/token')) return json({access_token:token,refresh_token:'test',expires_in:3600,token_type:'bearer',user});
  if(u.pathname.endsWith('/auth/v1/user')) return json(user);
  if(u.pathname.endsWith('/perfiles')) return json({id:usuario,nombre:'organizacion',nombre_usuario:'organizacion'});
  if(u.pathname.endsWith('/rpc/mis_contextos')) return json({administrador:false,competencias:[{id:competencia,nombre:'Iconic',organizacion:!jurado,jurado}]});
  if(u.pathname.endsWith('/rpc/mis_invitaciones')) return json([]);
  if(u.pathname.endsWith('/fechas')) return json(u.searchParams.has('id')?fecha:[fecha]);
  if(u.pathname.endsWith('/sorteos')) return json(null);
  if(u.pathname.endsWith('/inscripciones')) return json(inscripciones.map(e=>({...e,fecha_id:fechaId,activa:true,creado_en:'2026-11-03',integrantes:e.integrantes.map((alias,i)=>({id:e.id+'-'+i,alias,orden:i+1}))})));
  if(u.pathname.endsWith('/grupos_clasificatorias')) return json([{id:'grupo',nombre:'A',clasificatoria:{id:'clasi',estado:'en_curso',casillas:['Puntos'],fecha}}]);
  if(u.pathname.endsWith('/rpc/consultar_tandas_jurado')) return json({tandas:[{id:'tanda',grupo_id:'grupo',numero:1,entradas:inscripciones,estado:'en_curso',participantes_bloqueados:false,version:inscripciones.length}],votos:[]});
  if(u.pathname.endsWith('/rpc/crear_inscripcion')||u.pathname.endsWith('/rpc/agregar_participante_clasi')) {
   llamadas.push(body);const id='equipo-'+inscripciones.length;
   inscripciones.push({id,nombre:body.p_nombre?.trim()||body.p_integrantes.join(' / '),version:1,integrantes:body.p_integrantes});
   return json(jurado?{inscripcion_id:id,tanda_id:'tanda',numero:1}:id);
  }
  if(u.pathname.endsWith('/rpc/modificar_inscripcion')) {
   llamadas.push(body);const entrada=inscripciones.find(e=>e.id===body.p_id)!;
   entrada.nombre=body.p_nombre?.trim()||body.p_integrantes.join(' / ');entrada.integrantes=body.p_integrantes;entrada.version++;
   return json(null);
  }
  throw Error('Solicitud sin fixture: '+u.pathname);
 });
 await page.goto('/');await page.getByLabel('Correo',{exact:true}).fill('equipo@prueba.local');await page.getByLabel('Contraseña',{exact:true}).fill('password-test');await page.getByRole('button',{name:'Ingresar',exact:true}).click();
 if(!jurado) await page.getByRole('button',{name:'Abrir Fecha en equipos',exact:true}).click();
 return {llamadas};
}

for(const cantidad of [2,3]) {
 test(`equipo de ${cantidad}: nombre opcional en alta y edición, alias obligatorios`,async({page})=>{
  const {llamadas}=await preparar(page,cantidad);
  const nombre=page.getByLabel('Nombre del equipo (opcional)',{exact:true});
  await expect(nombre).not.toHaveAttribute('required');
  await page.getByLabel('Alias del integrante 1',{exact:true}).fill('Luna');
  await page.getByRole('button',{name:'Anotar equipo',exact:true}).click();expect(llamadas).toHaveLength(0);
  const alias=['Luna','Norte','Sur'].slice(0,cantidad);
  for(let i=1;i<cantidad;i++) await page.getByLabel('Alias del integrante '+(i+1),{exact:true}).fill(alias[i]);
  await page.getByRole('button',{name:'Anotar equipo',exact:true}).click();
  await expect(page.getByRole('heading',{name:alias.join(' / '),exact:true})).toBeVisible();
  expect(llamadas[0].p_nombre).toBe('');
  await page.getByRole('button',{name:'Editar a '+alias.join(' / '),exact:true}).click();
  await expect(nombre).toHaveValue('');await expect(nombre).not.toHaveAttribute('required');
  await page.getByLabel('Integrante 2',{exact:true}).fill('Este');alias[1]='Este';
  await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
  await expect(page.getByRole('heading',{name:alias.join(' / '),exact:true})).toBeVisible();
  expect(llamadas[1].p_nombre).toBe('');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
 test(`alta tardía de equipo de ${cantidad} sin nombre conserva la nota pendiente`,async({page})=>{
  const {llamadas}=await preparar(page,cantidad,true);
  await page.getByRole('spinbutton').first().fill('0');
  await page.getByRole('button',{name:'Agregar participante',exact:true}).click();
  await expect(page.getByLabel('Nombre del equipo (opcional)',{exact:true})).not.toHaveAttribute('required');
  const alias=['Luna','Norte','Sur'].slice(0,cantidad);
  for(let i=0;i<cantidad;i++) await page.getByLabel('Integrante '+(i+1),{exact:true}).fill(alias[i]);
  await page.getByRole('button',{name:'Registrar participante',exact:true}).click();
  await expect(page.getByRole('heading',{name:alias.join(' / '),exact:true})).toBeVisible();
  await expect(page.getByRole('spinbutton').first()).toHaveValue('0');expect(llamadas[0].p_nombre).toBe('');
 });
}
