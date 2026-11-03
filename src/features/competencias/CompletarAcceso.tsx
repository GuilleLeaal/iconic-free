import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function CompletarAcceso({ nombreUsuario, onListo }: { nombreUsuario: string | null; onListo: () => void }) {
  const [nombre, setNombre] = useState(nombreUsuario ?? '');
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  return <section className="panel mi-cuenta"><h1>Preparar tu acceso personal</h1><p>Elegí un nombre de usuario y una contraseña para continuar.</p>
    <form onSubmit={async e => {
      e.preventDefault(); if (ocupado) return;
      if (password !== repetida) { setError('Las contraseñas no coinciden.'); return; }
      setOcupado(true); setError('');
      const { error: errorNombre } = await supabase.rpc('actualizar_nombre_usuario', { p_nombre_usuario: nombre.trim().toLowerCase() });
      if (errorNombre) { setOcupado(false); setError(errorNombre.message); return; }
      const { error } = await supabase.auth.updateUser({ password });
      setOcupado(false); if (error) setError(error.message); else onListo();
    }}><label className="campo">Nombre de usuario<input aria-label="Nombre de usuario" name="username" autoComplete="username" required minLength={3} maxLength={30} pattern="[a-zA-Z0-9][a-zA-Z0-9_.]{2,29}" value={nombre} onChange={e => setNombre(e.target.value)} /><span className="ayuda-campo">Entre 3 y 30 caracteres: letras sin tildes, números, punto o guion bajo. Se guarda en minúsculas.</span></label>
      <label className="campo">Nueva contraseña<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="campo">Repetir contraseña<input type="password" autoComplete="new-password" required value={repetida} onChange={e => setRepetida(e.target.value)} /></label>
      <button className="boton boton-principal" disabled={ocupado}>Guardar y continuar</button>
    </form>{error && <p className="mensaje-error" role="alert">{error}</p>}
  </section>;
}
