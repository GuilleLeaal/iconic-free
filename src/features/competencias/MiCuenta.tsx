import { useState } from 'react';
import { Save } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export default function MiCuenta({ nombreUsuario, correo, onGuardar, onCancelar }: { nombreUsuario: string | null; correo: string; onGuardar: () => void; onCancelar: () => void }) {
  const [nombre, setNombre] = useState(nombreUsuario ?? '');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  return <section className="panel mi-cuenta"><h1>Mi cuenta</h1><p className="texto-secundario">El nombre de usuario se muestra en las competencias y las listas de jurados.</p>
    <form onSubmit={async e => {
      e.preventDefault(); if (ocupado) return;
      setOcupado(true); setError('');
      const { error } = await supabase.rpc('actualizar_nombre_usuario', { p_nombre_usuario: nombre.trim().toLowerCase() });
      setOcupado(false);
      if (error) setError(error.code === 'P0001' ? error.message : 'No se pudo guardar el nombre de usuario. Intentá nuevamente.');
      else onGuardar();
    }}>
      <label className="campo">Nombre de usuario<input aria-label="Nombre de usuario" name="username" autoComplete="username" value={nombre} onChange={e => setNombre(e.target.value)} required minLength={3} maxLength={30} pattern="[a-zA-Z0-9][a-zA-Z0-9_.]{2,29}" disabled={ocupado} /><span className="ayuda-campo">Entre 3 y 30 caracteres: letras sin tildes, números, punto o guion bajo. Se guarda en minúsculas.</span></label>
      <div className="campo"><span>Correo para iniciar sesión</span><p className="texto-secundario">{correo}</p></div>
      {error && <p className="mensaje-error" role="alert">{error}</p>}
      <div className="acciones-formulario"><button className="boton boton-secundario" type="button" onClick={onCancelar} disabled={ocupado}>Volver</button><button className="boton boton-principal" disabled={ocupado}><Save size={17} />{ocupado ? 'Guardando…' : 'Guardar nombre de usuario'}</button></div>
    </form>
  </section>;
}
