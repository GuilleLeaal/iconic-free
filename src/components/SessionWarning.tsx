import { useEffect, useRef } from 'react';
import type { SessionExpiryReason } from '../lib/sessionPolicy';

export default function SessionWarning({ reason, remainingSeconds, onContinue, onEnd }: {
  reason: SessionExpiryReason;
  remainingSeconds: number;
  onContinue: () => void;
  onEnd: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  const countdown = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;
  return <dialog ref={dialog} className="session-warning" aria-labelledby="session-warning-title" aria-describedby="session-warning-description" onCancel={event => event.preventDefault()}>
    <span className="micro-etiqueta">TU CUENTA</span>
    <h2 id="session-warning-title">Tu sesión está por vencer</h2>
    <p id="session-warning-description">{reason === 'idle'
      ? 'Hace un rato que no interactuás con la plataforma. Confirmá para seguir trabajando.'
      : 'Tu sesión está por cumplir 12 horas. Vas a tener que ingresar nuevamente para continuar.'}</p>
    <p className="session-warning-countdown" aria-hidden="true">Tiempo restante: <strong>{countdown}</strong></p>
    <p className="texto-secundario">Podrás retomar los borradores que se hayan guardado.</p>
    <div className="session-warning-actions">
      {reason === 'idle' && <button type="button" className="boton boton-secundario" onClick={onEnd}>Cerrar sesión</button>}
      <button type="button" className="boton boton-principal" autoFocus onClick={reason === 'idle' ? onContinue : onEnd}>
        {reason === 'idle' ? 'Continuar sesión' : 'Volver a ingresar'}
      </button>
    </div>
  </dialog>;
}
