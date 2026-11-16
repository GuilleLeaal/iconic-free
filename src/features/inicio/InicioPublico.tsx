import { ArrowDown, ArrowRight, ArrowUpRight, Camera } from 'lucide-react';
import { Link } from 'react-router';
import logoPlataforma from '../../assets/brand/logo-gold-transparent.png';
import dem from '../../assets/competencias/dem.jpg';
import novena from '../../assets/competencias/9na-avenida.jpg';
import green from '../../assets/competencias/green-and-white.jpg';
import antag from '../../assets/competencias/antag.jpg';
import iconic from '../../assets/competencias/iconic.jpg';
import exiliados from '../../assets/competencias/exiliados-park.jpg';
import './inicioPublico.css';

// El orden editorial y las identidades son independientes del directorio privado.
const competencias = [
  { nombre: 'DEM Battles', cuenta: 'dem.uruguay', logo: dem, identidad: 'dem' },
  { nombre: '9na Avenida', cuenta: '9na_avenida', logo: novena, identidad: 'novena' },
  { nombre: 'Green & White', cuenta: 'greenandwhite_free', logo: green, identidad: 'green' },
  { nombre: 'AntagFreestyle', cuenta: 'antagfree', logo: antag, identidad: 'antag' },
  { nombre: 'Iconic Freestyle', cuenta: 'iconic.free', logo: iconic, identidad: 'iconic' },
  { nombre: 'Exiliados Park', cuenta: 'exiliadospark', logo: exiliados, identidad: 'exiliados' },
];

export default function InicioPublico() {
  return (
    <div className="inicio-publico">
      <a className="inicio-saltar" href="#inicio-contenido">Ir al contenido</a>
      <header className="inicio-cabecera inicio-ancho">
        <Link className="inicio-marca" to="/" aria-label="Competencias de freestyle · Inicio">
          <span className="inicio-isotipo"><img src={logoPlataforma} alt="" width={1261} height={1247} /></span>
          <span>COMPETENCIAS<small>FREESTYLE · URUGUAY</small></span>
        </Link>
        <nav aria-label="Navegación principal">
          <a className="inicio-nav-competencias" href="#competencias">Competencias</a>
          <Link className="inicio-acceso" to="/login">Iniciar sesión <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </nav>
      </header>

      <main id="inicio-contenido" className="inicio-ancho">
        <section className="inicio-hero" aria-labelledby="inicio-titulo">
          <div className="inicio-hero-texto">
            <h1 id="inicio-titulo">Competencias de freestyle<br />en Uruguay.</h1>
            <p className="inicio-descripcion">Conocé las competencias que usan la plataforma y encontrá sus fechas y novedades en Instagram.</p>
            <a className="inicio-explorar" href="#competencias">Ver competencias <ArrowDown size={17} aria-hidden="true" /></a>
          </div>
        </section>

        <section id="competencias" className="inicio-competencias" aria-labelledby="competencias-titulo">
          <div className="inicio-seccion-titulo">
            <h2 id="competencias-titulo">Competencias</h2>
            <p>Visitá sus cuentas oficiales.</p>
          </div>
          <ul className="inicio-grilla">
            {competencias.map(competencia => (
              <li key={competencia.cuenta}>
                <a className={`inicio-competencia inicio-competencia--${competencia.identidad}`} href={`https://www.instagram.com/${competencia.cuenta}/`} target="_blank" rel="noopener noreferrer" aria-label={`${competencia.nombre} en Instagram (abre en otra pestaña)`}>
                  <div className="inicio-identidad"><img src={competencia.logo} alt={`Logo de ${competencia.nombre}`} width={150} height={150} loading="lazy" decoding="async" /><ArrowUpRight className="inicio-flecha" size={20} aria-hidden="true" /></div>
                  <div className="inicio-competencia-pie"><h3>{competencia.nombre}</h3><span><Camera size={14} aria-hidden="true" />@{competencia.cuenta}</span></div>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="inicio-organizacion" aria-labelledby="organizacion-titulo">
          <div><h2 id="organizacion-titulo">Organización y jurados</h2><p>Ingresá para administrar fechas, inscripciones, sorteos y resultados.</p></div>
          <Link className="inicio-acceso" to="/login">Iniciar sesión <ArrowRight size={17} aria-hidden="true" /></Link>
        </section>
      </main>

      <footer className="inicio-pie inicio-ancho"><span>Competencias de freestyle · Uruguay</span></footer>
    </div>
  );
}
