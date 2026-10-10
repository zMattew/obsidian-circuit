import { App, Component, Modal } from 'obsidian';
import {
  CircuitComponent,
  CircuitConnection,
  CircuitData,
  CircuitLoop,
  EditorTool,
  SelectionType,
} from '../types';
import { CircuitCanvas } from './circuitCanvas';
import { CircuitToolbar } from './circuitToolbar';
import { ComponentPropertiesModal } from './componentPropertiesModal';
import { ConnectionPropertiesModal } from './connectionPropertiesModal';
import { LoopPropertiesModal } from './loopPropertiesModal';
import { buildCircuitTopology } from '../utils/circuitTopology';
import { renderCircuitGraph, renderIncidenceMatrix } from './circuitTopologyViews';

type CircuitView = 'schematic' | 'graph' | 'matrix';

export class CircuitModal extends Modal {
  private data: CircuitData;
  private onSave: (savedData: CircuitData) => void;
  private modalComponent = new Component();

  private canvas: CircuitCanvas | null = null;
  private toolbar: CircuitToolbar | null = null;
  private infoEl: HTMLElement | null = null;
  private canvasWrapEl: HTMLElement | null = null;
  private graphViewEl: HTMLElement | null = null;
  private matrixViewEl: HTMLElement | null = null;
  private viewButtons = new Map<CircuitView, HTMLButtonElement>();

  // History stack for Undo / Redo
  private history: string[] = [];
  private future: string[] = [];
  private readonly maxHistory = 30;

  constructor(app: App, initialData: CircuitData, onSave: (savedData: CircuitData) => void) {
    super(app);
    // Deep copy initial data
    this.data = JSON.parse(JSON.stringify(initialData)) as CircuitData;
    if (!this.data.components) this.data.components = [];
    if (!this.data.connections) this.data.connections = [];
    if (!this.data.loops) this.data.loops = [];
    this.onSave = onSave;
    this.pushHistory();
  }

  override onOpen(): void {
    this.modalComponent.load();
    const { contentEl, modalEl } = this;
    contentEl.empty();
    contentEl.addClass('circuit-editor-content');
    modalEl.addClass('circuit-editor-modal');

    // Header
    const headerEl = contentEl.createDiv({ cls: 'circuit-editor-header' });
    headerEl.createEl('h2', { text: 'Circuit schematic editor' });
    headerEl.createEl('p', {
      cls: 'circuit-editor-subtitle',
      text: 'Click component to place (R to rotate preview) • Click or drag pins to wire • Left-click for context menu',
    });

    // Toolbar Container
    this.toolbar = new CircuitToolbar(contentEl, {
      onSelectTool: (tool: EditorTool) => {
        this.canvas?.setTool(tool);
        this.toolbar?.setActiveTool(tool);
      },
      onRotate: () => {
        if (this.canvas?.hasGhostTool()) {
          this.canvas.rotateGhost();
        } else {
          this.canvas?.rotateSelected();
        }
      },
      onDelete: () => {
        this.canvas?.deleteSelected();
      },
      onUndo: () => {
        this.undo();
      },
      onRedo: () => {
        this.redo();
      },
      onToggleGrid: () => {
        this.data.grid = this.data.grid === false ? true : false;
        this.pushHistory();
        this.refreshEditor();
      },
      onClear: () => {
        this.data.components = [];
        this.data.connections = [];
        this.data.loops = [];
        this.pushHistory();
        this.refreshEditor();
      },
      onSaveView: () => {
        this.canvas?.saveView();
      },
      onFitView: () => {
        this.canvas?.fitView();
      },
    });

    const viewContainer = contentEl.createDiv({ cls: 'circuit-editor-view-container' });
    const viewTabs = viewContainer.createDiv({
      cls: 'circuit-view-tabs circuit-editor-view-tabs',
      attr: { role: 'group', 'aria-label': 'Viste del circuito' },
    });
    const views: Array<[CircuitView, string]> = [
      ['schematic', 'Schema'],
      ['graph', 'Grafo'],
      ['matrix', 'Matrice'],
    ];
    for (const [view, label] of views) {
      const button = viewTabs.createEl('button', {
        cls: 'circuit-view-tab',
        text: label,
        attr: { type: 'button', 'aria-pressed': String(view === 'schematic') },
      });
      button.addEventListener('click', () => this.setActiveView(view));
      this.viewButtons.set(view, button);
    }

    // Canvas Container
    this.canvas = new CircuitCanvas(
      viewContainer,
      this.data,
      {
        onSelectionChange: (type: SelectionType) => {
          this.toolbar?.setSelectionState(type);
        },
        onToolChange: (tool: EditorTool) => {
          this.toolbar?.setActiveTool(tool);
        },
        onEditComponent: (comp: CircuitComponent) => {
          if (comp.type === 'text') {
            this.canvas?.startInlineTextEdit(comp);
          } else {
            new ComponentPropertiesModal(this.app, comp, (updated) => {
              this.canvas?.updateComponent(updated);
            }).open();
          }
        },
        onEditConnection: (conn: CircuitConnection) => {
          const idx = this.data.connections?.findIndex((c) => c === conn) ?? -1;
          if (idx !== -1) {
            new ConnectionPropertiesModal(this.app, conn, (updated) => {
              this.canvas?.updateConnection(idx, updated);
            }).open();
          }
        },
        onEditLoop: (loop: CircuitLoop) => {
          new LoopPropertiesModal(this.app, loop, (updated) => {
            this.canvas?.updateLoop(updated);
          }).open();
        },
        onDataChange: () => {
          this.pushHistory();
          this.updateFooterInfo();
          this.refreshTopologyViews();
        },
      },
      this.app,
      this.modalComponent
    );
    this.canvasWrapEl = viewContainer.querySelector<HTMLElement>('.circuit-editor-canvas-wrap');
    this.graphViewEl = viewContainer.createDiv({
      cls: 'circuit-topology-view circuit-editor-topology-view is-view-hidden',
      attr: { hidden: '' },
    });
    this.matrixViewEl = viewContainer.createDiv({
      cls: 'circuit-topology-view circuit-editor-topology-view is-view-hidden',
      attr: { hidden: '' },
    });
    this.refreshTopologyViews();
    this.toolbar.setGridEnabled(this.data.grid !== false);

    // Footer actions
    const footerEl = contentEl.createDiv({ cls: 'circuit-editor-footer' });

    this.infoEl = footerEl.createSpan({ cls: 'circuit-footer-info' });
    this.updateFooterInfo();

    const btnGroup = footerEl.createDiv({ cls: 'circuit-footer-buttons' });

    const cancelBtn = btnGroup.createEl('button', {
      text: 'Cancel',
      cls: 'mod-cancel',
      attr: { type: 'button' },
    });
    cancelBtn.addEventListener('click', () => {
      this.close();
    });

    const saveBtn = btnGroup.createEl('button', {
      text: 'Save to note',
      cls: 'mod-cta',
      attr: { type: 'button' },
    });
    saveBtn.addEventListener('click', () => {
      if (this.canvas?.isEditingText()) {
        this.canvas.finishInlineTextEdit();
      }
      this.onSave(this.data);
      this.close();
    });

    // Keyboard Shortcuts
    this.bindKeyboardShortcuts();
  }

  override onClose(): void {
    this.modalComponent.unload();
    const { contentEl } = this;
    contentEl.empty();
    this.canvas = null;
    this.toolbar = null;
    this.infoEl = null;
    this.canvasWrapEl = null;
    this.graphViewEl = null;
    this.matrixViewEl = null;
    this.viewButtons.clear();
  }

  private pushHistory(): void {
    const snapshot = JSON.stringify(this.data);
    if (this.history.length === 0 || this.history[this.history.length - 1] !== snapshot) {
      this.history.push(snapshot);
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
      this.future = [];
    }
  }

  private undo(): void {
    if (this.history.length > 1) {
      const current = this.history.pop();
      if (current) {
        this.future.push(current);
      }
      const previous = this.history[this.history.length - 1];
      if (previous) {
        this.data = JSON.parse(previous) as CircuitData;
        this.refreshEditor();
      }
    }
  }

  private redo(): void {
    if (this.future.length > 0) {
      const next = this.future.pop();
      if (next) {
        this.history.push(next);
        this.data = JSON.parse(next) as CircuitData;
        this.refreshEditor();
      }
    }
  }

  private refreshEditor(): void {
    this.canvas?.setData(this.data);
    this.toolbar?.setGridEnabled(this.data.grid !== false);
    this.updateFooterInfo();
    this.refreshTopologyViews();
  }

  private refreshTopologyViews(): void {
    const topology = buildCircuitTopology(this.data);
    if (this.graphViewEl) renderCircuitGraph(this.graphViewEl, topology);
    if (this.matrixViewEl) renderIncidenceMatrix(this.matrixViewEl, topology);
  }

  private setActiveView(view: CircuitView): void {
    if (view !== 'schematic') this.refreshTopologyViews();
    if (this.canvasWrapEl) {
      const showSchematic = view === 'schematic';
      this.canvasWrapEl.toggleClass('is-view-hidden', !showSchematic);
      this.canvasWrapEl.hidden = !showSchematic;
    }
    if (this.graphViewEl) {
      const showGraph = view === 'graph';
      this.graphViewEl.toggleClass('is-view-hidden', !showGraph);
      this.graphViewEl.hidden = !showGraph;
    }
    if (this.matrixViewEl) {
      const showMatrix = view === 'matrix';
      this.matrixViewEl.toggleClass('is-view-hidden', !showMatrix);
      this.matrixViewEl.hidden = !showMatrix;
    }

    for (const [name, button] of this.viewButtons) {
      const active = name === view;
      button.toggleClass('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private updateFooterInfo(): void {
    if (!this.infoEl) return;
    const compCount = this.data.components?.length || 0;
    const connCount = this.data.connections?.length || 0;
    const loopCount = this.data.loops?.length || 0;
    const loopStr = loopCount > 0 ? `, ${loopCount} loops` : '';
    this.infoEl.setText(`${compCount} components, ${connCount} connections${loopStr}`);
  }

  private bindKeyboardShortcuts(): void {
    const isTyping = (): boolean => {
      const active = document.activeElement;
      if (!active) return Boolean(this.canvas?.isEditingText());
      const tag = active.tagName.toLowerCase();
      return (
        tag === 'input' ||
        tag === 'textarea' ||
        (active as HTMLElement).isContentEditable ||
        Boolean(active.closest('.cm-editor')) ||
        Boolean(this.canvas?.isEditingText())
      );
    };

    const handleRotate = (): boolean | void => {
      if (isTyping()) return;
      if (this.canvas?.hasGhostTool()) {
        this.canvas.rotateGhost();
      } else {
        this.canvas?.rotateSelected();
      }
      return false;
    };

    this.scope.register([], 'r', handleRotate);
    this.scope.register([], 'R', handleRotate);
    this.scope.register(['Shift'], 'r', handleRotate);
    this.scope.register(['Shift'], 'R', handleRotate);

    this.scope.register([], 'Delete', () => {
      if (isTyping()) return;
      this.canvas?.deleteSelected();
      return false;
    });

    this.scope.register([], 'Backspace', () => {
      if (isTyping()) return;
      this.canvas?.deleteSelected();
      return false;
    });

    this.scope.register(['Mod'], 'z', () => {
      if (this.canvas?.isEditingText()) {
        this.canvas.undoInlineText();
        return false;
      }
      if (isTyping()) return;
      this.undo();
      return false;
    });

    this.scope.register(['Mod'], 'y', () => {
      if (this.canvas?.isEditingText()) {
        this.canvas.redoInlineText();
        return false;
      }
      if (isTyping()) return;
      this.redo();
      return false;
    });

    this.scope.register(['Mod', 'Shift'], 'z', () => {
      if (this.canvas?.isEditingText()) {
        this.canvas.redoInlineText();
        return false;
      }
      if (isTyping()) return;
      this.redo();
      return false;
    });

    this.scope.register(['Mod'], 's', (evt: KeyboardEvent) => {
      evt.preventDefault();
      if (this.canvas?.isEditingText()) {
        this.canvas.finishInlineTextEdit();
      }
      this.onSave(this.data);
      this.close();
      return false;
    });

    this.scope.register([], 'Escape', () => {
      if (this.canvas?.isEditingText()) {
        this.canvas.cancelInlineTextEdit();
        return false;
      }
      if (this.canvas?.hasActiveAction()) {
        this.canvas.cancelActiveAction();
        return false;
      }
      this.close();
      return false;
    });
  }
}
