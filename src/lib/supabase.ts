import { createClient } from '@supabase/supabase-js';

const parametrosAcceso = new URLSearchParams(window.location.hash.slice(1));
export const enlaceAcceso = ['invite', 'recovery'].includes(parametrosAcceso.get('type') ?? '');
export const enlaceVencido = parametrosAcceso.has('error') || new URLSearchParams(window.location.search).has('error');

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Falta configurar VITE_SUPABASE_URL o ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY en .env.local.',
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
