import { ArrowLeft, ArrowRight, ArrowUpRight, Camera, Link as LinkIcon, MapPin, Play, UsersRound } from 'lucide-react';
import { Link, useParams } from 'react-router';
import MarcoPublico from './MarcoPublico';
import { competenciasPublicas, instagramCompetencia, rutaCompetencia } from './competenciasPublicas';
import type { EnlaceCompetencia } from './competenciasPublicas';
import './presentacionCompetencia.css';

const iconos = { video: Play, enlaces: LinkIcon, ubicacion: MapPin, organizacion: UsersRound };

export function PaginaPublicaNoEncontrada() {
  return (
    <MarcoPublico titulo="Página no encontrada · Freestyle Uruguay">
      <section className="competencia-no-encontrada">
        <h1>No encontramos esta página</h1>
        <p>Podés volver al inicio para ver las competencias.</p>
        <Link className="inicio-acceso" to="/">Ver competencias <ArrowRight size={17} aria-hidden="true" /></Link>
      </section>
    </MarcoPublico>
  );
}

function CanalOficial({ enlace }: { enlace: EnlaceCompetencia }) {
  const Icono = iconos[enlace.tipo];
  return (
    <a className="competencia-canal" href={enlace.url} target="_blank" rel="noopener noreferrer" aria-label={`${enlace.nombre} (abre en otra pestaña)`}>
      <Icono size={20} aria-hidden="true" />
      <span><strong>{enlace.nombre}</strong><small>{enlace.descripcion}</small></span>
      <ArrowUpRight size={18} aria-hidden="true" />
    </a>
  );
}

export default function PresentacionCompetencia() {
  const { slug } = useParams();
  const competencia = competenciasPublicas.find(item => item.slug === slug);
  if (!competencia) return <PaginaPublicaNoEncontrada />;

  return (
    <MarcoPublico titulo={`${competencia.nombre} · Freestyle Uruguay`} descripcion={competencia.descripcion}>
      <article className={`competencia-presentacion inicio-competencia--${competencia.identidad}`}>
        <nav className="competencia-migas" aria-label="Ubicación en el sitio"><Link to="/#competencias"><ArrowLeft size={15} aria-hidden="true" />Competencias</Link><span aria-hidden="true">/</span><span aria-current="page">{competencia.nombre}</span></nav>

        <header className="competencia-hero">
          <div className="competencia-hero-texto">
            <p className="competencia-lugar"><MapPin size={15} aria-hidden="true" />{competencia.ubicacion}</p>
            <h1>{competencia.nombre}</h1>
            <p className="competencia-descripcion">{competencia.descripcion}</p>
            <a className="competencia-instagram" href={instagramCompetencia(competencia)} target="_blank" rel="noopener noreferrer"><Camera size={17} aria-hidden="true" />Ver Instagram <ArrowUpRight size={17} aria-hidden="true" /></a>
          </div>
          <div className="competencia-logo"><img src={competencia.logo} alt={`Logo de ${competencia.nombre}`} width={150} height={150} /></div>
        </header>

        <section className={`competencia-acerca ${competencia.imagen ? 'competencia-acerca-con-imagen' : ''}`} aria-labelledby="competencia-acerca-titulo">
          <div className="competencia-acerca-texto">
            <h2 id="competencia-acerca-titulo">Sobre {competencia.nombre}</h2>
            {competencia.presentacion.map(parrafo => <p key={parrafo}>{parrafo}</p>)}
            <a className="competencia-cuenta" href={instagramCompetencia(competencia)} target="_blank" rel="noopener noreferrer">@{competencia.cuenta}<ArrowUpRight size={15} aria-hidden="true" /><span className="solo-lectores"> (abre en otra pestaña)</span></a>
          </div>
          {competencia.imagen && <figure className={`competencia-foto competencia-foto--${competencia.imagen.formato}`}>
            <img src={competencia.imagen.src} alt={competencia.imagen.alt} width={competencia.imagen.ancho} height={competencia.imagen.alto} loading="lazy" decoding="async" />
            <figcaption><span>{competencia.imagen.credito}</span><a href={competencia.imagen.fuente} target="_blank" rel="noopener noreferrer">Ver publicación <ArrowUpRight size={13} aria-hidden="true" /><span className="solo-lectores"> (abre en otra pestaña)</span></a></figcaption>
          </figure>}
        </section>

        <section className="competencia-canales" aria-labelledby="competencia-canales-titulo">
          <h2 id="competencia-canales-titulo">Canales oficiales</h2>
          <div className="competencia-canales-grilla">
            <a className="competencia-canal" href={instagramCompetencia(competencia)} target="_blank" rel="noopener noreferrer" aria-label="Instagram (abre en otra pestaña)"><Camera size={20} aria-hidden="true" /><span><strong>Instagram</strong><small>@{competencia.cuenta}</small></span><ArrowUpRight size={18} aria-hidden="true" /></a>
            {competencia.enlaces.map(enlace => <CanalOficial key={enlace.url} enlace={enlace} />)}
          </div>
        </section>

        <nav className="competencia-otras" aria-label="Otras competencias">
          <h2>Otras competencias</h2>
          <ul>{competenciasPublicas.filter(item => item.slug !== competencia.slug).map(item => <li key={item.slug}><Link to={rutaCompetencia(item)}><img src={item.logo} alt="" width={36} height={36} loading="lazy" /><span>{item.nombre}</span><ArrowRight size={15} aria-hidden="true" /></Link></li>)}</ul>
        </nav>
      </article>
    </MarcoPublico>
  );
}
