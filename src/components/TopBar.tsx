/**
 * Barra superior: identidad, operaciones de archivo, deshacer/rehacer,
 * zoom y alternado de paneles.
 */
import { Icon, type IconName } from './Icons.tsx';
import { useEditor, selectCanRedo, selectCanUndo } from '../state/editorStore.tsx';

export interface TopBarActions {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onExportPng: () => void;
  onExportProject: () => void;
  onCanvasSize: () => void;
  onShortcuts: () => void;
}

function MenuButton({
  icon,
  label,
  onClick,
  title,
  disabled,
  accent,
  testId,
}: {
  icon: IconName;
  label?: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  accent?: boolean;
  testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`btn ${accent ? 'btn--accent' : ''}`}
      onClick={onClick}
      title={title ?? label}
      disabled={disabled}
      data-testid={testId}
    >
      <Icon name={icon} />
      {label ? <span className="btn__label">{label}</span> : null}
    </button>
  );
}

export function TopBar({ actions }: { actions: TopBarActions }): JSX.Element {
  const { state, dispatch } = useEditor();
  const panels = state.panels;
  const panelButtons: Array<{ id: 'top' | 'left' | 'right' | 'bottom'; icon: IconName; label: string }> = [
    { id: 'top', icon: 'panel-top', label: 'Paleta (Ctrl+1)' },
    { id: 'left', icon: 'panel-left', label: 'Panel de IA (Ctrl+2)' },
    { id: 'right', icon: 'panel-right', label: 'Panel de herramientas (Ctrl+3)' },
    { id: 'bottom', icon: 'panel-bottom', label: 'Barra de estado (Ctrl+4)' },
  ];

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Icon name="sparkles" size={18} />
        <span className="topbar__title">Pixel-IA Studio</span>
      </div>

      <div className="topbar__group">
        <MenuButton icon="plus" label="Nuevo" onClick={actions.onNew} testId="btn-new" />
        <MenuButton icon="folder" label="Abrir" onClick={actions.onOpen} testId="btn-open" />
        <MenuButton icon="save" label="Guardar" onClick={actions.onSave} testId="btn-save" />
        <MenuButton icon="image" label="Exportar PNG" onClick={actions.onExportPng} testId="btn-export-png" />
        <MenuButton icon="copy" label="Exportar proyecto" onClick={actions.onExportProject} testId="btn-export-project" />
        <MenuButton icon="settings" label="Tamaño del lienzo" onClick={actions.onCanvasSize} testId="btn-canvas-size" />
      </div>

      <div className="topbar__group">
        <MenuButton
          icon="undo"
          onClick={() => dispatch({ type: 'undo' })}
          title="Deshacer (Ctrl+Z)"
          disabled={!selectCanUndo(state)}
          testId="btn-undo"
        />
        <MenuButton
          icon="redo"
          onClick={() => dispatch({ type: 'redo' })}
          title="Rehacer (Ctrl+Y)"
          disabled={!selectCanRedo(state)}
          testId="btn-redo"
        />
        <MenuButton icon="grid" onClick={() => dispatch({ type: 'view/grid' })} title="Cuadrícula (H)" />
      </div>

      <div className="topbar__spacer" />

      <div className="topbar__group">
        <span className={`badge ${state.project.modified ? 'badge--warn' : ''}`}>
          {state.project.modified ? 'Sin guardar' : 'Guardado'}
        </span>
        <MenuButton icon="settings" label="Atajos" onClick={actions.onShortcuts} />
        {panelButtons.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`btn btn--icon ${panels[p.id] ? 'btn--active' : ''}`}
            title={p.label}
            onClick={() => dispatch({ type: 'panels/toggle', panel: p.id })}
            data-testid={`toggle-panel-${p.id}`}
          >
            <Icon name={p.icon} />
          </button>
        ))}
      </div>
    </header>
  );
}
