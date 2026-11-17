import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import logoPlataforma from '../../assets/brand/logo-gold-transparent.png';
import './inicioPublico.css';

const tituloGeneral = 'Competencias · Freestyle Uruguay';
const descripcionGeneral = 'Competencias de freestyle en Uruguay. Conocé sus cuentas oficiales e ingresá para administrar fechas, inscripciones, jurados y resultados.';

export default function MarcoPublico({ children, titulo = tituloGeneral, descripcion = descripcionGeneral }: {
  children: ReactNode;
  titulo?: string;
  descripcion?: string;
}) {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const destino = hash ? document.getElementById(hash.slice(1)) : null;
    if (destino) destino.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="description"]');
    document.title = titulo;
    meta?.setAttribute('content', descripcion);
    return () => {
      document.title = tituloGeneral;
      meta?.setAttribute('content', descripcionGeneral);
    };
  }, [titulo, descripcion]);

  return (
    <div className="inicio-publico">
      <a className="inicio-saltar" href="#inicio-contenido">Ir al contenido</a>
      <header className="inicio-cabecera inicio-ancho">
        <Link className="inicio-marca" to="/" aria-label="Competencias de freestyle · Inicio">
          <span className="inicio-isotipo"><img src={logoPlataforma} alt="" width={1261} height={1247} /></span>
          <span>COMPETENCIAS<small>FREESTYLE · URUGUAY</small></span>
        </Link>
        <nav aria-label="Navegación principal">
          <a className="inicio-nav-competencias" href={pathname === '/' ? '#competencias' : '/#competencias'}>Competencias</a>
          <Link className="inicio-acceso" to="/login">Iniciar sesión <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </nav>
      </header>
      <main id="inicio-contenido" className="inicio-ancho">{children}</main>
      <footer className="inicio-pie inicio-ancho"><span>Competencias de freestyle · Uruguay</span></footer>
    </div>
  );
}
