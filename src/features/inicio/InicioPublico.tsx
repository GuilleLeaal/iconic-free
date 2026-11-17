import { ArrowDown, ArrowRight, Camera } from 'lucide-react';
import { Link } from 'react-router';
import MarcoPublico from './MarcoPublico';
import { competenciasPublicas, rutaCompetencia } from './competenciasPublicas';
import './inicioPublico.css';

export default function InicioPublico() {
  return (
    <MarcoPublico>
        <section className="inicio-hero" aria-labelledby="inicio-titulo">
          <div className="inicio-hero-texto">
            <h1 id="inicio-titulo">Competencias de freestyle<br />en Uruguay.</h1>
            <p className="inicio-descripcion">Conocé a las competencias de freestyle que usan esta plataforma.</p>
            <a className="inicio-explorar" href="#competencias">Ver competencias <ArrowDown size={17} aria-hidden="true" /></a>
          </div>
        </section>

        <section id="competencias" className="inicio-competencias" aria-labelledby="competencias-titulo">
          <div className="inicio-seccion-titulo">
            <h2 id="competencias-titulo">Competencias</h2>
            <p>Conocé cada competencia.</p>
          </div>
          <ul className="inicio-grilla">
            {competenciasPublicas.map(competencia => (
              <li key={competencia.cuenta}>
                <Link className={`inicio-competencia inicio-competencia--${competencia.identidad}`} to={rutaCompetencia(competencia)} aria-label={`Conocer ${competencia.nombre}`}>
                  <div className="inicio-identidad"><img src={competencia.logo} alt={`Logo de ${competencia.nombre}`} width={150} height={150} loading="lazy" decoding="async" /><ArrowRight className="inicio-flecha" size={20} aria-hidden="true" /></div>
                  <div className="inicio-competencia-pie"><h3>{competencia.nombre}</h3><span><Camera size={14} aria-hidden="true" />@{competencia.cuenta}</span></div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="inicio-organizacion" aria-labelledby="organizacion-titulo">
          <div><h2 id="organizacion-titulo">Organización y jurados</h2><p>Ingresá para administrar fechas, inscripciones, sorteos y resultados.</p></div>
          <Link className="inicio-acceso" to="/login">Iniciar sesión <ArrowRight size={17} aria-hidden="true" /></Link>
        </section>
    </MarcoPublico>
  );
}
