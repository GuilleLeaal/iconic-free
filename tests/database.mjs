import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
export async function prepararBase(db,hasta=999) {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for(const file of readdirSync('supabase/migrations').filter(f => /^\d+.*\.sql$/.test(f) && Number(f.slice(0,3))<=hasta).sort()) {
    try { await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8')); }
    catch(e) { console.error('Falló migración',file,e.message); throw e; }
  }
  return db;
}
export async function nuevaBase(hasta = 999) {
  return prepararBase(new PGlite(),hasta);
}
export async function como(db,id,fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
if(process.argv[1]?.endsWith('database.mjs')) {
  const db=await nuevaBase();
  assert.ok(db);
  console.log('PASS reconstrucción de todas las migraciones en PostgreSQL / PGlite');
  await db.close();
}
