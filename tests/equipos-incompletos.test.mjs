import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nuevaBase, como } from './database.mjs';

async function fixture() {
  const db = await nuevaBase(32);
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const v = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const rpc = (name, args = []) => v(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})`, args);
  const admin = randomUUID(), judge = randomUUID(), otherJudge = randomUUID();
  for (const [id, email] of [[admin, 'admin@teams.test'], [judge, 'judge@teams.test'], [otherJudge, 'other@teams.test']])
    await q('insert into auth.users(id,email) values($1,$2)', [id, email]);
  const competition = await v("select private.instalar_iconic($1,'admin@teams.test')", [admin]);
  for (const id of [judge, otherJudge]) await q("insert into public.vinculos_competencia(competencia_id,usuario_id,rol,estado) values($1,$2,'jurado','activo')", [competition, id]);
  const asAdmin = fn => como(db, admin, fn);
  const date = (max, manual = false, judges = 1) => asAdmin(() => v("insert into public.fechas(competencia_id,nombre,integrantes_por_equipo,jurados_por_grupo_clasi,maximo_tanda,armado_clasis) values($1,'Equipos',$2,$3,6,$4) returning id", [competition, max, judges, manual ? 'manual' : 'sorteo']));
  const migrate = () => db.exec(readFileSync('supabase/migrations/033_equipos_incompletos.sql', 'utf8'));
  const members = id => q('select id,alias,orden from public.inscripcion_integrantes where inscripcion_id=$1 order by orden', [id]);
  const batches = f => q('select t.* from public.tandas_clasificatorias t join public.grupos_clasificatorias g on g.id=t.grupo_id join public.clasificatorias c on c.id=g.clasificatoria_id where c.fecha_id=$1 order by t.numero', [f]);
  return { db, q, v, rpc, admin, judge, otherJudge, asAdmin, date, migrate, members, batches };
}

test('actualizar 032 conserva inscripciones; altas y ediciones admiten de 1 al máximo y mantienen versiones, alias e historial', async () => {
  const { db, q, v, rpc, judge, asAdmin, date, migrate, members } = await fixture();
  try {
    const oldDate = await date(2);
    const oldId = await asAdmin(() => rpc('crear_inscripcion', [oldDate, 'Histórico', ['Antes A', 'Antes B']]));
    const before = await q('select * from public.inscripciones where id=$1', [oldId]);
    const beforeMembers = await members(oldId);
    await migrate();
    assert.deepEqual(await q('select * from public.inscripciones where id=$1', [oldId]), before);
    assert.deepEqual(await members(oldId), beforeMembers);
    for (const max of [1, 2, 3, 4, 5, 7]) {
      const f = await date(max);
      for (let count = 1; count <= max; count++) {
        const aliases = Array.from({ length: count }, (_, i) => `MC ${count}-${i}`);
        const id = await asAdmin(() => rpc('crear_inscripcion', [f, '', aliases]));
        assert.equal((await members(id)).length, count);
        assert.equal(await v('select nombre from public.inscripciones where id=$1', [id]), aliases.join(' / '));
      }
      for (const invalid of [null, [], Array(max + 1).fill('Exceso')])
        await assert.rejects(asAdmin(() => rpc('crear_inscripcion', [f, '', invalid])), /entre 1 y/);
      for (const invalid of [[''], ['  '], [null]])
        await assert.rejects(asAdmin(() => rpc('crear_inscripcion', [f, '', invalid])), /alias/);
      await assert.rejects(asAdmin(() => rpc('crear_inscripcion', [f, '', ['MC 1-0']])), /ya está anotado/);
      if (max > 1) await assert.rejects(asAdmin(() => rpc('crear_inscripcion', [f, '', ['Mismo', ' mismo ']])), /repetir/);
      await assert.rejects(como(db, judge, () => rpc('crear_inscripcion', [f, '', ['Sin permiso']])), /permiso|organiza/);
    }
    const f = await date(5);
    const id = await asAdmin(() => rpc('crear_inscripcion', [f, '', ['Luna']]));
    const original = (await members(id))[0];
    await asAdmin(() => rpc('modificar_inscripcion', [id, 1, 'editar', '', ['Luna', 'Norte', 'Sur']]));
    assert.equal((await members(id))[0].id, original.id);
    assert.deepEqual((await members(id)).map(m => m.alias), ['Luna', 'Norte', 'Sur']);
    await assert.rejects(asAdmin(() => rpc('modificar_inscripcion', [id, 1, 'editar', '', ['Viejo']])), /cambió/);
    await assert.rejects(asAdmin(() => rpc('modificar_inscripcion', [id, 2, 'editar', '', []])), /entre 1 y/);
    await asAdmin(() => rpc('modificar_inscripcion', [id, 2, 'editar', 'Equipo', ['Luna']]));
    assert.deepEqual(await members(id), [original]);
    const history = await v("select despues from public.inscripciones_historial where inscripcion_id=$1 and accion='editar' order by (despues->>'version')::int desc limit 1", [id]);
    assert.equal(history.integrantes.length, 1);
    await asAdmin(() => rpc('modificar_inscripcion', [id, 3, 'retirar']));
    await asAdmin(() => rpc('modificar_inscripcion', [id, 4, 'reactivar']));
    assert.deepEqual(await members(id), [original]);
  } finally { await db.close(); }
});

test('rondas manuales y votos: un equipo de 1 y otro de 5 ocupan una entrada y reciben el mismo total de dos jurados', async () => {
  const { db, v, rpc, judge, otherJudge, asAdmin, date, migrate, batches } = await fixture();
  try {
    await migrate();
    const f = await date(5, true, 2), round = randomUUID();
    await asAdmin(() => rpc('guardar_armado_clasificatorias', [f, 0, [{ nombre: 'A', tandas: [{ id: round, posiciones: Array(6).fill(null) }] }]]));
    await asAdmin(() => rpc('inscribir_en_ronda', [f, 1, round, 1, 'Solo', ['Luna']]));
    await asAdmin(() => rpc('inscribir_en_ronda', [f, 2, round, 2, 'Completo', ['A', 'B', 'C', 'D', 'E']]));
    await asAdmin(async () => {
      await rpc('guardar_planilla_fecha', [f, 'clasificatorias', ['Entrada 1', 'Entrada 2'], 0]);
      for (const j of [judge, otherJudge]) await rpc('configurar_jurado_fecha', [f, j, 'clasi_a', true]);
      await rpc('iniciar_clasificatorias', [f]);
    });
    const [t] = await batches(f);
    assert.equal(t.entradas.length, 2);
    assert.deepEqual(t.entradas.map(e => e.integrantes.length), [1, 5]);
    const points = t.entradas.map(e => ({ inscripcion_id: e.id, casillas: [3, 1] }));
    // Una fila por integrante y filas repetidas deben rechazarse.
    const individualRows = t.entradas.flatMap(e => e.integrantes.map(() => ({ inscripcion_id: e.id, casillas: [3, 1] })));
    await assert.rejects(como(db, judge, () => rpc('guardar_votacion_clasificatoria', [t.id, individualRows, 0, true])), /incluir a todos/);
    await assert.rejects(como(db, judge, () => rpc('guardar_votacion_clasificatoria', [t.id, [points[0], points[0]], 0, true])), /repetid/);
    for (const j of [judge, otherJudge]) await como(db, j, () => rpc('guardar_votacion_clasificatoria', [t.id, points, 0, true]));
    const clasi = await v('select id from public.clasificatorias where fecha_id=$1', [f]);
    const ranking = await asAdmin(() => rpc('consultar_ranking_clasificatoria', [clasi]));
    assert.equal(ranking.total, 2);
    assert.equal(ranking.filas.length, 2);
    assert.ok(ranking.filas.every(row => row.puntos === 8 && row.detalle_jurados.length === 2));
    assert.equal(ranking.lista_para_cerrar, true);
  } finally { await db.close(); }
});

test('alta tardía incompleta conserva notas, suma una única fila y recupera reintentos', async () => {
  const { db, v, rpc, judge, asAdmin, date, migrate, batches } = await fixture();
  try {
    await migrate();
    const f = await date(4);
    await asAdmin(async () => {
      for (let i = 0; i < 17; i++) await rpc('crear_inscripcion', [f, '', ['MC ' + i]]);
      await rpc('guardar_planilla_fecha', [f, 'clasificatorias', ['Entrada 1', 'Entrada 2'], 0]);
      await rpc('configurar_jurado_fecha', [f, judge, 'clasi_a', true]);
      await rpc('generar_sorteo', [f]); await rpc('iniciar_clasificatorias', [f]);
    });
    const t = (await batches(f)).find(t => t.entradas.length < 6);
    const points = t.entradas.map(e => ({ inscripcion_id: e.id, casillas: [0, 2] }));
    await como(db, judge, () => rpc('guardar_votacion_clasificatoria', [t.id, points, 0, false]));
    const request = [t.grupo_id, t.id, '', [' Tardío '], randomUUID()];
    const result = await como(db, judge, () => rpc('agregar_participante_clasi', request));
    assert.deepEqual(await como(db, judge, () => rpc('agregar_participante_clasi', request)), result);
    const saved = await v('select puntuaciones from public.votaciones_clasificatorias where tanda_id=$1', [t.id]);
    assert.deepEqual(saved, [...points, { inscripcion_id: result.inscripcion_id, casillas: [null, null] }]);
    assert.equal(await v('select count(*)::int from public.inscripciones where fecha_id=$1', [f]), 18);
    for (const invalid of [[], Array(5).fill('Exceso')]) await assert.rejects(como(db, judge, () => rpc('agregar_participante_clasi', [t.grupo_id, null, '', invalid, randomUUID()])), /entre 1 y/);
  } finally { await db.close(); }
});
