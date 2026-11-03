import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { enviarInvitacion } from './workflow.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Único redirect permitido, administrado en servidor, jamás tomado del body.
const appUrl = Deno.env.get('APP_URL')!;
const cors = { 'Access-Control-Allow-Origin': appUrl, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Iniciá sesión nuevamente.' });
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return json(401, { error: 'La sesión venció. Volvé a ingresar.' });
  try {
    const body = await req.json();
    if (typeof body.invitacion_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.invitacion_id)) return json(400, { error: 'Invitación inválida.' });
    const { invitacion_id: id } = body;
    const resultado = await enviarInvitacion({
      reservar: async () => {
        const { data, error } = await admin.rpc('reservar_envio_invitacion', { p_id: id, p_actor: user.id, p_reenviar: body.reenviar === true });
        if (error) throw new Error(error.message);
        return data;
      },
      invitar: async (email) => {
        const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: appUrl });
        if (error) throw new Error('No se pudo enviar el correo. Reintentá; si la cuenta ya existe se reutilizará.');
      },
      recuperar: async (email) => {
        const publico = createClient(url, anon, { auth: { persistSession: false } });
        const { error } = await publico.auth.resetPasswordForEmail(email, { redirectTo: appUrl });
        if (error) throw new Error('No se pudo enviar el enlace de acceso. Podés ingresar con tu cuenta y aceptar la invitación pendiente.');
      },
      registrar: async (lease, exito) => {
        const { error } = await admin.rpc('registrar_envio_invitacion', { p_id: id, p_lease: lease, p_exito: exito });
        if (error) throw new Error('No pudimos confirmar el envío. Esperá 90 segundos y reintentá.');
      },
    });
    return json(200, resultado);
  } catch (e) {
    return json(400, { error: e instanceof Error ? e.message : 'No pudimos enviar la invitación. El vínculo queda pendiente; podés reintentar.' });
  }
});
