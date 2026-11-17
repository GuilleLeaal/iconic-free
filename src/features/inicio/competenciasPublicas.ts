import dem from '../../assets/competencias/dem.jpg';
import novena from '../../assets/competencias/9na-avenida.jpg';
import green from '../../assets/competencias/green-and-white.jpg';
import antag from '../../assets/competencias/antag.jpg';
import iconic from '../../assets/competencias/iconic.jpg';
import exiliados from '../../assets/competencias/exiliados-park.jpg';
import demPresentacion from '../../assets/competencias/dem-presentacion.jpg';
import novenaPresentacion from '../../assets/competencias/9na-presentacion.webp';
import greenPresentacion from '../../assets/competencias/green-presentacion.jpg';
import antagPresentacion from '../../assets/competencias/antag-presentacion.webp';

export type EnlaceCompetencia = {
  tipo: 'video' | 'enlaces' | 'ubicacion' | 'organizacion';
  nombre: string;
  descripcion: string;
  url: string;
};

export type CompetenciaPublica = {
  slug: string;
  nombre: string;
  cuenta: string;
  logo: string;
  identidad: string;
  ubicacion: string;
  descripcion: string;
  presentacion: string[];
  enlaces: EnlaceCompetencia[];
  imagen?: {
    src: string;
    alt: string;
    credito: string;
    fuente: string;
    formato: 'vertical' | 'horizontal';
    ancho: number;
    alto: number;
  };
};

// Catálogo público editorial. No depende del directorio privado ni publica agenda.
// Fuentes y alcance de la investigación: docs/COMPETENCIAS_PUBLICAS.md.
export const competenciasPublicas: CompetenciaPublica[] = [
  {
    slug: 'dem-battles', nombre: 'DEM Battles', cuenta: 'dem.uruguay', logo: dem, identidad: 'dem',
    ubicacion: 'Montevideo, Uruguay',
    descripcion: 'DEM Uruguay es la versión uruguaya de la DEM, que arrancó en Chile y después llegó a otros países.',
    presentacion: [
      'La DEM arrancó en Santiago de Chile en 2016. La armaron Diego y Matías Núñez, los hermanos detrás de Don Rapeador. Las primeras fechas fueron en el Parque O’Higgins y, con el tiempo, el Parque Bustamante se volvió uno de sus lugares más conocidos.',
      'Fue creciendo con las batallas de plaza: Competidores que llegaban de distintas partes de Chile y gente que se acercaba a verlos rapear. Por ahí pasaron Joqerr, Pepe Grillo, Metalingüística, Teorema y Rodamiento, entre muchos otros que fueron ganando su lugar en el freestyle chileno.',
      'En 2022, la DEM empezó a hacerse también en Uruguay, Argentina y España. A las batallas de Chile se sumaron las de otros países, cada uno con sus competidores, su organización y su público.',
      'Acá arrancó ese mismo año, en la Plaza Líber Seregni de Montevideo. Al frente estaba Sant Núñez, que ya venía de organizar 3X Freestyle y La Liga.',
      'Hammer, Harry, Alexunder, fueron algunos de los Competidores que estuvieron en esas primeras fechas. Hubo batallas individuales y en duplas, y con los años se sumaron otros formatos, como DEM Tríplice, donde se compite en equipos de tres.',
    ],
    enlaces: [
      { tipo: 'video', nombre: 'YouTube', descripcion: 'Batallas de DEM Uruguay.', url: 'https://www.youtube.com/DEMUruguay' },
    ],
    imagen: { src: demPresentacion, alt: 'Competidores de DEM Tríplice en Parque Batlle.', credito: 'Foto: @branden_figarola · DEM Uruguay', fuente: 'https://www.instagram.com/dem.uruguay/p/DfyDMSiFYa_/', formato: 'vertical', ancho: 1638, alto: 2031 },
  },
  {
    slug: '9na-avenida', nombre: '9na Avenida', cuenta: '9na_avenida', logo: novena, identidad: 'novena',
    ubicacion: 'Atlántida, Canelones',
    descripcion: 'La 9na es de Atlántida. Lleva varias temporadas juntando competidores de Uruguay y de otros países para batallar y rapear.',
    presentacion: [
      'La 9na Avenida es una competencia de freestyle de Atlántida, Canelones. Por sus fechas pasaron competidores de distintas partes de Uruguay e invitados de otros países, que se fueron cruzando en batallas y cyphers.',
      'En sus primeras tres temporadas hubo batallas individuales, por equipos y fechas como «Batalla de Canciones» y «2v2 Sin Carreo». También se armaron cyphers y encuentros internacionales, con distintas formas de competir y de convivencia.',
      'La 9na también tuvo fechas en Montevideo y compartió una con Green & White. Así se fue cruzando con otras competencias y con gente de la costa y de otras partes del país.',
    ],
    enlaces: [
      { tipo: 'video', nombre: 'YouTube', descripcion: 'Videos de 9na Avenida Battles.', url: 'https://www.youtube.com/@9naAvenidaBattles' },
      { tipo: 'enlaces', nombre: 'Fotos y otros canales', descripcion: 'Fotos de distintas temporadas y más enlaces.', url: 'https://linktr.ee/9na_avenida' },
    ],
    imagen: { src: novenaPresentacion, alt: '9na Avenida: batallas, cyphers y sus primeras temporadas.', credito: '9na Avenida · diseño: @blueish.zazu', fuente: 'https://www.instagram.com/9na_avenida/p/DNgzqiVNBxV/', formato: 'vertical', ancho: 1080, alto: 1350 },
  },
  {
    slug: 'green-and-white', nombre: 'Green & White', cuenta: 'greenandwhite_free', logo: green, identidad: 'green',
    ubicacion: 'Uruguay',
    descripcion: 'Una competencia uruguaya de batallas y cyphers, con fechas en la Plaza de la Bandera.',
    presentacion: [
      'Green & White es una competencia uruguaya que hace batallas en la Plaza de la Bandera. Ahí se juntan los competidores y la gente que va a verlos batallar.',
      'Para festejar su tercer aniversario armaron un cypher, juntando a varios MCs a rapear.',
      'También compartieron una fecha con la 9na Avenida y organizaron batallas que dieron cupos para otras competencias de Uruguay y para Pache Ring, en Lima, Perú.',
    ],
    enlaces: [
      { tipo: 'video', nombre: 'Cypher del tercer aniversario', descripcion: 'Cypher de Green & White.', url: 'https://youtu.be/tBVzlzssQFg' },
    ],
    imagen: { src: greenPresentacion, alt: 'Un participante de Green & White rodeado de público.', credito: 'Foto: @yami_fotografia018 · Green & White', fuente: 'https://www.instagram.com/yami_fotografia018/p/Dfs2QZLI3mf/', formato: 'horizontal', ancho: 4096, alto: 2730 },
  },
  {
    slug: 'antag-freestyle', nombre: 'AntagFreestyle', cuenta: 'antagfree', logo: antag, identidad: 'antag',
    ubicacion: 'Las Piedras, Canelones',
    descripcion: 'Las batallas de la Antag, en Las Piedras, Canelones.',
    presentacion: [
      'La Antag es de Las Piedras. En el anfiteatro «A don José» se juntaron los competidores y el público para sus batallas.',
      'La organizan @grimreaper.zk y @kardumen.yk.',
    ],
    enlaces: [
      { tipo: 'video', nombre: 'YouTube', descripcion: 'Canal oficial de AntagFreestyle.', url: 'https://www.youtube.com/@antagfreestyle' },
      { tipo: 'ubicacion', nombre: 'Dónde es', descripcion: 'Abrir en Maps.', url: 'https://maps.app.goo.gl/7Q6izGScgzjZcaEz6' },
    ],
    imagen: { src: antagPresentacion, alt: 'Dos competidores batallando en la Antag, con público alrededor.', credito: 'Foto: @ana.pausax · AntagFreestyle', fuente: 'https://www.instagram.com/antagfree/p/Dep-hKLFs0E/', formato: 'horizontal', ancho: 1080, alto: 720 },
  },
  {
    slug: 'iconic-freestyle', nombre: 'Iconic Freestyle', cuenta: 'iconic.free', logo: iconic, identidad: 'iconic',
    ubicacion: 'Uruguay',
    descripcion: 'Competencia de freestyle de Uruguay.',
    presentacion: [
      'Iconic arma batallas de freestyle en Uruguay.',
      'La organiza @guillee.leal, con el apoyo de marcas y emprendimientos que se suman a la competencia.',
    ],
    enlaces: [
      { tipo: 'organizacion', nombre: 'Organización', descripcion: '@guillee.leal', url: 'https://www.instagram.com/guillee.leal/' },
    ],
  },
  {
    slug: 'exiliados-park', nombre: 'Exiliados Park', cuenta: 'exiliadospark', logo: exiliados, identidad: 'exiliados',
    ubicacion: 'Uruguay',
    descripcion: 'Una competencia de freestyle de Uruguay, con Exiliados Crew.',
    presentacion: [
      'Exiliados Park arrancó con una invitación a competidores a batallar en la Plaza de la Bandera.',
      'La acompañaron Exiliados Crew y emprendimientos de la zona, que dieron una mano para armar la competencia.',
    ],
    enlaces: [
      { tipo: 'organizacion', nombre: 'Exiliados Crew', descripcion: 'La crew que acompaña a Exiliados Park.', url: 'https://www.instagram.com/exiliadoscrew/' },
    ],
  },
];

export function rutaCompetencia(competencia: CompetenciaPublica) {
  return `/competencias/${competencia.slug}`;
}

export function instagramCompetencia(competencia: CompetenciaPublica) {
  return `https://www.instagram.com/${competencia.cuenta}/`;
}
