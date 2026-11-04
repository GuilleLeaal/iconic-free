import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Escenario visual completo, aislado del proyecto remoto. Los nombres y datos
// son fixtures; ninguna solicitud llega al Supabase real.
const usuario='10000000-0000-4000-8000-000000000001';
const competencia='10000000-0000-4000-8000-000000000002';
const fechaId='10000000-0000-4000-8000-000000000003';
const inscripciones=['Luna','Norte','Cero','Sur','Ámbar','Tiza','Eco','Lince','Cauce','Faro','Río','Bruma'].map((nombre,i)=>({id:'mc-'+i,nombre,version:1,integrantes:[nombre]}));
const fecha={id:fechaId,competencia_id:competencia,nombre:'Edición de noviembre',fecha_evento:'2026-11-21',integrantes_por_equipo:1,jurados_eliminatorias:3,jurados_por_grupo_clasi:2,estado:'en_curso',creado_en:'2026-11-01',fase_inicial:'octavos',por_cruce:2,cupos:16,clasis_modo:'siempre',grupos_clasi:1,maximo_tanda:3,llave_fija:false,configuracion_version:1};
const fechas=[fecha,{...fecha,id:'fecha-preparacion',nombre:'Encuentro en la plaza',estado:'inscripciones',fecha_evento:'2026-12-05',por_cruce:3,cupos:24},{...fecha,id:'fecha-historica',nombre:'Edición aniversario',estado:'finalizada',fecha_evento:'2026-10-10'}];
const tandas=[0,1,2,3].map(i=>({id:'tanda-'+i,grupo_id:'grupo-a',numero:i+1,entradas:inscripciones.slice(i*3,i*3+3),estado:'finalizada',version:2,participantes_bloqueados:true}));
const clasi={id:'clasi-a',fecha_id:fechaId,sorteo_id:'sorteo-a',estado:'finalizada',casillas:['Técnica','Respuesta','Puesta en escena'],clasifican:16};
const sorteo={id:'sorteo-a',fecha_id:fechaId,vigente:true,creado_en:'2026-11-01',eliminatorias_aleatorias:true,plan:{version_algoritmo:2,tipo:'clasificatorias',total:12,integrantes_por_equipo:1,clasifican:16,fase_inicial:'octavos',grupos:[{nombre:'A',total:12,tandas:tandas.map(t=>({numero:t.numero,inscripciones:t.entradas}))}]}};

async function escenario(page: Page) {
 const user={id:usuario,email:'organizacion@prueba.local',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01'};
 const token=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:usuario,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')+'.test';
 await page.route('http://127.0.0.1:54321/**',async route=>{
  const req=route.request(),u=new URL(req.url()),body=req.postDataJSON()??{};
  const json=(data:unknown,total?:number)=>route.fulfill({status:200,contentType:'application/json',body:req.method()==='HEAD'?'':JSON.stringify(data),headers:{'access-control-allow-origin':'*',...(total===undefined?{}:{'content-range':'0-'+Math.max(0,total-1)+'/'+total})}});
  if(req.method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
  if(u.pathname.includes('/auth/v1/token')) return json({access_token:token,refresh_token:'test',expires_in:3600,token_type:'bearer',user});
  if(u.pathname.endsWith('/auth/v1/user')) return json(user);
  if(u.pathname.endsWith('/perfiles')) return json({id:usuario,nombre:'Organización Iconic'});
  if(u.pathname.endsWith('/rpc/mis_contextos')) return json({administrador:true,competencias:[{id:competencia,nombre:'Iconic',organizacion:true,jurado:true}]});
  if(u.pathname.endsWith('/rpc/mis_invitaciones')) return json([]);
  if(u.pathname.endsWith('/fechas')) {
   const id=u.searchParams.get('id')?.replace('eq.','');
   return json(id?fechas.find(f=>f.id===id)??fecha:fechas);
  }
  if(u.pathname.endsWith('/inscripciones')) return json(inscripciones.map(e=>({...e,fecha_id:fechaId,activa:true,integrantes:e.integrantes.map((alias,i)=>({id:alias,alias,orden:i+1}))})),12);
  if(u.pathname.endsWith('/sorteos')) return json(sorteo);
  if(u.pathname.endsWith('/clasificatorias')) return json(u.searchParams.has('sorteo_id')?clasi:[clasi]);
  if(u.pathname.endsWith('/grupos_clasificatorias')) return json(u.searchParams.get('select')?.includes('clasificatoria:')?
   [{id:'grupo-a',nombre:'A',clasificatoria:{...clasi,estado:'en_curso',fecha:{...fecha}}}]:[{id:'grupo-a',nombre:'A',clasificatoria_id:clasi.id}]);
  if(u.pathname.endsWith('/jurados_clasificatorias')) return json([{grupo_id:'grupo-a',jurado_id:usuario,nombre:'Eva'},{grupo_id:'grupo-a',jurado_id:'j2',nombre:'Julián'}]);
  if(u.pathname.endsWith('/tandas_clasificatorias')) return json(tandas);
  if(u.pathname.endsWith('/votaciones_clasificatorias')) return json(tandas.flatMap(t=>[{tanda_id:t.id,jurado_id:usuario,estado:'finalizada'},{tanda_id:t.id,jurado_id:'j2',estado:'finalizada'}]));
  if(u.pathname.endsWith('/rpc/consultar_tandas_jurado')) return json({tandas:tandas.map(t=>({...t,estado:'en_curso',participantes_bloqueados:false})),votos:[]});
  if(u.pathname.endsWith('/cruces_eliminatorias')) {
   const cruces=Array.from({length:8},(_,i)=>({id:'cruce-'+i,fecha_id:fechaId,sorteo_id:sorteo.id,fase:'octavos',numero:i+1,entradas:i<4?inscripciones.slice(i*2,i*2+2):[inscripciones[i+4]],listo:true,estado:i===0||i>=4?'resuelto':'pendiente',ganador_id:i===0?inscripciones[0].id:i>=4?inscripciones[i+4].id:null,resolucion:i===0?'manual':i>=4?'automatica':null,version:1}));
   return json(cruces,1);
  }
  if(u.pathname.endsWith('/rpc/consultar_ranking_clasificatoria')) return json({clasificatoria_id:clasi.id,fecha_id:fechaId,estado:'finalizada',fecha_estado:'en_curso',clasifican:16,efectivos:12,puntuados:12,fase_inicial:'octavos',casillas:clasi.casillas,total:12,completos:12,lista_para_cerrar:true,jurados_consistentes:true,tandas_total:4,tandas_finalizadas:4,
   filas:inscripciones.map((e,i)=>({inscripcion_id:e.id,entrada:e,grupo:'A',tanda:Math.floor(i/3)+1,puesto:i+1,completa:true,puntos:23-i*.5,jurados_esperados:2,jurados_finalizados:2,detalle_jurados:[{jurado_id:usuario,nombre:'Eva',estado:'finalizada',total:12-i*.25},{jurado_id:'j2',nombre:'Julián',estado:'finalizada',total:11-i*.25}]})),corte:{puntos:null,directos:inscripciones.map(e=>e.id),empatados:[],cupos:4,requiere_desempate:false},version:'visual-1',cierre:{clasificados:inscripciones,ganadores_desempate:[],nota_desempate:null,cerrado_en:'2026-11-01'}});
  if(u.pathname.endsWith('/rpc/buscar_jurados_competencia')) return json({filas:[{id:usuario,nombre:'Eva'},{id:'j2',nombre:'Julián'}],hay_mas:false});
  if(u.pathname.endsWith('/jurados_fecha')) return json([{id:'asig1',fecha_id:fechaId,jurado_id:usuario,apartado:'clasi_a',perfil:{nombre:'Eva'}},{id:'asig2',fecha_id:fechaId,jurado_id:'j2',apartado:'clasi_a',perfil:{nombre:'Julián'}}]);
  if(u.pathname.endsWith('/planillas_fecha')) return json({id:'planilla-a',fecha_id:fechaId,tipo:'clasificatorias',version:1,casillas:clasi.casillas});
  if(u.pathname.endsWith('/planillas_fases')) return json(null);
  if(u.pathname.endsWith('/rpc/buscar_competencias')) return json({filas:[{id:competencia,nombre:'Iconic',activa:true},{id:'competencia-sur',nombre:'Ronda del Sur',activa:true},{id:'competencia-parque',nombre:'Freestyle del Parque',activa:false}],hay_mas:false});
  if(u.pathname.endsWith('/rpc/buscar_cuentas')) return json({filas:[{id:'eva',nombre:'Eva',email:'eva@prueba.local',vinculos:[{competencia_id:competencia,competencia:'Iconic',rol:'jurado',estado:'activo'}]},{id:'julian',nombre:'Julián',email:'julian@prueba.local',vinculos:[{competencia_id:competencia,competencia:'Iconic',rol:'jurado',estado:'activo'},{competencia_id:'competencia-sur',competencia:'Ronda del Sur',rol:'organizacion',estado:'activo'}]},{id:'lucia',nombre:'Lucía',email:'lucia@prueba.local',vinculos:[{competencia_id:competencia,competencia:'Iconic',rol:'jurado',estado:'inactivo'}]}],hay_mas:false});
  if(u.pathname.endsWith('/rpc/buscar_invitaciones')) return json({filas:[{id:'invitacion',email:'nueva.persona@prueba.local',rol:'jurado',entrega:'enviada',vence_en:'2026-12-01',vencida:false,competencia_id:competencia,competencia:'Iconic'}],hay_mas:false});
  throw Error('Falta fixture visual: '+u.pathname+' '+JSON.stringify(body));
 });
 await page.goto('/');
 await page.getByLabel('Correo',{exact:true}).fill('organizacion@prueba.local');
 await page.getByLabel('Contraseña',{exact:true}).fill('test-password');
 await page.getByRole('button',{name:'Ingresar',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Edición de noviembre',exact:true})).toBeVisible();
}

test('recorrido visual: fechas, operación, configuración, cuentas y planillas',async({page},testInfo)=>{
 test.setTimeout(60000);
 const errores:string[]=[];
 page.on('pageerror',e=>errores.push(e.message));
 const captura=async(nombre:string)=>{
  await expect(page.locator('.mensaje-error')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(nombre+'.png'),fullPage:true});
 };
 await escenario(page);
 await captura('01-fechas');
 await page.getByLabel('Buscar fecha',{exact:true}).fill('aniversario');
 await expect(page.locator('.tarjeta-fecha')).toHaveCount(1);
 await page.getByLabel('Buscar fecha',{exact:true}).fill('');
 await page.getByRole('button',{name:'Abrir Edición de noviembre',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Participantes',exact:true})).toBeVisible();
 await captura('02-inscripciones');
 const nav=page.getByRole('navigation',{name:'Organización de la fecha'});
 for(const [nombre,archivo,titulo] of [['Sorteos','03-sorteos','Sorteo'],['Clasificatorias','04-clasificatorias','Clasificatorias'],['Resultados','05-resultados','Resultados de clasificatorias'],['Eliminatorias','06-eliminatorias','Eliminatorias'],['Configuración','07-configuracion','Configuración de la fecha']]) {
  await nav.getByRole('button',{name:nombre,exact:true}).click();
  await expect(page.getByRole('heading',{name:titulo,exact:true}).first()).toBeVisible();
  if(nombre==='Configuración') await expect(page.getByText('Planillas de eliminatorias',{exact:true})).toHaveCount(0);
  if(nombre==='Eliminatorias') await expect(page.getByText('Organización registra el ganador de cada cruce. Las eliminatorias no se votan en la web.')).toBeVisible();
  await captura(archivo);
 }
 await page.getByRole('button',{name:'Administración global',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Directorio global',exact:true})).toBeVisible();
 await expect(page.getByText('Julián',{exact:true})).toBeVisible();
 await captura('08-cuentas');
 await page.locator('summary').filter({hasText:/^Competencias/}).click();
 await expect(page.getByLabel('Estado de competencias')).toBeVisible();
 await captura('09-competencias');
 await page.getByRole('combobox',{name:'Actuar como',exact:true}).selectOption('jurado');
 await page.getByRole('button',{name:'Mis planillas',exact:false}).click();
 await expect(page.getByRole('spinbutton').first()).toBeVisible();
 await captura('10-jurado');
 expect(errores).toEqual([]);
});

test('pantalla de acceso legible y sin desbordes',async({page},testInfo)=>{
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Ingresar',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('00-acceso.png'),fullPage:true});
});

test('fecha creada vuelve al inicio y no hereda pestañas ni filtros anteriores',async({page})=>{
 await escenario(page);
 let nueva:typeof fecha|null=null;
 await page.route('http://127.0.0.1:54321/rest/v1/fechas*',async route=>{
  if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
  const url=new URL(route.request().url());
  if(route.request().method()==='POST') nueva={...fecha,...route.request().postDataJSON(),id:'10000000-0000-4000-8000-000000000009',estado:'borrador'};
  const lista=nueva?[nueva,...fechas]:fechas;
  const data=route.request().method()==='POST'?nueva:url.searchParams.has('id')?lista.find(f=>f.id===url.searchParams.get('id')?.slice(3)):lista;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
 });
 await page.goto('/?fecha='+fechaId+'&vista=eliminatorias');
 const nav=page.getByRole('navigation',{name:'Organización de la fecha'});
 await expect(nav.getByRole('button',{name:'Eliminatorias',exact:true})).toHaveAttribute('aria-current','page');
 await page.getByRole('button',{name:'Todas las fechas',exact:true}).click();
 expect(new URL(page.url()).search).toBe('');
 await page.getByLabel('Buscar fecha',{exact:true}).fill('aniversario');
 await page.getByRole('combobox',{name:'Estado de las fechas',exact:true}).selectOption('finalizada');
 await page.getByRole('button',{name:'Nueva fecha',exact:true}).click();
 await page.getByLabel('Nombre',{exact:true}).fill('Fecha recién creada');
 await page.getByRole('button',{name:'Crear fecha',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Fechas',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Fecha recién creada',exact:true})).toBeVisible();
 await expect(page.getByRole('status')).toContainText('Fecha "Fecha recién creada" creada.');
 await expect(page.getByLabel('Buscar fecha',{exact:true})).toHaveValue('');
 await expect(page.getByRole('combobox',{name:'Estado de las fechas',exact:true})).toHaveValue('');
 expect(new URL(page.url()).search).toBe('');
 await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
 await page.getByRole('button',{name:'Abrir Fecha recién creada',exact:true}).click();
 await expect(nav.getByRole('button',{name:'Inscripciones',exact:true})).toHaveAttribute('aria-current','page');
 expect(new URL(page.url()).searchParams.has('vista')).toBe(false);
});

test('resultados se ajustan al celular con equipos largos y detalle de cinco jurados',async({page},testInfo)=>{
 await escenario(page);
 const nombreLargo='LunaDelSurSinEspaciosParaComprobarElAncho / Norte de Montevideo / Cauce';
 await page.route('http://127.0.0.1:54321/rest/v1/rpc/consultar_ranking_clasificatoria',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
  clasificatoria_id:clasi.id,fecha_id:fechaId,estado:'en_curso',fecha_estado:'en_curso',clasifican:16,efectivos:12,puntuados:11,fase_inicial:'octavos',casillas:clasi.casillas,total:12,completos:11,lista_para_cerrar:true,jurados_consistentes:true,tandas_total:4,tandas_finalizadas:3,
  filas:inscripciones.map((e,i)=>({inscripcion_id:e.id,entrada:{...e,nombre:i===0?nombreLargo:e.nombre,integrantes:i===0?['LunaDelSurSinEspaciosParaComprobarElAncho','Norte de Montevideo','Cauce']:e.integrantes},grupo:'A',tanda:Math.floor(i/3)+1,puesto:i===2?null:i+1,completa:i!==3,sin_puntuar:i===2,casillas_vacias:i===3,puntos:i===0?59.75:i===1?0:i===2?null:23-i*.5,jurados_esperados:5,jurados_finalizados:i===3?4:5,detalle_jurados:Array.from({length:5},(_,j)=>({jurado_id:'jurado-'+j,nombre:j===0?'NombreDeJuradoLargoSinEspaciosParaProbarElDetalle':'Jurado '+(j+1),estado:'finalizada',total:j===0?0:j===1?null:11.5}))})),
  corte:{puntos:0,directos:inscripciones.slice(4).map(e=>e.id),empatados:inscripciones.slice(0,2).map(e=>e.id),cupos:1,requiere_desempate:true},version:'movil-1',cierre:null,
 }),headers:{'access-control-allow-origin':'*'}}));
 await page.getByRole('button',{name:'Abrir Edición de noviembre',exact:true}).click();
 await page.getByRole('navigation',{name:'Organización de la fecha'}).getByRole('button',{name:'Resultados',exact:true}).click();
 const tabla=page.getByRole('region',{name:'Tabla global'});
 await expect(tabla.locator('tbody tr')).toHaveCount(12);
 await tabla.locator('summary').first().click();
 await expect(tabla.locator('details[open] li')).toHaveCount(5);
 for(const width of [320,393,640,760]) {
  await page.setViewportSize({width,height:850});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await tabla.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  for(const fila of await tabla.locator('tbody tr').all()) expect(await fila.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await expect(tabla.locator('tbody tr').first().locator('.puntos-ranking')).toContainText('59,75');
  await expect(tabla.locator('tbody tr').nth(1).locator('.puntos-ranking')).toContainText('0');
  await expect(tabla.locator('tbody tr').nth(2).locator('.estado-ranking')).toContainText('Sin puntuar');
  if(width===393) await tabla.locator('tbody tr').first().screenshot({path:testInfo.outputPath('resultado-equipo-393.png')});
 }
 await page.setViewportSize({width:1280,height:900});
 expect(await tabla.locator('table').evaluate(e=>getComputedStyle(e).display)).toBe('table');
 await page.getByLabel('Buscar participante o equipo',{exact:true}).fill('LunaDelSur');
 await expect(tabla.locator('tbody tr')).toHaveCount(1);
 await expect(tabla.locator('tbody tr').first()).toContainText(nombreLargo);
});
