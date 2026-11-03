/** Avisos flotantes (toasts) de la aplicación. */
import { useEditor } from '../state/editorStore.tsx';
import { Icon } from './Icons.tsx';

export function Toasts(): JSX.Element {
  const { state, dispatch } = useEditor();
  return (
    <div className="toasts" data-testid="toasts">
      {state.toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} data-testid={`toast-${toast.kind}`}>
          <Icon name={toast.kind === 'error' ? 'x' : toast.kind === 'success' ? 'check' : 'sparkles'} size={13} />
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast__close"
            onClick={() => dispatch({ type: 'toast/dismiss', id: toast.id })}
            title="Cerrar"
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
