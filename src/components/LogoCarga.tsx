import { useId } from 'react';
import logo from '../assets/brand/logo-gold-transparent.png';

// Los trazos revelan el PNG original: se conservan su silueta y su textura.
const trazos = [
  { clase: 'centro', camino: 'M 630 640 L 523 525 H 333' },
  { clase: 'centro', camino: 'M 630 640 L 737 525 H 925' },
  { clase: 'inferior', camino: 'M 630 640 L 523 752 H 333 V 840 H 115' },
  { clase: 'inferior', camino: 'M 630 640 L 737 752 H 925 V 840 H 1145' },
  { clase: 'rama', camino: 'M 333 525 V 435 H 115' },
  { clase: 'rama', camino: 'M 333 525 V 635 H 115' },
  { clase: 'rama', camino: 'M 925 525 V 435 H 1145' },
  { clase: 'rama', camino: 'M 925 525 V 635 H 1145' },
];

export default function LogoCarga() {
  const id = useId();
  const revelado = `${id}-revelado`;
  const silueta = `${id}-silueta`;
  const luz = `${id}-luz`;

  return <div className="carga-inicial-logo">
    <svg viewBox="96 368 1068 540" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <mask id={revelado} maskUnits="userSpaceOnUse" x="0" y="0" width="1261" height="1247" style={{ maskType: 'luminance' }}>
          <g stroke="white" strokeWidth="100" strokeLinecap="butt" strokeLinejoin="miter">
            {trazos.map(trazo => <path key={trazo.camino} d={trazo.camino} pathLength="1" className={`carga-inicial-trazo carga-inicial-trazo--${trazo.clase}`} />)}
          </g>
        </mask>
        <mask id={silueta} maskUnits="userSpaceOnUse" x="0" y="0" width="1261" height="1247" style={{ maskType: 'alpha' }}>
          <image href={logo} width="1261" height="1247" />
        </mask>
        <linearGradient id={luz}>
          <stop stopColor="white" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff1ce" stopOpacity=".85" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g mask={`url(#${revelado})`}>
        <image href={logo} width="1261" height="1247" />
        <g mask={`url(#${silueta})`}>
          <path className="carga-inicial-destello" d="M -300 350 H -80 L -300 930 H -520 Z" fill={`url(#${luz})`} />
        </g>
      </g>
    </svg>
    <span className="carga-inicial-origen" />
  </div>;
}
