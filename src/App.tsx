/**
 * Pixel-IA Studio — composición de la aplicación.
 *
 * Distribución: barra superior (archivo + paleta), panel izquierdo (IA),
 * lienzo central, panel derecho (herramientas/capas/minimapa) y barra de
 * estado inferior. Todos los paneles son alternables.
 */
import { useState } from 'react';
import { PixelCanvas } from './canvas/PixelCanvas.tsx';
import { Dialogs, type DialogId } from './components/Dialogs.tsx';
import { LeftAiPanel } from './components/LeftAiPanel.tsx';
import { PaletteBar, type PaletteBarActions } from './components/PaletteBar.tsx';
import { RightPanel } from './components/RightPanel.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { Toasts } from './components/Toasts.tsx';
import { TopBar, type TopBarActions } from './components/TopBar.tsx';
import { EditorProvider, useAutoToasts, useEditor } from './state/editorStore.tsx';
import { useKeyboard } from './utils/useKeyboard.ts';
import {
  exportProject,
  importPalette,
  openProject,
  saveProject,
} from './utils/projectOps.ts';

export function App(): JSX.Element {
  return (
    <EditorProvider>
      <AppInner />
    </EditorProvider>
  );
}

function AppInner(): JSX.Element {
  const { state, dispatch, toast } = useEditor();
  useAutoToasts();
  const [dialog, setDialog] = useState<DialogId>(null);

  const topActions: TopBarActions = {
    onNew: () => setDialog('new'),
    onOpen: () => void openProject(dispatch, toast),
    onSave: () => saveProject(state, dispatch, toast),
    onExportPng: () => setDialog('export-png'),
    onExportProject: () => exportProject(state, toast),
    onCanvasSize: () => setDialog('canvas'),
    onShortcuts: () => setDialog('shortcuts'),
  };

  const paletteActions: PaletteBarActions = {
    onAddColor: () => setDialog('color-add'),
    onEditColor: () => setDialog('color-edit'),
    onReplaceColor: () => setDialog('replace-color'),
    onImportPalette: (mode) => void importPalette(dispatch, mode, toast),
    onExportPalette: () => setDialog('export-palette'),
    onPastePalette: () => setDialog('paste-palette'),
  };

  useKeyboard({
    state,
    dispatch,
    onNew: () => setDialog('new'),
    onOpen: () => void openProject(dispatch, toast),
    onSave: () => saveProject(state, dispatch, toast),
    onExportPng: () => setDialog('export-png'),
    onFit: () => dispatch({ type: 'view/fit' }),
  });

  return (
    <div className="app" data-testid="app">
      <TopBar actions={topActions} />
      {state.panels.top ? <PaletteBar actions={paletteActions} /> : null}

      <div className="app__main">
        {state.panels.left ? <LeftAiPanel /> : null}
        <PixelCanvas />
        {state.panels.right ? <RightPanel /> : null}
      </div>

      {state.panels.bottom ? <StatusBar /> : null}

      <Toasts />
      <Dialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
