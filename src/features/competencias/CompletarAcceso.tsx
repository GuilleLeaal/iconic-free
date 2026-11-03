import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function CompletarAcceso({ onListo }: { onListo: () => void }) {
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  return <section className="panel"><h1>Preparar tu acceso personal</h1><p>Elegí tu contraseña para continuar y revisar los vínculos pendientes.</p>
    <form onSubmit={async e => {
      e.preventDefault(); if (ocupado) return;
      if (password !== repetida) { setError('Las contraseñas no coinciden.'); return; }
      setOcupado(true); setError('');
      const { error } = await supabase.auth.updateUser({ password });
      setOcupado(false); if (error) setError(error.message); else onListo();
    }}><label className="campo">Nueva contraseña<input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="campo">Repetir contraseña<input type="password" autoComplete="new-password" required value={repetida} onChange={e => setRepetida(e.target.value)} /></label>
      <button className="boton boton-principal" disabled={ocupado}>Guardar y continuar</button>
    </form>{error && <p className="mensaje-error" role="alert">{error}</p>}
  </section>;
}
