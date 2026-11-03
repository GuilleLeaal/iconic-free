import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const usuario = '00000000-0000-4000-8000-000000000001';
const compA = '00000000-0000-4000-8000-000000000002';
const compB = '00000000-0000-4000-8000-000000000003';
const fechaPrueba = '00000000-0000-4000-8000-000000000004';
async function preparar(page: Page, organizacion = false, global = false, conFecha = false, falloEliminar = false, falloRetiro = false) {
  const guardados: Record<string, { version: number; estado: string; puntuaciones: unknown }> = {};
  const envios: { p_tanda_id: string; p_puntuaciones: unknown[] }[] = [];
  let intentosCorreo = 0;
  let fechaEliminada = false;
  const eliminaciones: Record<string, unknown>[] = [];
  const retiros: Record<string, unknown>[] = [];
  const retirados = new Set<string>();
  const user = { id: usuario, email: 'jurado@test.local', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' };
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: usuario, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url')}.test`;
  await page.route('http://127.0.0.1:54321/**', async route => {
    const req = route.request(), u = new URL(req.url());
    const body = req.postDataJSON() ?? {};
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*', 'content-range': '0-0/0' } });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.pathname.includes('/auth/v1/token')) return json({ access_token: token, refresh_token: 'refresh-test', token_type: 'bearer', expires_in: 3600, user });
    if (u.pathname.includes('/auth/v1/user')) return json(user);
    if (u.pathname.endsWith('/perfiles')) return json({ id: usuario, nombre: 'Jurado personal' });
    if (u.pathname.endsWith('/rpc/mis_contextos')) return json({ administrador: global, competencias: [{ id: compA, nombre: 'Iconic', organizacion, jurado: !organizacion }, { id: compB, nombre: 'Otra competencia', organizacion: false, jurado: true }] });
    if (u.pathname.endsWith('/rpc/mis_invitaciones')) return json([]);
    if (u.pathname.endsWith('/fechas')) return json(conFecha && !fechaEliminada ? [{
      id: fechaPrueba, competencia_id: compA, nombre: 'Fecha de prueba', fecha_evento: null,
      integrantes_por_equipo: 1, jurados_eliminatorias: 3, jurados_por_grupo_clasi: 2,
      estado: 'borrador', creado_en: '2026-01-01', fase_inicial: 'octavos', por_cruce: 2,
      cupos: 16, clasis_modo: 'automaticas', grupos_clasi: null, maximo_tanda: 5, llave_fija: false, configuracion_version: 1,
    }] : []);
    if (u.pathname.endsWith('/rpc/eliminar_fecha')) {
      eliminaciones.push(body);
      if (falloEliminar && eliminaciones.length === 1) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'P0001', message: 'No tenés permiso para eliminar esta fecha.' }), headers: { 'access-control-allow-origin': '*' } });
      fechaEliminada = true; return json(null);
    }
    if (u.pathname.endsWith('/rpc/buscar_competencias')) return json({ filas: [{ id: compA, nombre: 'Iconic', activa: true }, { id: compB, nombre: 'Otra competencia', activa: true }], hay_mas: false });
    if (u.pathname.endsWith('/rpc/buscar_cuentas')) return json({ filas: [{ id: usuario, nombre: 'Cuenta vinculada', email: global ? 'vinculada@test.local' : null, vinculos: [{ competencia_id: compA, competencia: 'Iconic', rol: 'jurado', estado: 'activo' }] }], hay_mas: false });
    if (u.pathname.endsWith('/rpc/buscar_invitaciones')) return json({ filas: [], hay_mas: false });
    if (u.pathname.endsWith('/rpc/preparar_invitacion')) return json('00000000-0000-4000-8000-000000000009');
    if (u.pathname.endsWith('/functions/v1/gestionar-invitacion')) {
      intentosCorreo++;
      if (intentosCorreo === 1) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'SMTP no disponible' }), headers: { 'access-control-allow-origin': '*' } });
      return json({ enviada: true, reutilizada: false });
    }
    if (u.pathname.endsWith('/grupos_clasificatorias')) {
      const id = u.searchParams.get('clasificatoria.fecha.competencia_id')?.slice(3) ?? compA;
      return json([{ id: `grupo-${id}`, nombre: 'A', clasificatoria: { id: `clasi-${id}`, estado: 'en_curso', casillas: ['Métrica', 'Respuesta'], fecha: { id: `fecha-${id}`, nombre: id === compA ? 'Fecha Iconic' : 'Fecha ajena', estado: 'en_curso', integrantes_por_equipo: 1, maximo_tanda: 2 } } }]);
    }
    if (u.pathname.endsWith('/rpc/consultar_tandas_jurado')) {
      const id = body.p_grupo_id.replace('grupo-', '');
      const tanda = `tanda-${id}`, voto = guardados[tanda];
      const entradas = [{ id: `mc1-${id}`, nombre: id === compA ? 'MC Iconic' : 'MC Otra', integrantes: ['MC'], version: 1 }, { id: `mc2-${id}`, nombre: 'MC Sin puntos', integrantes: ['MC2'], version: 1 }];
      return json({ tandas: [{ id: tanda, grupo_id: body.p_grupo_id, numero: 1, entradas: entradas.filter(e=>!retirados.has(e.id)), retirados: entradas.filter(e=>retirados.has(e.id)), estado: 'en_curso', participantes_bloqueados: voto?.estado === 'finalizada', version: 1 + entradas.filter(e=>retirados.has(e.id)).length }], votos: voto ? [{ id: `voto-${id}`, tanda_id: tanda, jurado_id: usuario, ...voto }] : [] });
    }
    if (u.pathname.endsWith('/rpc/retirar_participante_clasi')) {
      retiros.push(body);
      if(falloRetiro && retiros.length===1) return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'P0001',message:'La tanda cambió. Actualizá antes de retirar al participante.'}),headers:{'access-control-allow-origin':'*'}});
      retirados.add(body.p_inscripcion_id);
      const voto=guardados[body.p_tanda_id];
      if(voto) { voto.puntuaciones=(voto.puntuaciones as {inscripcion_id:string}[]).filter(p=>p.inscripcion_id!==body.p_inscripcion_id); voto.version++; }
      return json(null);
    }
    if (u.pathname.endsWith('/rpc/guardar_votacion_clasificatoria')) {
      envios.push(body); const version = (guardados[body.p_tanda_id]?.version ?? 0) + 1;
      guardados[body.p_tanda_id] = { version, estado: body.p_finalizar ? 'finalizada' : 'borrador', puntuaciones: body.p_puntuaciones };
      return json(version);
    }
    throw new Error(`Solicitud sin fixture: ${req.method()} ${u.pathname}`);
  });
  await page.goto('/');
  await page.getByLabel('Correo', { exact: true }).fill('jurado@test.local');
  await page.getByLabel('Contraseña', { exact: true }).fill('password-test');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  return { envios, eliminaciones, retiros };
}
test('finaliza parcial, cancelar conserva cero, recarga borrador y bloquea retiros', async ({ page }) => {
  const { envios } = await preparar(page);
  const metrica = page.getByRole('spinbutton').first();
  await expect(metrica).toBeVisible(); await metrica.fill('0');
  await expect(page.getByRole('button', { name: /Retirar por ausencia/ })).toHaveCount(2);
  page.once('dialog', async d => { expect(d.message()).toContain('3 casillas vacías'); expect(d.message()).toContain('MC Sin puntos'); await d.dismiss(); });
  await page.getByRole('button', { name: 'Finalizar planilla', exact: true }).click();
  expect(envios).toHaveLength(0); await expect(metrica).toHaveValue('0');
  await page.reload(); await expect(page.getByRole('spinbutton').first()).toHaveValue('0');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Finalizar planilla', exact: true }).click();
  await expect(page.getByText('Tu planilla está finalizada', { exact: false })).toBeVisible();
  expect(envios).toHaveLength(1);
  expect(envios[0].p_puntuaciones).toEqual([{ inscripcion_id: `mc1-${compA}`, casillas: [0, null] }, { inscripcion_id: `mc2-${compA}`, casillas: [null, null] }]);
  await expect(page.getByRole('spinbutton').first()).toBeDisabled();
  await expect(page.getByRole('button', { name: /Retirar por ausencia/ })).toHaveCount(0);
});
test('retirar por ausencia confirma, conserva las otras notas y no reaparece al recargar', async ({page})=>{
  const {retiros}=await preparar(page);
  await page.getByRole('spinbutton').first().fill('0');
  const retirar=page.getByRole('button',{name:'Retirar por ausencia a MC Sin puntos',exact:true});
  page.once('dialog',d=>d.dismiss());await retirar.click();expect(retiros).toHaveLength(0);
  page.once('dialog',d=>d.accept());await retirar.click();
  await expect(page.getByRole('heading',{name:'MC Sin puntos',exact:true})).toHaveCount(0);
  await expect(page.getByRole('spinbutton').first()).toHaveValue('0');
  expect(retiros).toEqual([{p_tanda_id:`tanda-${compA}`,p_inscripcion_id:`mc2-${compA}`,p_version:1}]);
  await page.reload();await expect(page.getByRole('spinbutton').first()).toHaveValue('0');
  await expect(page.getByRole('heading',{name:'MC Sin puntos',exact:true})).toHaveCount(0);
});
test('un retiro rechazado conserva participante y permite reintentar',async({page})=>{
  const {retiros}=await preparar(page,false,false,false,false,true);
  const retirar=page.getByRole('button',{name:'Retirar por ausencia a MC Sin puntos',exact:true});
  page.once('dialog',d=>d.accept());await retirar.click();
  await expect(page.getByRole('heading',{name:'MC Sin puntos',exact:true})).toBeVisible();
  await expect(page.getByText('La tanda cambió. Actualizá antes de retirar al participante.')).toBeVisible();
  page.once('dialog',d=>d.accept());await retirar.click();
  await expect(page.getByRole('heading',{name:'MC Sin puntos',exact:true})).toHaveCount(0);
  expect(retiros).toHaveLength(2);
});
test('planilla completamente vacía se finaliza sin inventar puntos', async ({ page }) => {
  const { envios } = await preparar(page);
  await expect(page.getByRole('button', { name: 'Finalizar planilla', exact: true })).toBeVisible();
  page.once('dialog', async d => { expect(d.message()).toContain('4 casillas vacías'); expect(d.message()).toContain('MC Iconic'); await d.accept(); });
  await page.getByRole('button', { name: 'Finalizar planilla', exact: true }).click();
  await expect(page.getByText('Tu planilla está finalizada', { exact: false })).toBeVisible();
  expect(envios[0].p_puntuaciones.every((f: unknown) => (f as { casillas: unknown[] }).casillas.every(p => p === null))).toBe(true);
});
test('cambiar competencia limpia pantalla y conserva borradores de su contexto', async ({ page }) => {
  await preparar(page);
  await expect(page.getByRole('spinbutton').first()).toBeVisible(); await page.getByRole('spinbutton').first().fill('3.5');
  await page.getByLabel('Competencia activa').selectOption(compB);
  await expect(page.getByRole('heading', { name: 'Fecha ajena · Clasis A' })).toBeVisible();
  await expect(page.getByRole('spinbutton').first()).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'MC Iconic', exact: true })).toHaveCount(0);
  await page.getByLabel('Competencia activa').selectOption(compA);
  await expect(page.getByRole('spinbutton').first()).toHaveValue('3.5');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('nueva fecha expone seis combinaciones coherentes, sin límite de inscripciones', async ({ page }, testInfo) => {
  await preparar(page, true);
  await page.getByRole('button', { name: 'Nueva fecha' }).click();
  await expect(page.getByLabel('Jurados de eliminatorias', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Fase inicial')).toHaveValue('octavos');
  await expect(page.getByLabel('Primera fase')).toHaveValue('2');
  for (const fase of ['octavos', 'dieciseisavos']) for (const por of [2, 3, 4]) {
    await page.getByLabel('Fase inicial').selectOption(fase); await page.getByLabel('Primera fase').selectOption(String(por));
    await expect(page.getByText(`Clasifican ${(fase === 'octavos' ? 8 : 16) * por} inscripciones. Después de la primera fase continúan duelos.`)).toBeVisible();
  }
  await expect(page.locator('summary').filter({ hasText: 'Configuración avanzada' })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Configuración avanzada' }).click();
  await expect(page.getByLabel('Cuándo realizar clasificatorias')).toHaveCount(0);
  await expect(page.getByText('Si hay más de 64 inscripciones, se realizan clasificatorias para seleccionar quiénes pasan a eliminatorias. Con esa cantidad o menos, pasan directamente.')).toBeVisible();
  await page.getByLabel('Máximo por tanda').selectOption('6');
  await expect(page.getByLabel('Máximo por tanda')).toHaveValue('6');
  await expect(page.getByLabel(/límite de inscripciones/i)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('configuracion.png'), fullPage: true });
});
test('administración global tiene filtros y un error de correo conserva el reintento', async ({ page }) => {
  await preparar(page, true, true);
  await page.getByRole('button', { name: 'Administración global', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Directorio global' })).toBeVisible();
  await page.locator('summary').filter({ hasText: /^Competencias/ }).click();
  await expect(page.getByLabel('Estado de competencias')).toBeVisible();
  await expect(page.getByLabel('Alcance de cuentas')).toHaveValue('global');
  await page.locator('summary').filter({ hasText: 'Invitar o vincular una cuenta personal' }).click();
  await page.getByLabel('Correo', { exact: true }).fill('nueva@test.local');
  await page.getByRole('button', { name: 'Preparar vínculo y enviar acceso' }).click();
  await expect(page.getByRole('alert')).toContainText('vínculo quedó pendiente');
  await expect(page.getByText('Correo enviado.', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reintentar / reenviar correo' }).click();
  await expect(page.getByRole('status')).toContainText('Correo enviado');
});
test('enlace vencido explica cómo recuperar el acceso', async ({ page }) => {
  await page.route('http://127.0.0.1:54321/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}', headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/#error=access_denied&error_code=otp_expired');
  await expect(page.getByRole('alert')).toContainText('El enlace venció');
  await page.getByLabel('Correo', { exact: true }).fill('personal@test.local');
  await page.getByRole('button', { name: 'Recuperar acceso / solicitar enlace nuevo' }).click();
  await expect(page.getByRole('status')).toContainText('recibirás un enlace de acceso');
});
test('eliminar fecha confirma el contexto; cancelar conserva y aceptar quita la tarjeta', async ({ page }) => {
  const { eliminaciones } = await preparar(page, true, false, true);
  await expect(page.getByRole('heading', { name: 'Fecha de prueba', exact: true })).toBeVisible();
  page.once('dialog', async d => { expect(d.message()).toContain('Fecha de prueba'); expect(d.message()).toContain('Iconic'); expect(d.message()).toContain('se conservarán'); await d.dismiss(); });
  await page.getByRole('button', { name: 'Eliminar Fecha de prueba', exact: true }).click();
  expect(eliminaciones).toHaveLength(0);
  await expect(page.getByRole('heading', { name: 'Fecha de prueba', exact: true })).toBeVisible();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Eliminar Fecha de prueba', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Fecha de prueba', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('eliminada');
  expect(eliminaciones).toEqual([{ p_fecha_id: fechaPrueba, p_competencia_id: compA }]);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Todavía no hay fechas' })).toBeVisible();
});
test('si eliminar falla conserva la fecha y permite reintentar', async ({ page }) => {
  const { eliminaciones } = await preparar(page, true, false, true, true);
  page.on('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Eliminar Fecha de prueba', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No tenés permiso');
  await expect(page.getByRole('heading', { name: 'Fecha de prueba', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar Fecha de prueba', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Todavía no hay fechas' })).toBeVisible();
  expect(eliminaciones).toHaveLength(2);
});
