import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, AudioLines, Check, LoaderCircle, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { supabase, enlaceVencido } from "./lib/supabase";
import { useAuth } from "./hooks/useAuth";
import "./App.css";

import Plataforma from "./features/competencias/Plataforma";
import CompletarAcceso from "./features/competencias/CompletarAcceso";
import MiCuenta from "./features/competencias/MiCuenta";


function Marca() {
  return (
    <div className="marca" aria-label="Competencias de freestyle de Uruguay">
      <span className="marca-icono" aria-hidden="true"><AudioLines size={22} strokeWidth={1.7} /></span>
      <span className="marca-textos"><span className="marca-nombre">COMPETENCIAS</span><span className="marca-subtitulo">FREESTYLE · URUGUAY</span></span>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(enlaceVencido ? 'El enlace venció o no es válido. Solicitá uno nuevo o ingresá con tu contraseña.' : '');
  const [aviso, setAviso] = useState('');

  async function iniciarSesion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (enviando) return;

    setError("");
    setEnviando(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(
          authError.code === "invalid_credentials"
            ? "El correo o la contraseña no son correctos."
            : authError.code === "email_not_confirmed"
              ? "Tu correo todavía no está confirmado."
              : "No pudimos iniciar sesión. Revisá tus datos y la conexión.",
        );
      }
    } catch {
      setError("No pudimos conectar. Intentá nuevamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="acceso">
      <section className="presentacion">
        <Marca />

        <div className="presentacion-contenido">
          <span className="etiqueta"><span className="punto-vivo" />GESTIÓN DE COMPETENCIAS</span>
          <h1>Competencias<br /><em>de freestyle.</em></h1>
          <p>Administrá fechas, participantes, jurados y resultados.</p>
          <div className="acceso-beneficios"><span><Check size={16} /> Inscripciones y sorteos</span><span><Check size={16} /> Jurados y clasificatorias</span><span><Check size={16} /> Cruces y resultados</span></div>
        </div>

        <span className="presentacion-pie">
          Freestyle · Uruguay
        </span>
      </section>

      <section className="acceso-formulario">
        <div className="tarjeta-login">
          <div className="icono-acceso">
            <ShieldCheck size={25} aria-hidden="true" />
          </div>

          <span className="micro-etiqueta">ACCESO A LA PLATAFORMA</span>
          <h2>Iniciar sesión</h2>
          <p className="texto-secundario">
            Ingresá con tu correo y contraseña.
          </p>

          <form onSubmit={iniciarSesion}>
            <div className="campo">
              <label htmlFor="email">Correo</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                placeholder="tu@correo.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={enviando}
                required
              />
            </div>

            <div className="campo">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Tu contraseña"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={enviando}
                required
              />
            </div>

            {error && (
              <p className="mensaje-error" role="alert">
                {error}
              </p>
            )}

            <button
              className="boton boton-principal"
              type="submit"
              disabled={enviando}
            >
              {enviando ? (
                <>
                  <LoaderCircle
                    size={18}
                    className="girando"
                    aria-hidden="true"
                  />
                  Ingresando…
                </>
              ) : (
                <>
                  Ingresar
                  <ArrowRight size={18} aria-hidden="true" />
                </>
              )}
            </button>
          </form>
          <button type="button" className="boton boton-texto recuperar-acceso" disabled={enviando} onClick={async () => {
            if (!email.trim()) { setError('Ingresá tu correo para solicitar un enlace nuevo.'); return; }
            setEnviando(true); setError(''); setAviso('');
            const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: window.location.origin });
            setEnviando(false);
            if (error) setError('No pudimos enviar el enlace. Revisá el correo e intentá nuevamente.');
            else setAviso('Si el correo tiene una cuenta habilitada, recibirás un enlace de acceso.');
          }}>Recuperar acceso / solicitar enlace nuevo</button>
          {aviso && <p role="status">{aviso}</p>}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const { session, perfil, errorPerfil, cargando, reintentarPerfil, requierePassword, terminarAcceso } =
    useAuth();

  const [cerrando, setCerrando] = useState(false);
  const [errorSalida, setErrorSalida] = useState("");
  const [miCuenta, setMiCuenta] = useState(false);

  async function cerrarSesion() {
    if (cerrando) return;

    setErrorSalida("");
    setCerrando(true);

    try {
      const { error } = await supabase.auth.signOut({
        scope: "local",
      });

      if (error) throw error;
    } catch {
      setErrorSalida("No pudimos cerrar sesión. Intentá nuevamente.");
    } finally {
      setCerrando(false);
    }
  }

  if (cargando) {
    return (
      <main className="pantalla-carga" role="status">
        <Marca />
        <LoaderCircle size={24} className="girando" aria-hidden="true" />
        <p>Cargando tu cuenta…</p>
      </main>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <div className="aplicacion">
      <header className="cabecera">
        <Marca />
        <span className="cabecera-leyenda">Gestión de competencias</span>
        <div className="acciones-cuenta">
        {perfil && !requierePassword && <button className="boton boton-secundario" onClick={() => setMiCuenta(actual => !actual)}><UserRound size={17} />Mi cuenta</button>}
        <button
          className="boton boton-secundario"
          onClick={cerrarSesion}
          disabled={cerrando}
        >
          <LogOut size={17} aria-hidden="true" />
          {cerrando ? "Saliendo…" : "Cerrar sesión"}
        </button>
        </div>
      </header>

      <main className="contenido" id="contenido-principal">
        {errorSalida && (
          <p className="mensaje-error" role="alert">
            {errorSalida}
          </p>
        )}

        {errorPerfil ? (
          <section className="panel">
            <h1>No pudimos cargar tu cuenta</h1>
            <p className="texto-secundario" role="alert">
              {errorPerfil}
            </p>

            <button
              className="boton boton-principal"
              onClick={reintentarPerfil}
            >
              Reintentar
            </button>
          </section>
        ) : perfil ? (
          requierePassword ? <CompletarAcceso nombreUsuario={perfil.nombre_usuario} onListo={() => { terminarAcceso(); reintentarPerfil(); }} /> : miCuenta ? <MiCuenta nombreUsuario={perfil.nombre_usuario} correo={session.user.email ?? ''} onCancelar={() => setMiCuenta(false)} onGuardar={() => { setMiCuenta(false); reintentarPerfil(); }} /> : <Plataforma key={perfil.id} usuarioId={perfil.id} nombre={perfil.nombre} />
        ) : null}
      </main>
    </div>
  );
}
