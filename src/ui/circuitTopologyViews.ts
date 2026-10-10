import { CircuitTopology } from '../utils/circuitTopology';

const SVG_NS = 'http://www.w3.org/2000/svg';
let markerSequence = 0;

export function renderCircuitGraph(parentEl: HTMLElement, topology: CircuitTopology): void {
  parentEl.empty();
  parentEl.addClass('circuit-topology-graph');

  if (topology.nodes.length === 0) {
    parentEl.createDiv({ cls: 'circuit-view-empty', text: 'Nessun nodo elettrico da visualizzare.' });
    renderWarnings(parentEl, topology.warnings);
    return;
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 800 400');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Grafo topologico orientato del circuito');
  parentEl.appendChild(svg);

  const markerId = `circuit-arrow-${++markerSequence}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  marker.setAttribute('id', markerId);
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '8');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrow = document.createElementNS(SVG_NS, 'path');
  arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrow.setAttribute('fill', 'var(--text-accent)');
  marker.appendChild(arrow);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const center = { x: 400, y: 200 };
  const positions = new Map<string, { x: number; y: number }>();
  topology.nodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / topology.nodes.length;
    positions.set(node.id, {
      x: center.x + (topology.nodes.length === 1 ? 0 : 275 * Math.cos(angle)),
      y: center.y + (topology.nodes.length === 1 ? 0 : 130 * Math.sin(angle)),
    });
  });

  const branchesByPair = new Map<string, typeof topology.branches>();
  for (const branch of topology.branches) {
    const key = [branch.fromNode, branch.toNode].sort().join('|');
    const pair = branchesByPair.get(key) || [];
    pair.push(branch);
    branchesByPair.set(key, pair);
  }

  for (const pair of branchesByPair.values()) {
    pair.forEach((branch, index) => {
      const from = positions.get(branch.fromNode);
      const to = positions.get(branch.toNode);
      if (!from || !to) return;

      const path = document.createElementNS(SVG_NS, 'path');
      const offset = (index - (pair.length - 1) / 2) * 28;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const controlX = (from.x + to.x) / 2 - (dy / length) * offset;
      const controlY = (from.y + to.y) / 2 + (dx / length) * offset;
      const startLength = Math.max(1, Math.hypot(controlX - from.x, controlY - from.y));
      const endLength = Math.max(1, Math.hypot(to.x - controlX, to.y - controlY));
      const startX = from.x + ((controlX - from.x) / startLength) * 7;
      const startY = from.y + ((controlY - from.y) / startLength) * 7;
      const endX = to.x - ((to.x - controlX) / endLength) * 9;
      const endY = to.y - ((to.y - controlY) / endLength) * 9;
      const d =
        branch.fromNode === branch.toNode
          ? `M ${from.x - 8} ${from.y - 8} C ${from.x - 70} ${from.y - 70}, ${from.x + 70} ${from.y - 70}, ${from.x + 8} ${from.y - 8}`
          : `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
      path.setAttribute('d', d);
      path.setAttribute('class', 'circuit-topology-edge');
      path.setAttribute('marker-end', `url(#${markerId})`);
      svg.appendChild(path);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String((from.x + 2 * controlX + to.x) / 4));
      label.setAttribute('y', String((from.y + 2 * controlY + to.y) / 4 - 8));
      label.setAttribute('class', 'circuit-topology-edge-label');
      label.textContent = branch.label;
      svg.appendChild(label);
    });
  }

  for (const node of topology.nodes) {
    const point = positions.get(node.id);
    if (!point) continue;
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(point.x));
    circle.setAttribute('cy', String(point.y));
    circle.setAttribute('r', '5');
    circle.setAttribute('class', 'circuit-topology-node');
    svg.appendChild(circle);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', String(point.x));
    label.setAttribute('y', String(point.y - 12));
    label.setAttribute('class', 'circuit-topology-node-label');
    label.textContent = node.id;
    svg.appendChild(label);
  }

  renderWarnings(parentEl, topology.warnings);
}

export function renderIncidenceMatrix(parentEl: HTMLElement, topology: CircuitTopology): void {
  parentEl.empty();
  parentEl.addClass('circuit-incidence-matrix');

  if (topology.nodes.length === 0 || topology.branches.length === 0) {
    parentEl.createDiv({
      cls: 'circuit-view-empty',
      text: 'Servono nodi collegati da componenti a due terminali per formare la matrice.',
    });
    renderWarnings(parentEl, topology.warnings);
    return;
  }

  const table = parentEl.createEl('table', { cls: 'circuit-matrix-table' });
  const head = table.createEl('thead').createEl('tr');
  head.createEl('th', { text: 'Nodo / ramo', attr: { scope: 'col' } });
  for (const branch of topology.branches) {
    head.createEl('th', {
      text: branch.label,
      attr: {
        scope: 'col',
        title: `${branch.fromNode} → ${branch.toNode}`,
      },
    });
  }

  const body = table.createEl('tbody');
  for (const node of topology.nodes) {
    const row = body.createEl('tr');
    row.createEl('th', { text: node.id, attr: { scope: 'row' } });
    for (const branch of topology.branches) {
      const value = Number(branch.toNode === node.id) - Number(branch.fromNode === node.id);
      row.createEl('td', { text: String(value) });
    }
  }
  renderWarnings(parentEl, topology.warnings);
}

function renderWarnings(parentEl: HTMLElement, warnings: string[]): void {
  if (warnings.length === 0) return;
  const list = parentEl.createEl('ul', { cls: 'circuit-topology-warnings' });
  for (const warning of warnings) {
    list.createEl('li', { text: warning });
  }
}
