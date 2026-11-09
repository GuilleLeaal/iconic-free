import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nuevaBase, como } from './database.mjs';
import { buildInitialCrosses, confirmableCrosses } from '../src/features/eliminatorias/initialCrosses.ts';

async function fixture(until = 999) {
  const db = await nuevaBase(until);
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const v = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const rpc = (name, args = []) => v(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})`, args);
  const admin = randomUUID(), judge = randomUUID(), outsider = randomUUID();
  for (const [id, email] of [[admin, 'admin@manual.test'], [judge, 'judge@manual.test'], [outsider, 'other@manual.test']])
    await q('insert into auth.users(id,email) values($1,$2)', [id, email]);
  const competition = await v("select private.instalar_iconic($1,'admin@manual.test')", [admin]);
  await q("insert into public.vinculos_competencia(competencia_id,usuario_id,rol,estado) values($1,$2,'jurado','activo')", [competition, judge]);
  const asAdmin = fn => como(db, admin, fn);
  const date = (per = 2, phase = 'octavos', manual = true, fixed = false) => asAdmin(() => v("insert into public.fechas(competencia_id,nombre,integrantes_por_equipo,jurados_por_grupo_clasi,armado_clasis,maximo_tanda,por_cruce,fase_inicial,llave_fija) values($1,'Manual',1,1,$2,5,$3,$4,$5) returning id", [competition, manual ? 'manual' : 'sorteo', per, phase, fixed]));
  const layout = f => v('select grupos from public.armados_clasificatorias where fecha_id=$1', [f]);
  const version = f => v('select version from public.armados_clasificatorias where fecha_id=$1', [f]);
  const save = (f, groups, expected) => asAdmin(() => rpc('guardar_armado_clasificatorias', [f, expected, groups]));
  const add = async (f, round, position, alias) => asAdmin(async () => rpc('inscribir_en_ronda', [f, await version(f), round, position, '', [alias]]));
  const prepare = async (per = 2, phase = 'octavos', count = 10, fixed = false) => {
    const f = await date(per, phase, true, fixed);
    const rounds = Array.from({ length: Math.ceil(count / 5) }, () => ({ id: randomUUID(), posiciones: Array(5).fill(null) }));
    await save(f, [{ nombre: 'A', tandas: rounds }], 0);
    for (let i = 0; i < count; i++) await add(f, rounds[Math.floor(i / 5)].id, i % 5 + 1, 'MC ' + i);
    await asAdmin(async () => {
      await rpc('guardar_planilla_fecha', [f, 'clasificatorias', ['Puntos'], 0]);
      await rpc('configurar_jurado_fecha', [f, judge, 'clasi_a', true]);
      await rpc('iniciar_clasificatorias', [f]);
    });
    const batches = await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id join public.clasificatorias c on c.id=g.clasificatoria_id where c.fecha_id=$1 order by t.numero', [f]);
    let index = 0;
    for (const t of batches) {
      // Puntajes distintos y empates; el orden de inscripción no coincide con el ranking.
      const points = t.entradas.map(e => ({ inscripcion_id: e.id, casillas: [Math.floor(index++ / 2)] }));
      await como(db, judge, () => rpc('guardar_votacion_clasificatoria', [t.id, points, 0, true]));
    }
    const clasi = await v('select id from public.clasificatorias where fecha_id=$1', [f]);
    const ranking = await asAdmin(() => rpc('consultar_ranking_clasificatoria', [clasi]));
    return { f, clasi, ranking, batches };
  };
  return { db, q, v, rpc, admin, judge, outsider, competition, asAdmin, date, layout, version, save, add, prepare };
}

test('alta en cualquier lugar, rondas incompletas, retiro y reincorporación atómicos y versionados', async () => {
  const s = await fixture(); const { db, q, v, rpc, asAdmin, date, layout, version, save, add, outsider } = s;
  try {
    const f = await date(); const round = randomUUID(), empty = randomUUID();
    await save(f, [{ nombre: 'A', tandas: [{ id: empty, posiciones: Array(5).fill(null) }, { id: round, posiciones: Array(5).fill(null) }] }], 0);
    await assert.rejects(asAdmin(() => rpc('crear_inscripcion', [f, '', ['Fuera']])), /desde un lugar/);
    await add(f, round, 5, 'Último');
    const stale = await version(f);
    await add(f, round, 1, 'Primero');
    await assert.rejects(asAdmin(() => rpc('inscribir_en_ronda', [f, stale, round, 2, '', ['No crear']])), /otro dispositivo/);
    await assert.rejects(add(f, round, 5, 'Ocupado'), /ocupado/);
    await assert.rejects(add(f, round, 2, 'Primero'), /ya está/);
    assert.equal(await v('select count(*)::int from public.inscripciones where fecha_id=$1', [f]), 2);
    assert.equal(await v("select count(*)::int from public.inscripciones_historial h join public.inscripciones i on i.id=h.inscripcion_id where i.fecha_id=$1 and h.accion='creacion'", [f]), 2);
    const groups = await layout(f);
    const currentVersion = await version(f);
    await assert.rejects(como(db, outsider, () => rpc('guardar_armado_clasificatorias', [f, currentVersion, groups])), /permiso|acceso|organiza/);
    await assert.rejects(asAdmin(() => q('update public.armados_clasificatorias set version=99 where fecha_id=$1', [f])), /permission denied/);
    const first = groups[0].tandas[1].posiciones[0];
    const last = groups[0].tandas[1].posiciones[4];
    groups[0].tandas[1].posiciones[2] = first;
    await assert.rejects(save(f, groups, await version(f)), /dos lugares/);
    groups[0].tandas[1].posiciones[2] = null;
    [groups[0].tandas[1].posiciones[0], groups[0].tandas[1].posiciones[4]] = [last, first];
    await save(f, groups, await version(f));
    await asAdmin(() => rpc('modificar_inscripcion', [first, 1, 'retirar']));
    assert.equal((await layout(f))[0].tandas[1].posiciones[4], null);
    await asAdmin(async () => rpc('inscribir_en_ronda', [f, await version(f), round, 3, '', [], first]));
    assert.equal((await layout(f))[0].tandas[1].posiciones[2], first);
    assert.equal(await v('select count(*)::int from public.inscripciones where fecha_id=$1 and activa', [f]), 2);
    // Sin jurados/planilla, iniciar revierte también la preparación del sorteo.
    await assert.rejects(asAdmin(() => rpc('iniciar_clasificatorias', [f])), /planilla/);
    assert.equal(await v('select count(*)::int from public.sorteos where fecha_id=$1', [f]), 0);
    await asAdmin(async () => {
      await rpc('guardar_planilla_fecha', [f, 'clasificatorias', ['Puntos'], 0]);
      await rpc('configurar_jurado_fecha', [f, s.judge, 'clasi_a', true]);
      await rpc('iniciar_clasificatorias', [f]);
      await rpc('iniciar_clasificatorias', [f]);
    });
    const batches = await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id join public.clasificatorias c on c.id=g.clasificatoria_id where c.fecha_id=$1', [f]);
    assert.equal(batches.length, 1); assert.equal(batches[0].numero, 2);
    assert.deepEqual(batches[0].entradas.map(e => e.nombre), ['Último', 'Primero']);
    await assert.rejects(save(f, groups, await version(f)), /no admite/);
    await assert.rejects(add(f, round, 2, 'Tarde'), /no admite/);
  } finally { await db.close(); }
});

test('cruces consecutivos por puntaje en duelos, triangulares y cuadrangulares; confirma exactamente la vista previa', async () => {
  const { db, prepare, asAdmin, rpc, q } = await fixture();
  try {
    for (const [per, phase] of [[2, 'octavos'], [3, 'octavos'], [4, 'dieciseisavos']]) {
      const { f, clasi, ranking } = await prepare(per, phase);
      const ids = ranking.filas.map(row => row.inscripcion_id);
      const crosses = Array.from({ length: phase === 'octavos' ? 8 : 16 }, (_, i) => ({ numero: i + 1, inscripciones: ids.slice(i * per, (i + 1) * per) }));
      const reversed = structuredClone(crosses); reversed[0].inscripciones.reverse();
      await assert.rejects(asAdmin(() => rpc('cerrar_clasificatorias_con_armado', [clasi, ranking.version, [], null, 'puntaje', reversed])), /no coincide/);
      await asAdmin(() => rpc('cerrar_clasificatorias_con_armado', [clasi, ranking.version, [], null, 'puntaje', crosses]));
      await asAdmin(() => rpc('cerrar_clasificatorias_con_armado', [clasi, ranking.version, [], null, 'puntaje', crosses]));
      const stored = await q('select numero,entradas from public.cruces_eliminatorias where fecha_id=$1 and fase=$2 order by numero', [f, phase]);
      assert.deepEqual(stored.map(c => ({ numero: c.numero, inscripciones: c.entradas.map(e => e.id) })), crosses);
      assert.ok(stored.some(c => c.entradas.length === 0));
    }
  } finally { await db.close(); }
});

test('armado manual solo admite clasificados una vez y conserva ganadores, llave fija y permisos', async () => {
  const { db, prepare, asAdmin, rpc, q, v, outsider } = await fixture();
  try {
    const { f, clasi, ranking } = await prepare(3, 'octavos', 10, true);
    const ids = ranking.filas.map(row => row.inscripcion_id).reverse();
    const crosses = Array.from({ length: 8 }, (_, i) => ({ numero: i + 1, inscripciones: ids.slice(i * 3, i * 3 + 3) }));
    const duplicated = structuredClone(crosses); duplicated[1].inscripciones[0] = ids[0];
    await assert.rejects(asAdmin(() => rpc('cerrar_clasificatorias_con_armado', [clasi, ranking.version, [], null, 'manual', duplicated])), /cada clasificado/);
    const missing = structuredClone(crosses); missing[0].inscripciones.pop();
    await assert.rejects(asAdmin(() => rpc('cerrar_clasificatorias_con_armado', [clasi, ranking.version, [], null, 'manual', missing])), /cada clasificado/);
    const foreign = structuredClone(crosses); foreign[0].inscripciones[0] = randomUUID();
    await assert.rejects(asAdmin(() => rpc('cerrar_clasificatorias_con_armado', [clasi, ranking.version, [], null, 'manual', foreign])), /cada clasificado/);
    await assert.rejects(como(db, outsider, () => rpc('cerrar_clasificatorias_con_armado', [clasi, ranking.version, [], null, 'manual', crosses])), /permiso|acceso|organiza/);
    assert.equal(await v('select count(*)::int from public.cruces_eliminatorias where fecha_id=$1', [f]), 0);
    await asAdmin(() => rpc('cerrar_clasificatorias_con_armado', [clasi, ranking.version, [], null, 'manual', crosses]));
    const stored = await q("select * from public.cruces_eliminatorias where fecha_id=$1 and fase='octavos' order by numero", [f]);
    assert.deepEqual(stored.map(c => c.entradas.map(e => e.id)), crosses.map(c => c.inscripciones));
    await asAdmin(() => rpc('confirmar_ganador_cruce', [stored[0].id, stored[0].entradas[1].id, stored[0].version]));
    assert.equal(await v('select ganador_id from public.cruces_eliminatorias where id=$1', [stored[0].id]), stored[0].entradas[1].id);
    const next = await q("select entradas from public.cruces_eliminatorias where fecha_id=$1 and fase='cuartos' order by numero", [f]);
    assert.ok(next[0].entradas.some(e => e.id === stored[0].entradas[1].id));
    await assert.rejects(asAdmin(() => rpc('cerrar_clasificatorias_con_armado', [clasi, ranking.version, [], null, 'sorteo', crosses])), /ya fueron cerradas/);
    for (const signature of ['private.crear_inscripcion_sin_armado(uuid,text,text[])', 'private.modificar_inscripcion_sin_armado(uuid,integer,text,text,text[])', 'private.generar_sorteo_automatico(uuid)', 'private.iniciar_clasificatorias_preparadas(uuid)'])
      assert.equal(await v("select has_function_privilege('authenticated',$1,'execute')", [signature]), false);
  } finally { await db.close(); }
});

test('vista previa del cliente respeta formatos, puntajes consecutivos y reparto vigente por sorteo', () => {
  for (const count of [8, 16]) for (const per of [2, 3, 4]) for (const total of [2, count - 1, count * per]) {
    const ids = Array.from({ length: total }, (_, i) => 'id-' + i);
    const byScore = confirmableCrosses(buildInitialCrosses(ids, 'puntaje', per, count));
    assert.deepEqual(byScore.map(c => c.inscripciones), Array.from({ length: count }, (_, i) => ids.slice(i * per, (i + 1) * per)));
    const drawn = confirmableCrosses(buildInitialCrosses(ids, 'sorteo', per, count));
    assert.deepEqual(drawn.flatMap(c => c.inscripciones).sort(), [...ids].sort());
    assert.ok(drawn.every(c => c.inscripciones.length <= per));
    assert.ok(Math.max(...drawn.map(c => c.inscripciones.length)) - Math.min(...drawn.map(c => c.inscripciones.length)) <= 1);
    assert.ok(buildInitialCrosses(ids, 'manual', per, count).every(c => c.inscripciones.every(id => id === null)));
  }
});

test('configurar/copia preserva el modo; impide cambios que dejarían inscripciones sin ronda', async () => {
  const { db, rpc, asAdmin, date, save, add, v } = await fixture();
  try {
    const f = await date();
    const cfg = { fase_inicial: 'octavos', por_cruce: 2, clasis_modo: 'automaticas', grupos_clasi: null, maximo_tanda: 6, llave_fija: false, armado_clasis: 'manual' };
    await asAdmin(() => rpc('configurar_fecha', [f, cfg, 1, false]));
    const round = randomUUID();
    await save(f, [{ nombre: 'A', tandas: [{ id: round, posiciones: Array(6).fill(null) }] }], 0);
    await add(f, round, 6, 'Equipo');
    await assert.rejects(asAdmin(() => rpc('configurar_fecha', [f, { ...cfg, armado_clasis: 'sorteo' }, 2, false])), /antes de inscribir/);
    await assert.rejects(asAdmin(() => rpc('configurar_fecha', [f, { ...cfg, maximo_tanda: 5 }, 2, false])), /máximo por ronda/);
    const request = randomUUID();
    const copied = await asAdmin(() => rpc('copiar_configuracion_fecha', [f, 'Copia manual', request]));
    assert.equal(await asAdmin(() => rpc('copiar_configuracion_fecha', [f, 'Copia manual', request])), copied);
    assert.equal(await v('select armado_clasis from public.fechas where id=$1', [copied]), 'manual');
    assert.equal(await v('select maximo_tanda from public.fechas where id=$1', [copied]), 6);
    assert.equal(await v('select count(*)::int from public.armados_clasificatorias where fecha_id=$1', [copied]), 0);
    assert.equal(await v('select count(*)::int from public.inscripciones where fecha_id=$1', [copied]), 0);
  } finally { await db.close(); }
});

test('actualizar 031 a 032 conserva votos, orden y cuadro histórico; el cierre anterior sigue siendo idempotente', async () => {
  const { db, q, v, rpc, asAdmin, competition, judge } = await fixture(31);
  try {
    const f = await asAdmin(() => v("insert into public.fechas(competencia_id,nombre,integrantes_por_equipo,jurados_por_grupo_clasi) values($1,'Histórica',1,1) returning id", [competition]));
    const clasi = await asAdmin(async () => {
      for (let i = 0; i < 17; i++) await rpc('crear_inscripcion', [f, '', ['Histórico ' + i]]);
      await rpc('guardar_planilla_fecha', [f, 'clasificatorias', ['Puntos'], 0]);
      await rpc('configurar_jurado_fecha', [f, judge, 'clasi_a', true]);
      await rpc('generar_sorteo', [f]);
      return rpc('iniciar_clasificatorias', [f]);
    });
    const batches = await q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id where g.clasificatoria_id=$1 order by numero', [clasi]);
    let index = 0;
    for (const t of batches) await como(db, judge, () => rpc('guardar_votacion_clasificatoria', [t.id, t.entradas.map(e => ({ inscripcion_id: e.id, casillas: [index++ / 4] })), 0, true]));
    const ranking = await asAdmin(() => rpc('consultar_ranking_clasificatoria', [clasi]));
    const closed = await asAdmin(() => rpc('cerrar_clasificatorias_y_sortear_octavos', [clasi, ranking.version, [], null]));
    const before = await q('select * from public.cruces_eliminatorias where fecha_id=$1 order by fase, numero', [f]);
    const votes = await q('select * from public.votaciones_clasificatorias order by id');
    await db.exec(readFileSync('supabase/migrations/032_armados_manuales.sql', 'utf8'));
    assert.deepEqual(await q('select * from public.cruces_eliminatorias where fecha_id=$1 order by fase, numero', [f]), before);
    assert.deepEqual(await q('select * from public.votaciones_clasificatorias order by id'), votes);
    assert.equal(await v('select armado_clasis from public.fechas where id=$1', [f]), 'sorteo');
    assert.equal(await asAdmin(() => rpc('cerrar_clasificatorias_y_sortear_octavos', [clasi, ranking.version, [], null])), closed);
  } finally { await db.close(); }
});
