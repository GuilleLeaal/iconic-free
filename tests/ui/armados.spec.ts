import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ManualGroup } from '../../src/features/clasificatorias/armadoClasiService';
import type { ConfirmedCross } from '../../src/features/eliminatorias/initialCrosses';

async function prepare(page: Page, members = 1, results = false) {
  const usuario = '40000000-0000-4000-8000-000000000001', competencia = '40000000-0000-4000-8000-000000000002', fechaId = '40000000-0000-4000-8000-000000000003';
  const fecha = { id: fechaId, competencia_id: competencia, nombre: 'Fecha manual', estado: results ? 'en_curso' : 'inscripciones', integrantes_por_equipo: members,
    jurados_eliminatorias: 3, jurados_por_grupo_clasi: 1, fase_inicial: 'octavos', por_cruce: 3, cupos: 24, maximo_tanda: 5, grupos_clasi: null,
    clasis_modo: 'automaticas', armado_clasis: 'manual', llave_fija: false, configuracion_version: 1, fecha_evento: null, creado_en: '2026-11-09' };
  const user = { id: usuario, email: 'manual@test.local', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' };
  const token = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: usuario, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url') + '.test';
  type Entry = { id: string; nombre: string; version: number; integrantes: string[] };
  const entries: Entry[] = results ? Array.from({ length: 6 }, (_, i) => ({ id: `mc-${i + 1}`, nombre: `MC ${i + 1}`, version: 1, integrantes: [`MC ${i + 1}`] })) : [];
  let layout = { version: 0, grupos: [] as ManualGroup[] };
  let started = results;
  let closed = false;
  const submissions: { p_modo: string; p_cruces: ConfirmedCross[] }[] = [];
  const batches = () => layout.grupos.flatMap(g => g.tandas.flatMap((t, i) => {
    const ids = t.posiciones.filter(Boolean); if (!ids.length) return [];
    return [{ id: t.id, grupo_id: g.nombre, numero: i + 1, entradas: ids.map(id => entries.find(e => e.id === id)!), estado: 'en_curso', version: 1, participantes_bloqueados: false }];
  }));
  const sorteo = () => started ? { id: 'sorteo', plan: { tipo: 'clasificatorias', total: entries.length, clasifican: fecha.cupos, grupos: layout.grupos.map(g => ({ nombre: g.nombre })) } } : null;
  await page.route('http://127.0.0.1:54321/**', async route => {
    const req = route.request(), url = new URL(req.url()), body = req.postDataJSON() ?? {};
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*', 'content-range': `0-${Math.max(0, entries.length - 1)}/${entries.length}` } });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.pathname.includes('/auth/v1/token')) return json({ access_token: token, refresh_token: 'test', expires_in: 3600, token_type: 'bearer', user });
    if (url.pathname.endsWith('/auth/v1/user')) return json(user);
    if (url.pathname.endsWith('/perfiles')) return json({ id: usuario, nombre: 'organizacion', nombre_usuario: 'organizacion' });
    if (url.pathname.endsWith('/rpc/mis_contextos')) return json({ administrador: false, competencias: [{ id: competencia, nombre: 'Iconic', organizacion: true, jurado: false }] });
    if (url.pathname.endsWith('/rpc/mis_invitaciones')) return json([]);
    if (url.pathname.endsWith('/fechas')) return json(url.searchParams.has('id') ? fecha : [fecha]);
    if (url.pathname.endsWith('/armados_clasificatorias')) return json(layout.version ? layout : null);
    if (url.pathname.endsWith('/inscripciones')) return json(entries.map(e => ({ ...e, fecha_id: fechaId, activa: true, creado_en: '2026-11-09', integrantes: e.integrantes.map((alias, i) => ({ id: e.id + '-' + i, alias, orden: i + 1 })) })));
    if (url.pathname.endsWith('/sorteos')) return json(sorteo());
    if (url.pathname.endsWith('/clasificatorias')) return json({ id: 'clasi', fecha_id: fechaId, sorteo_id: 'sorteo', estado: closed ? 'finalizada' : 'en_curso', clasifican: fecha.cupos, casillas: ['Puntos'] });
    if (url.pathname.endsWith('/grupos_clasificatorias')) return json(layout.grupos.filter(g => g.tandas.some(t => t.posiciones.some(Boolean))).map(g => ({ id: g.nombre, nombre: g.nombre, clasificatoria_id: 'clasi' })));
    if (url.pathname.endsWith('/tandas_clasificatorias')) return json(batches());
    if (url.pathname.endsWith('/jurados_clasificatorias') || url.pathname.endsWith('/votaciones_clasificatorias') || url.pathname.endsWith('/jurados_fecha') || url.pathname.endsWith('/planillas_fecha')) return json([]);
    if (url.pathname.endsWith('/rpc/buscar_jurados_competencia')) return json({ filas: [], hay_mas: false });
    if (url.pathname.endsWith('/rpc/guardar_armado_clasificatorias')) { layout = { version: layout.version + 1, grupos: body.p_grupos }; return json(layout); }
    if (url.pathname.endsWith('/rpc/inscribir_en_ronda')) {
      const id = 'entry-' + entries.length;
      entries.push({ id, nombre: members === 1 ? body.p_integrantes[0] : body.p_nombre || body.p_integrantes.join(' / '), integrantes: body.p_integrantes, version: 1 });
      layout.grupos.flatMap(g => g.tandas).find(t => t.id === body.p_tanda_id)!.posiciones[body.p_posicion - 1] = id;
      layout.version++; return json(layout);
    }
    if (url.pathname.endsWith('/rpc/iniciar_clasificatorias')) { started = true; fecha.estado = 'en_curso'; return json('clasi'); }
    if (url.pathname.endsWith('/rpc/consultar_ranking_clasificatoria')) return json({
      clasificatoria_id: 'clasi', fecha_id: fechaId, estado: closed ? 'finalizada' : 'en_curso', fecha_estado: 'en_curso', clasifican: 24, efectivos: 6, puntuados: 6,
      fase_inicial: 'octavos', casillas: ['Puntos'], total: 6, completos: 6, lista_para_cerrar: true, jurados_consistentes: true, tandas_total: 2, tandas_finalizadas: 2,
      filas: entries.map((e, i) => ({ inscripcion_id: e.id, entrada: e, grupo: 'A', tanda: 1, puesto: i + 1, completa: true, sin_puntuar: false, puntos: 9 - i, jurados_esperados: 1, jurados_finalizados: 1, detalle_jurados: [] })),
      corte: { puntos: 4, directos: entries.map(e => e.id), empatados: [], cupos: 0, requiere_desempate: false }, version: 'v1',
      cierre: closed ? { clasificados: entries, ganadores_desempate: [], nota_desempate: null, cerrado_en: '2026-11-09' } : null,
    });
    if (url.pathname.endsWith('/rpc/cerrar_clasificatorias_con_armado')) { submissions.push(body); closed = true; return json('sorteo'); }
    throw Error('Solicitud sin fixture: ' + url.pathname);
  });
  await page.goto('/'); await page.getByLabel('Correo', { exact: true }).fill(user.email); await page.getByLabel('Contraseña', { exact: true }).fill('password-test');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir Fecha manual', exact: true }).click();
  if (results) await page.getByRole('button', { name: 'Resultados', exact: true }).click();
  return { submissions, getLayout: () => layout };
}

for (const members of [1, 2]) test(`clasis manual: inscripción de ${members} integrante(s), lugares libres, movimiento y comienzo`, async ({ page }, info) => {
  const { getLayout } = await prepare(page, members);
  await expect(page.getByRole('button', { name: 'Sorteos', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar clasi A', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar ronda a Clasi A', exact: true }).click();
  await page.getByRole('button', { name: 'Inscribir en Clasi A · Ronda 1 · Lugar 5', exact: true }).click();
  if (members === 1) await page.getByLabel('Alias', { exact: true }).fill('Último');
  else for (let i = 0; i < members; i++) await page.getByLabel(`Alias del integrante ${i + 1}`, { exact: true }).fill(['Luna', 'Norte'][i]);
  await page.getByRole('button', { name: 'Inscribir en este lugar', exact: true }).click();
  await page.getByRole('button', { name: 'Inscribir en Clasi A · Ronda 1 · Lugar 1', exact: true }).click();
  if (members === 1) await page.getByLabel('Alias', { exact: true }).fill('Primero');
  else for (let i = 0; i < members; i++) await page.getByLabel(`Alias del integrante ${i + 1}`, { exact: true }).fill(['Este', 'Sur'][i]);
  await page.getByRole('button', { name: 'Inscribir en este lugar', exact: true }).click();
  await expect(page.getByText('2/5 inscriptos', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar ronda a Clasi A', exact: true }).click();
  await page.getByRole('button', { name: 'Agregar clasi B', exact: true }).click();
  await page.getByRole('button', { name: 'Mover', exact: true }).first().click();
  const round = getLayout().grupos[0].tandas[1].id;
  await page.getByLabel('Mover desde Clasi A · Ronda 1 · Lugar 1').selectOption(round + ':2');
  await expect(page.getByText('1/5 inscriptos', { exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByText('1/5 inscriptos', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Clasi B', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('manual-clasis.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continuar a clasificatorias', exact: true }).click();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Comenzar clasificatorias', exact: true }).click();
  await expect(page.getByText('Clasificatorias en curso', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tanda 1', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tanda 2', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Clasis B', exact: true })).toHaveCount(0);
});

for (const mode of ['puntaje', 'manual', 'sorteo']) test(`vista previa y confirmación exacta de cruces por ${mode}`, async ({ page }, info) => {
  const { submissions } = await prepare(page, 1, true);
  await page.getByLabel('Armado de cruces', { exact: true }).selectOption(mode);
  const editor = page.locator('.armado-cruces');
  const cards = editor.locator('.tanda-clasi');
  const confirm = page.getByRole('button', { name: 'Cerrar clasis e iniciar eliminatorias', exact: true });
  if (mode === 'puntaje') {
    await expect(cards.nth(0)).toContainText('MC 1'); await expect(cards.nth(0)).toContainText('MC 3');
    await expect(cards.nth(1)).toContainText('MC 4'); await expect(cards.nth(1)).toContainText('MC 6');
  }
  if (mode === 'manual') {
    await expect(confirm).toBeDisabled();
    await page.getByRole('button', { name: 'Completar por puntaje', exact: true }).click();
    await page.getByLabel('Lugar 1 del cruce 1', { exact: true }).selectOption('mc-4');
    await expect(page.getByLabel('Lugar 1 del cruce 2', { exact: true })).toHaveValue('mc-1');
  }
  await expect(confirm).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('cruces-' + mode + '.png'), fullPage: true });
  const expected = mode === 'manual'
    ? [['mc-4', 'mc-2', 'mc-3'], ['mc-1', 'mc-5', 'mc-6'], [], [], [], [], [], []]
    : mode === 'puntaje' ? [['mc-1', 'mc-2', 'mc-3'], ['mc-4', 'mc-5', 'mc-6'], [], [], [], [], [], []]
    : await cards.evaluateAll(elements => elements.map(el => [...el.querySelectorAll('strong')].map(s => 'mc-' + s.textContent!.split(' ')[1])));
  page.once('dialog', d => d.accept()); await confirm.click();
  await expect(page.getByRole('button', { name: 'Ver eliminatorias', exact: true })).toBeVisible();
  expect(submissions).toHaveLength(1); expect(submissions[0].p_modo).toBe(mode);
  expect(submissions[0].p_cruces.map(c => c.inscripciones)).toEqual(expected);
});
