import { readFileSync,readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const archivos=readdirSync('dist/assets').filter(f=>f.endsWith('.js'));
assert.ok(archivos.length>0,'Generar el build antes de revisar el bundle.');
for(const f of archivos) {
 const s=readFileSync(`dist/assets/${f}`,'utf8');
 assert.equal(/SUPABASE_SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9_-]{15,}/.test(s),false,`Referencia privilegiada en ${f}`);
 for(const token of s.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
   const payload=JSON.parse(Buffer.from(token[0].split('.')[1],'base64url').toString());
   assert.notEqual(payload.role,'service_role',`JWT privilegiado en ${f}`);
 }
}
console.log('PASS bundle sin secretos ni JWT service_role');
