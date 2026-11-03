// Generación reproducible de reemplazos explícitos, sin editar 001–015.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = 'supabase/migrations';
const funciones = new Map();
for (const file of readdirSync(dir).filter(f => /^0(0\d|1[0-5])_/.test(f)).sort()) {
  const sql = readFileSync(`${dir}/${file}`, 'utf8').replace(/\r/g, '');
  for (const m of sql.matchAll(/create (?:or replace )?function (public|private)\.(\w+)\([\s\S]*?\$\$;/gi)) {
    funciones.set(`${m[1]}.${m[2]}`, m[0].replace(/^create function/, 'create or replace function'));
  }
}
const recursos = {
  crear_inscripcion: 'p_fecha_id', modificar_inscripcion: "private.fecha_recurso('inscripcion',p_id)",
  generar_sorteo: 'p_fecha_id', deshacer_sorteo: "private.fecha_recurso('sorteo',p_id)",
  configurar_jurado_fecha: 'p_fecha_id', guardar_planilla_fecha: 'p_fecha_id',
  iniciar_eliminatorias: 'p_fecha_id', confirmar_ganador_cruce: "private.fecha_recurso('cruce',p_cruce_id)",
  sortear_fase_eliminatoria: 'p_fecha_id', deshacer_resultado_cruce: "private.fecha_recurso('cruce',p_cruce_id)",
  iniciar_clasificatorias: 'p_fecha_id', consultar_ranking_clasificatoria: "private.fecha_recurso('clasi',p_clasificatoria_id)",
  cerrar_clasificatorias_y_sortear_octavos: "private.fecha_recurso('clasi',p_clasificatoria_id)",
};
let out = 'begin;\n-- Generado por scripts/generar-rpc-correctivas.mjs. Reemplazos auditables.\n';
out += funciones.get('public.crear_inscripcion').includes('private.crear_inscripcion')
  ? '\n' + readFileSync(`${dir}/002_inscripciones.sql`, 'utf8').replace(/\r/g,'').match(/create function public\.crear_inscripcion\([\s\S]*?\$\$;/)[0]
    .replace('create function public.', 'create or replace function private.')
    .replaceAll('private.es_organizacion()', 'private.exigir_organizacion_fecha(p_fecha_id)') + '\n'
  : '';
for (const [name, recurso] of Object.entries(recursos)) {
  let sql = funciones.get(`public.${name}`);
  if (!sql) throw Error(name);
  sql = sql.replaceAll('private.es_organizacion()', `private.exigir_organizacion_fecha(${recurso})`);
  if (name === 'configurar_jurado_fecha') {
    sql = sql.replace("and rol = 'jurado'", "and exists(select 1 from public.vinculos_competencia v where v.usuario_id=p_jurado_id and v.competencia_id=v_fecha.competencia_id and v.rol='jurado' and v.estado='activo')");
  }
  if (name === 'iniciar_clasificatorias') {
    sql = sql.replace("and perfil.rol = 'jurado'", "and exists(select 1 from public.vinculos_competencia v where v.usuario_id=perfil.id and v.competencia_id=v_fecha.competencia_id and v.rol='jurado' and v.estado='activo')");
    sql = sql.replace(/  if v_total <= \(v_sorteo.plan ->> 'clasifican'\)::integer then[\s\S]*?  end if;/, '');
  }
  out += `\n${sql}\n`;
}
for (const name of ['guardar_votacion_clasificatoria','agregar_participante_clasi','consultar_tandas_jurado']) {
  let sql = funciones.get(`public.${name}`);
  // Ya no existe un rol personal excluyente. Se exige asignación + vínculo actual.
  sql = sql.replace(/  if not exists \(\s*select 1\s*from public.perfiles[\s\S]*?  end if;\n/, '');
  sql = sql.replace(/not exists \(\s*select 1\s*from public.perfiles\s*where id = auth.uid\(\)\s*and rol = 'jurado'\s*\)/g, 'false');
  sql = sql.replaceAll('auth.uid() is null or false', 'auth.uid() is null');
  sql = sql.replace(/auth.uid\(\) is null or not exists \(\s*select 1 from public.perfiles[^)]*?\)\s*(?:or not exists \([\s\S]*?\))?\s*then/g,
    `auth.uid() is null or not private.jurado_grupo(p_grupo_id) then`);
  sql = sql.replace(/  begin\n/, '  begin\n');
  const guard = name === 'guardar_votacion_clasificatoria'
    ? `\n  perform id from public.fechas where id=private.fecha_recurso('tanda',p_tanda_id) for update;\n  if not exists(select 1 from public.tandas_clasificatorias t where t.id=p_tanda_id and private.jurado_grupo(t.grupo_id)) then raise exception 'No tenés esta tanda asignada o tu acceso fue revocado.'; end if;\n`
    : `\n  perform id from public.fechas where id=private.fecha_recurso('grupo',p_grupo_id) for update;\n  if not private.jurado_grupo(p_grupo_id) then raise exception 'No tenés este grupo asignado o tu acceso fue revocado.'; end if;\n`;
  sql = sql.replace(/\nbegin\n/, `\nbegin\n${guard}`);
  if (name === 'guardar_votacion_clasificatoria') {
    sql = sql.replace(/      if jsonb_typeof\(v_punto\) = 'null' then\n        if p_finalizar then[\s\S]*?        end if;\n      else/, "      if jsonb_typeof(v_punto) <> 'null' then");
  }
  if (name === 'agregar_participante_clasi') sql = sql.replace('>= 5', '>= coalesce(v_fecha.maximo_tanda,5)').replace('La tanda ya tiene cinco inscripciones.', 'La tanda alcanzó el máximo configurado.');
  out += `\n${sql}\n`;
}
out += `\n-- Interfaz vieja: operación de ausencia retirada también del servidor.\nrevoke all on function public.retirar_participante_clasi(uuid,uuid,integer) from public,anon,authenticated;\ncommit;\n`;
writeFileSync(`${dir}/017_rpc_con_contexto.sql`, out);
