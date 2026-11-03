import { useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "./lib/supabase";
import { useAuth } from "./hooks/useAuth";
import "./App.css";
import { BrowserRouter } from "react-router";
import FechasPage from "./features/fechas/FechasPage";
import JuradoPage from "./features/clasificatorias/JuradoPage";

function Marca() {
  return (
    <div className="marca" aria-label="Iconic Freestyle">
      <span className="marca-nombre">ICONIC</span>
      <span className="marca-subtitulo">FREESTYLE</span>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

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
          <span className="etiqueta">ORGANIZACIÓN</span>
          <h1>Todo listo para la fecha.</h1>
          <p>Participantes, cruces y votaciones en un mismo lugar.</p>
        </div>

        <span className="presentacion-pie">
          Acceso exclusivo de organización y jurados.
        </span>
      </section>

      <section className="acceso-formulario">
        <div className="tarjeta-login">
          <div className="icono-acceso">
            <ShieldCheck size={25} aria-hidden="true" />
          </div>

          <h2>Ingresar</h2>
          <p className="texto-secundario">
            Usá el correo y la contraseña de tu cuenta.
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
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const { session, perfil, errorPerfil, cargando, reintentarPerfil } =
    useAuth();

  const [cerrando, setCerrando] = useState(false);
  const [errorSalida, setErrorSalida] = useState("");

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

        <button
          className="boton boton-secundario"
          onClick={cerrarSesion}
          disabled={cerrando}
        >
          <LogOut size={17} aria-hidden="true" />
          {cerrando ? "Saliendo…" : "Cerrar sesión"}
        </button>
      </header>

      <main className="contenido">
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
          perfil.rol === "organizacion" ? (
            <BrowserRouter>
              <FechasPage />
            </BrowserRouter>
          ) : (
            <JuradoPage
              key={perfil.id}
              juradoId={perfil.id}
              nombre={perfil.nombre}
            />
          )
        ) : null}
      </main>
    </div>
  );
}
