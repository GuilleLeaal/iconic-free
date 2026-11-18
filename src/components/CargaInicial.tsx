import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import logo from '../assets/brand/logo-gold-transparent.png';
import './cargaInicial.css';

export default function CargaInicial({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<'cargando' | 'saliendo' | 'lista'>('cargando');
  const imagen = useRef<HTMLImageElement>(null);
  const visible = estado !== 'lista';

  useEffect(() => {
    const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const elemento = imagen.current;
    let minimoCumplido = false;
    let saliendo = false;
    let salida: number | undefined;

    function terminar(forzar = false) {
      if (saliendo) return;
      if (!forzar && (!minimoCumplido || document.readyState !== 'complete' || (elemento && !elemento.complete))) return;
      saliendo = true;
      setEstado('saliendo');
      salida = window.setTimeout(() => setEstado('lista'), reducirMovimiento ? 0 : 300);
    }

    const comprobarCarga = () => terminar();
    window.addEventListener('load', comprobarCarga);
    elemento?.addEventListener('load', comprobarCarga);
    elemento?.addEventListener('error', comprobarCarga);
    const minimo = window.setTimeout(() => {
      minimoCumplido = true;
      terminar();
    }, reducirMovimiento ? 0 : 1100);
    // Una imagen o recurso lento nunca debe dejar el sitio bloqueado.
    const limite = window.setTimeout(() => terminar(true), 3500);

    return () => {
      window.removeEventListener('load', comprobarCarga);
      elemento?.removeEventListener('load', comprobarCarga);
      elemento?.removeEventListener('error', comprobarCarga);
      window.clearTimeout(minimo);
      window.clearTimeout(limite);
      window.clearTimeout(salida);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = anterior; };
  }, [visible]);

  return <>
    {visible && <div className={`carga-inicial${estado === 'saliendo' ? ' carga-inicial--saliendo' : ''}`} role="status" aria-label="Cargando el sitio">
      <div className="carga-inicial-marca" aria-hidden="true">
        <div className="carga-inicial-logo"><img ref={imagen} src={logo} alt="" width={1261} height={1247} fetchPriority="high" /></div>
        <p className="carga-inicial-nombre">COMPETENCIAS</p>
        <p className="carga-inicial-subtitulo">FREESTYLE · URUGUAY</p>
        <span className="carga-inicial-barra" />
        <p className="carga-inicial-texto">Cargando</p>
      </div>
    </div>}
    <div inert={visible} aria-hidden={visible ? true : undefined}>{children}</div>
  </>;
}
