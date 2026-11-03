import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Paginacion({ pagina, hayMas, onCambiar, nombre }: {
  pagina: number; hayMas: boolean; onCambiar: (pagina: number) => void; nombre: string;
}) {
  return <nav className="paginacion" aria-label={nombre}>
    <button type="button" className="boton boton-secundario" disabled={pagina === 0} onClick={() => onCambiar(pagina - 1)}><ChevronLeft size={15} />Anterior</button>
    <span>Página <strong>{pagina + 1}</strong></span>
    <button type="button" className="boton boton-secundario" disabled={!hayMas} onClick={() => onCambiar(pagina + 1)}>Siguiente<ChevronRight size={15} /></button>
  </nav>;
}
