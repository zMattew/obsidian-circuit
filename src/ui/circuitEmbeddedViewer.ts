import { App, Component, Notice, setIcon } from 'obsidian';
import { CircuitComponent, CircuitData, Point } from '../types';
import { drawComponentSymbol, drawLoopSymbol } from '../utils/drawSymbols';
import { buildPinMap, generateWirePath, getWirePoints } from '../utils/geometry';
import { buildCircuitTopology } from '../utils/circuitTopology';
import type { CircuitTopology } from '../utils/circuitTopology';
import { renderCircuitGraph, renderIncidenceMatrix } from './circuitTopologyViews';

type CircuitView = 'schematic' | 'graph' | 'matrix';

export class CircuitEmbeddedViewer {
  private containerEl: HTMLElement;
  private svgEl: SVGSVGElement;
  private viewportG: SVGGElement;
  private gridPatternEl: SVGPatternElement | null = null;
  private zoomLabelEl: HTMLElement | null = null;
  private controlsEl: HTMLElement | null = null;
  private graphViewEl: HTMLElement | null = null;
  private matrixViewEl: HTMLElement | null = null;
  private viewButtons = new Map<CircuitView, HTMLButtonElement>();
  private topology: CircuitTopology;

  private pan: Point = { x: 0, y: 0 };
  private zoom = 1.0;
  private isPanning = false;
  private panStartClient: Point = { x: 0, y: 0 };
  private panOrigin: Point = { x: 0, y: 0 };

  constructor(
    parentEl: HTMLElement,
    private data: CircuitData,
    private app: App,
    private ownerComponent: Component,
    private onSaveView?: (updatedData: CircuitData) => void
  ) {
    this.topology = buildCircuitTopology(this.data);
    this.containerEl = parentEl.createDiv({ cls: 'circuit-container' });

    // Determine embedded display height:
    // Avoid excessive heights (e.g. 636px from modal) that create giant vertical voids,
    // especially when Obsidian is viewed in portrait mode or narrow split panes.
    const rawHeight = this.data.height && this.data.height >= 200 ? this.data.height : 380;
    const height = Math.min(rawHeight, 460);
    this.containerEl.style.height = `${height}px`;

    // Initialize camera position from saved data (adjusting vertical pan if height was clamped)
    this.initCamera(height);

    this.svgEl = this.containerEl.createSvg('svg', {
      cls: 'circuit-svg',
      attr: {
        width: '100%',
        height: '100%',
      },
    });

    // Render Grid background
    this.renderGrid();

    // Viewport group that receives camera pan and zoom transformations
    this.viewportG = this.svgEl.createSvg('g', {
      attr: {
        class: 'circuit-viewport',
      },
    });

    this.renderContent();
    this.createTopologyViews();
    this.createControls();
    this.bindEvents();
    this.updateTransform();
  }

  getContainerEl(): HTMLElement {
    return this.containerEl;
  }

  private initCamera(currentHeight: number): void {
    if (this.data.panX !== undefined && this.data.panY !== undefined && this.data.zoom !== undefined) {
      this.pan = { x: this.data.panX, y: this.data.panY };
      this.zoom = this.data.zoom;

      // If the saved height differs from the current rendered height (e.g. saved in modal at 636px),
      // adjust panY so that the circuit remains centered vertically
      const savedHeight = this.data.height || currentHeight;
      if (savedHeight !== currentHeight) {
        const deltaY = (currentHeight - savedHeight) / 2;
        this.pan.y = Math.round(this.pan.y + deltaY);
      }
      return;
    }

    if (this.data.viewBox) {
      const parts = this.data.viewBox.trim().split(/\s+/).map(Number);
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        const [minX, minY, , vHeight] = parts;
        const targetH = currentHeight;
        const z = targetH / (vHeight || currentHeight);
        this.zoom = Number(Math.max(0.3, Math.min(3.0, z)).toFixed(2));
        this.pan = {
          x: Math.round(-minX * this.zoom),
          y: Math.round(-minY * this.zoom),
        };
        return;
      }
    }

    this.pan = { x: 0, y: 0 };
    this.zoom = 1.0;
  }

  private renderGrid(): void {
    if (this.data.grid === false) return;
    const defs = this.svgEl.createSvg('defs');
    const patternId = `circuit-grid-${Math.random().toString(36).slice(2, 9)}`;
    this.gridPatternEl = defs.createSvg('pattern', {
      attr: {
        id: patternId,
        width: '20',
        height: '20',
        patternUnits: 'userSpaceOnUse',
      },
    });
    this.gridPatternEl.createSvg('circle', {
      attr: {
        cx: '2',
        cy: '2',
        r: '1',
        fill: 'var(--text-faint)',
        opacity: '0.35',
      },
    });
    this.svgEl.createSvg('rect', {
      attr: {
        width: '100%',
        height: '100%',
        fill: `url(#${patternId})`,
      },
    });
  }

  private renderContent(): void {
    const pinCoords = buildPinMap(this.data.components || []);

    // 1. Components
    if (Array.isArray(this.data.components)) {
      for (const comp of this.data.components) {
        const rot = comp.rotation || 0;
        const g = this.viewportG.createSvg('g', {
          attr: {
            transform: `translate(${comp.x}, ${comp.y}) rotate(${rot})`,
            stroke: 'var(--text-normal)',
            'stroke-width': '2',
            fill: 'none',
          },
        });

        drawComponentSymbol(g, comp, true, {
          app: this.app,
          ownerComponent: this.ownerComponent,
        });
      }
    }

    // 2. Connections with orthogonal routing and current indicators
    if (Array.isArray(this.data.connections)) {
      for (const conn of this.data.connections) {
        const p1 = pinCoords.get(conn.from);
        const p2 = pinCoords.get(conn.to);
        if (!p1 || !p2) continue;

        let fromComp: CircuitComponent | undefined;
        if (this.data.components) {
          fromComp = this.data.components.find((c) => conn.from.startsWith(c.id));
        }

        const d = generateWirePath(p1, p2, fromComp, conn.waypoints);
        this.viewportG.createSvg('path', {
          attr: {
            d,
            stroke: conn.color || 'var(--text-accent)',
            'stroke-width': '2',
            fill: 'none',
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
          },
        });

        for (const p of [p1, p2]) {
          this.viewportG.createSvg('circle', {
            attr: {
              cx: String(p.x),
              cy: String(p.y),
              r: '3',
              fill: 'var(--text-accent)',
            },
          });
        }

        // Current badge
        if (conn.current) {
          const pts = getWirePoints(p1, p2, fromComp, conn.waypoints);
          if (pts.length >= 2) {
            const midSegIdx = Math.floor((pts.length - 1) / 2);
            const a = pts[midSegIdx];
            const b = pts[midSegIdx + 1];
            const isForward = conn.currentDirection !== 'backward';
            const startPt = isForward ? a : b;
            const endPt = isForward ? b : a;

            const midX = Math.round((startPt.x + endPt.x) / 2);
            const midY = Math.round((startPt.y + endPt.y) / 2);
            const angle = Math.atan2(endPt.y - startPt.y, endPt.x - startPt.x);

            const badgeG = this.viewportG.createSvg('g', {
              attr: {
                transform: `translate(${midX}, ${midY})`,
                class: 'circuit-wire-current-badge',
              },
            });
            const rotG = badgeG.createSvg('g', {
              attr: {
                transform: `rotate(${(angle * 180) / Math.PI})`,
              },
            });

            rotG.createSvg('line', {
              attr: {
                x1: '-10',
                y1: '-6',
                x2: '8',
                y2: '-6',
                stroke: 'var(--text-accent)',
                'stroke-width': '1.8',
              },
            });
            rotG.createSvg('polygon', {
              attr: {
                points: '5,-9 11,-6 5,-3',
                fill: 'var(--text-accent)',
                stroke: 'none',
              },
            });

            const textEl = badgeG.createSvg('text', {
              attr: {
                x: '0',
                y: '-11',
                fill: 'var(--text-accent)',
                'font-size': '10',
                'font-weight': 'bold',
                'text-anchor': 'middle',
                stroke: 'none',
                'font-style': 'italic',
              },
            });
            textEl.textContent = conn.current;
          }
        }
      }
    }

    // 3. Mesh loops (Maglie)
    if (Array.isArray(this.data.loops)) {
      for (const loop of this.data.loops) {
        drawLoopSymbol(this.viewportG, loop, false);
      }
    }
  }

  private createTopologyViews(): void {
    const tabs = this.containerEl.createDiv({
      cls: 'circuit-view-tabs',
      attr: { role: 'group', 'aria-label': 'Viste del circuito' },
    });
    const views: Array<[CircuitView, string]> = [
      ['schematic', 'Schematic'],
      ['graph', 'Graph'],
      ['matrix', 'Matrix'],
    ];
    for (const [view, label] of views) {
      const button = tabs.createEl('button', {
        cls: 'circuit-view-tab',
        text: label,
        attr: { type: 'button', 'aria-pressed': String(view === 'schematic') },
      });
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setActiveView(view);
      });
      this.viewButtons.set(view, button);
    }

    this.graphViewEl = this.containerEl.createDiv({
      cls: ['circuit-topology-view', 'is-view-hidden'],
      attr: { hidden: '' },
    });
    renderCircuitGraph(this.graphViewEl, this.topology);

    this.matrixViewEl = this.containerEl.createDiv({
      cls: ['circuit-topology-view', 'is-view-hidden'],
      attr: { hidden: '' },
    });
    renderIncidenceMatrix(this.matrixViewEl, this.topology);
  }

  private setActiveView(view: CircuitView): void {
    const showSchematic = view === 'schematic';
    this.svgEl.toggleClass('is-view-hidden', !showSchematic);
    this.svgEl.hidden = !showSchematic;
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
    if (this.controlsEl) this.controlsEl.hidden = view !== 'schematic';

    for (const [name, button] of this.viewButtons) {
      const active = name === view;
      button.toggleClass('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  private createControls(): void {
    this.controlsEl = this.containerEl.createDiv({ cls: 'circuit-canvas-controls' });

    const zoomOutBtn = this.controlsEl.createEl('button', {
      cls: 'circuit-canvas-ctrl-btn',
      attr: { type: 'button', title: 'Zoom Out (-)' },
    });
    setIcon(zoomOutBtn, 'minus');
    zoomOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = this.svgEl.getBoundingClientRect();
      this.zoomAt(rect.width / 2, rect.height / 2, 0.85);
    });

    this.zoomLabelEl = this.controlsEl.createEl('button', {
      cls: 'circuit-canvas-ctrl-btn circuit-zoom-label',
      text: `${Math.round(this.zoom * 100)}%`,
      attr: { type: 'button', title: 'Ripristina zoom al 100%' },
    });
    this.zoomLabelEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pan = { x: 0, y: 0 };
      this.zoom = 1.0;
      this.updateTransform();
    });

    const zoomInBtn = this.controlsEl.createEl('button', {
      cls: 'circuit-canvas-ctrl-btn',
      attr: { type: 'button', title: 'Zoom In (+)' },
    });
    setIcon(zoomInBtn, 'plus');
    zoomInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = this.svgEl.getBoundingClientRect();
      this.zoomAt(rect.width / 2, rect.height / 2, 1.18);
    });

    const fitBtn = this.controlsEl.createEl('button', {
      cls: 'circuit-canvas-ctrl-btn',
      attr: { type: 'button', title: 'Adatta vista a tutti i componenti' },
    });
    setIcon(fitBtn, 'scan');
    fitBtn.createSpan({ text: 'Adatta' });
    fitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.fitView();
    });

    if (this.onSaveView) {
      const saveViewBtn = this.controlsEl.createEl('button', {
        cls: 'circuit-canvas-ctrl-btn circuit-save-view-btn',
        attr: { type: 'button', title: 'Salva inquadratura corrente nella nota' },
      });
      setIcon(saveViewBtn, 'camera');
      saveViewBtn.createSpan({ text: 'Salva vista' });
      saveViewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.saveCurrentView();
      });
    }
  }

  private saveCurrentView(): void {
    if (!this.onSaveView) return;
    const rect = this.svgEl.getBoundingClientRect();
    const cWidth = rect.width > 50 ? Math.round(rect.width) : (this.data.width || 600);
    const cHeight = rect.height > 50 ? Math.round(rect.height) : (this.data.height || 380);

    const minX = Math.round((0 - this.pan.x) / this.zoom);
    const minY = Math.round((0 - this.pan.y) / this.zoom);
    const vWidth = Math.round(cWidth / this.zoom);
    const vHeight = Math.round(cHeight / this.zoom);

    this.data.panX = Math.round(this.pan.x);
    this.data.panY = Math.round(this.pan.y);
    this.data.zoom = Number(this.zoom.toFixed(2));
    this.data.width = cWidth;
    this.data.height = cHeight;
    this.data.viewBox = `${minX} ${minY} ${vWidth} ${vHeight}`;

    this.onSaveView(this.data);
    new Notice('Vista del circuito salvata nella nota!');
  }

  private zoomAt(localX: number, localY: number, factor: number): void {
    const worldX = (localX - this.pan.x) / this.zoom;
    const worldY = (localY - this.pan.y) / this.zoom;
    const newZoom = Math.max(0.25, Math.min(3.5, this.zoom * factor));
    this.pan.x = Math.round(localX - worldX * newZoom);
    this.pan.y = Math.round(localY - worldY * newZoom);
    this.zoom = Number(newZoom.toFixed(2));
    this.updateTransform();
  }

  private fitView(): void {
    const comps = this.data.components || [];
    if (comps.length === 0) {
      this.pan = { x: 0, y: 0 };
      this.zoom = 1.0;
      this.updateTransform();
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of comps) {
      minX = Math.min(minX, c.x - 45);
      minY = Math.min(minY, c.y - 45);
      maxX = Math.max(maxX, c.x + 45);
      maxY = Math.max(maxY, c.y + 45);
    }
    const rect = this.svgEl.getBoundingClientRect();
    const w = rect.width > 50 ? rect.width : (this.data.width || 600);
    const h = rect.height > 50 ? rect.height : (this.data.height || 380);
    const padding = 40;
    const bboxW = Math.max(100, maxX - minX + padding * 2);
    const bboxH = Math.max(100, maxY - minY + padding * 2);
    const fitZoom = Math.min(1.8, Math.max(0.3, Math.min(w / bboxW, h / bboxH)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    this.zoom = Number(fitZoom.toFixed(2));
    this.pan = {
      x: Math.round(w / 2 - centerX * this.zoom),
      y: Math.round(h / 2 - centerY * this.zoom),
    };
    this.updateTransform();
  }

  private bindEvents(): void {
    this.svgEl.addEventListener('pointerdown', (e: PointerEvent) => {
      // Left click or middle click
      if (e.button === 0 || e.button === 1) {
        this.isPanning = true;
        this.panStartClient = { x: e.clientX, y: e.clientY };
        this.panOrigin = { ...this.pan };
        this.svgEl.addClass('is-panning');
        try {
          this.svgEl.setPointerCapture(e.pointerId);
        } catch {
          // safe fallback
        }
      }
    });

    this.svgEl.addEventListener('pointermove', (e: PointerEvent) => {
      if (this.isPanning) {
        const dx = e.clientX - this.panStartClient.x;
        const dy = e.clientY - this.panStartClient.y;
        this.pan.x = this.panOrigin.x + dx;
        this.pan.y = this.panOrigin.y + dy;
        this.updateTransform();
      }
    });

    const endPan = (e: PointerEvent) => {
      if (this.isPanning) {
        this.isPanning = false;
        this.svgEl.removeClass('is-panning');
        try {
          if (this.svgEl.hasPointerCapture(e.pointerId)) {
            this.svgEl.releasePointerCapture(e.pointerId);
          }
        } catch {
          // safe fallback
        }
      }
    };

    this.svgEl.addEventListener('pointerup', endPan);
    this.svgEl.addEventListener('pointercancel', endPan);

    this.svgEl.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          const rect = this.svgEl.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const factor = e.deltaY < 0 ? 1.15 : 0.87;
          this.zoomAt(mx, my, factor);
        }
      },
      { passive: false }
    );

    this.svgEl.addEventListener('dblclick', (e: MouseEvent) => {
      e.stopPropagation();
      this.fitView();
    });
  }

  private updateTransform(): void {
    this.viewportG.setAttribute(
      'transform',
      `translate(${this.pan.x}, ${this.pan.y}) scale(${this.zoom})`
    );

    if (this.gridPatternEl) {
      const step = 20 * this.zoom;
      this.gridPatternEl.setAttribute('x', String(this.pan.x % step));
      this.gridPatternEl.setAttribute('y', String(this.pan.y % step));
      this.gridPatternEl.setAttribute('width', String(step));
      this.gridPatternEl.setAttribute('height', String(step));
      const circle = this.gridPatternEl.querySelector('circle');
      if (circle) {
        circle.setAttribute('cx', String(2 * this.zoom));
        circle.setAttribute('cy', String(2 * this.zoom));
        circle.setAttribute('r', String(Math.max(0.8, 1.1 * this.zoom)));
      }
    }

    if (this.zoomLabelEl) {
      this.zoomLabelEl.setText(`${Math.round(this.zoom * 100)}%`);
    }
  }
}
