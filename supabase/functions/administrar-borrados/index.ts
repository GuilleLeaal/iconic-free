import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { borrarCuenta } from './workflow.ts';

const appUrl = Deno.env.get('APP_URL')!;
const cors = { 'Access-Control-Allow-Origin': appUrl, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Iniciá sesión nuevamente.' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return json(401, { error: 'La sesión venció. Volvé a ingresar.' });
  try {
    const body = await req.json();
    if (typeof body.usuario_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.usuario_id) || typeof body.confirmacion !== 'string') return json(400, { error: 'Cuenta o confirmación inválida.' });
    const resultado = await borrarCuenta({
      validar: async () => {
        const { data, error } = await admin.rpc('validar_borrado_usuario', { p_actor: user.id, p_usuario: body.usuario_id, p_confirmacion: body.confirmacion });
        if (error) throw new Error(error.message);
        if (typeof data?.existe !== 'boolean') throw new Error('No se pudo comprobar la cuenta.');
        return data;
      },
      borrarAuth: async () => {
        const { error } = await admin.auth.admin.deleteUser(body.usuario_id, false);
        if (error) throw new Error('No se pudo confirmar el borrado de la cuenta. Actualizá el directorio y reintentá.');
      },
    });
    return json(200, resultado);
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : 'No se pudo confirmar el borrado.' });
  }
});
