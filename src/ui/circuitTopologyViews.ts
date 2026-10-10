import { CircuitTopology } from '../utils/circuitTopology';

const SVG_NS = 'http://www.w3.org/2000/svg';
let markerSequence = 0;

interface GraphPoint {
  x: number;
  y: number;
}

interface LabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PendingEdgeLabel {
  text: string;
  midpoint: GraphPoint;
}

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
  svg.setAttribute('aria-label', 'Oriented circuit topology graph');
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

  const positions = new Map<string, { x: number; y: number }>();
  const horizontalNodes = topology.nodes.slice(0, -1);
  horizontalNodes.forEach((node, index) => {
    const x =
      horizontalNodes.length === 1
        ? 400
        : 100 + (600 * index) / (horizontalNodes.length - 1);
    positions.set(node.id, { x, y: 120 });
  });
  const horizontalNodeIndexes = new Map(
    horizontalNodes.map((node, index) => [node.id, index])
  );
  const bottomNode = topology.nodes[topology.nodes.length - 1];
  if (bottomNode) positions.set(bottomNode.id, { x: 400, y: 310 });

  const branchesByPair = new Map<string, typeof topology.branches>();
  const edgePoints: GraphPoint[][] = [];
  const pendingLabels: PendingEdgeLabel[] = [];
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
      const fromRowIndex = horizontalNodeIndexes.get(branch.fromNode);
      const toRowIndex = horizontalNodeIndexes.get(branch.toNode);
      const skippedNodes =
        fromRowIndex === undefined || toRowIndex === undefined
          ? 0
          : Math.max(0, Math.abs(fromRowIndex - toRowIndex) - 1);
      const archHeight = skippedNodes > 0 ? 68 + skippedNodes * 20 : 0;
      const controlY =
        (from.y + to.y) / 2 + (dx / length) * offset - archHeight;
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

      if (branch.fromNode === branch.toNode) {
        const loopStart = { x: from.x - 8, y: from.y - 8 };
        const loopEnd = { x: from.x + 8, y: from.y - 8 };
        const control1 = { x: from.x - 70, y: from.y - 70 };
        const control2 = { x: from.x + 70, y: from.y - 70 };
        edgePoints.push(sampleCubicBezier(loopStart, control1, control2, loopEnd));
        pendingLabels.push({
          text: `${branch.number}: ${branch.label}`,
          midpoint: cubicBezierPoint(loopStart, control1, control2, loopEnd, 0.5),
        });
      } else {
        edgePoints.push(
          sampleQuadraticBezier(
            { x: startX, y: startY },
            { x: controlX, y: controlY },
            { x: endX, y: endY }
          )
        );
        pendingLabels.push({
          text: `${branch.number}: ${branch.label}`,
          midpoint: quadraticBezierPoint(
            { x: startX, y: startY },
            { x: controlX, y: controlY },
            { x: endX, y: endY },
            0.5
          ),
        });
      }
    });
  }

  const occupiedLabels: LabelRect[] = [];
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
    label.setAttribute('y', String(point.y - 16));
    label.setAttribute('class', 'circuit-topology-node-label');
    label.textContent = node.id;
    svg.appendChild(label);
    occupiedLabels.push({
      left: point.x - 12,
      right: point.x + 12,
      top: point.y - 24,
      bottom: point.y - 8,
    });
  }

  for (const edgeLabel of pendingLabels) {
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'circuit-topology-edge-label');
    label.textContent = edgeLabel.text;
    const width = Math.max(28, edgeLabel.text.length * 8);
    const height = 18;
    const candidates: GraphPoint[] = [
      { x: edgeLabel.midpoint.x, y: edgeLabel.midpoint.y - height / 2 - 7 },
      { x: edgeLabel.midpoint.x, y: edgeLabel.midpoint.y + height / 2 + 7 },
      { x: edgeLabel.midpoint.x + width / 2 + 7, y: edgeLabel.midpoint.y },
      { x: edgeLabel.midpoint.x - width / 2 - 7, y: edgeLabel.midpoint.y },
    ];
    let bestPosition = candidates[0];
    let bestScore = Infinity;
    for (const candidate of candidates) {
      const rect = {
        left: candidate.x - width / 2 - 3,
        right: candidate.x + width / 2 + 3,
        top: candidate.y - height / 2 - 3,
        bottom: candidate.y + height / 2 + 3,
      };
      const score =
        edgePoints.reduce(
          (total, points) => total + (polylineIntersectsRect(points, rect) ? 1000 : 0),
          0
        ) +
        occupiedLabels.reduce(
          (total, occupied) => total + (rectsOverlap(rect, occupied) ? 1000 : 0),
          0
        ) +
        Array.from(positions.values()).reduce(
          (total, point) =>
            total + (pointInsideRect(point, expandRect(rect, 8)) ? 1000 : 0),
          0
        ) +
        Math.max(0, 8 - rect.left) * 10 +
        Math.max(0, rect.right - 792) * 10 +
        Math.max(0, 8 - rect.top) * 10 +
        Math.max(0, rect.bottom - 392) * 10;
      if (score < bestScore) {
        bestScore = score;
        bestPosition = candidate;
      }
    }

    label.setAttribute('x', String(bestPosition.x));
    label.setAttribute('y', String(bestPosition.y));
    svg.appendChild(label);
    occupiedLabels.push({
      left: bestPosition.x - width / 2 - 3,
      right: bestPosition.x + width / 2 + 3,
      top: bestPosition.y - height / 2 - 3,
      bottom: bestPosition.y + height / 2 + 3,
    });
  }

  renderWarnings(parentEl, topology.warnings);
}

function quadraticBezierPoint(
  start: GraphPoint,
  control: GraphPoint,
  end: GraphPoint,
  t: number
): GraphPoint {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  };
}

function cubicBezierPoint(
  start: GraphPoint,
  control1: GraphPoint,
  control2: GraphPoint,
  end: GraphPoint,
  t: number
): GraphPoint {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * control1.x +
      3 * inverse * t ** 2 * control2.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * control1.y +
      3 * inverse * t ** 2 * control2.y +
      t ** 3 * end.y,
  };
}

function sampleQuadraticBezier(
  start: GraphPoint,
  control: GraphPoint,
  end: GraphPoint
): GraphPoint[] {
  return Array.from({ length: 41 }, (_, index) =>
    quadraticBezierPoint(start, control, end, index / 40)
  );
}

function sampleCubicBezier(
  start: GraphPoint,
  control1: GraphPoint,
  control2: GraphPoint,
  end: GraphPoint
): GraphPoint[] {
  return Array.from({ length: 41 }, (_, index) =>
    cubicBezierPoint(start, control1, control2, end, index / 40)
  );
}

function polylineIntersectsRect(points: GraphPoint[], rect: LabelRect): boolean {
  return points.some((point, index) => {
    if (pointInsideRect(point, rect)) return true;
    const next = points[index + 1];
    return next ? segmentIntersectsRect(point, next, rect) : false;
  });
}

function segmentIntersectsRect(
  start: GraphPoint,
  end: GraphPoint,
  rect: LabelRect
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const p = [-dx, dx, -dy, dy];
  const q = [
    start.x - rect.left,
    rect.right - start.x,
    start.y - rect.top,
    rect.bottom - start.y,
  ];
  let minT = 0;
  let maxT = 1;
  for (let index = 0; index < p.length; index++) {
    if (p[index] === 0) {
      if (q[index] < 0) return false;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) {
      minT = Math.max(minT, ratio);
    } else {
      maxT = Math.min(maxT, ratio);
    }
    if (minT > maxT) return false;
  }
  return true;
}

function pointInsideRect(point: GraphPoint, rect: LabelRect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function expandRect(rect: LabelRect, amount: number): LabelRect {
  return {
    left: rect.left - amount,
    right: rect.right + amount,
    top: rect.top - amount,
    bottom: rect.bottom + amount,
  };
}

function rectsOverlap(a: LabelRect, b: LabelRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
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
      text: `${branch.number}: ${branch.label}`,
      attr: {
        scope: 'col',
        title: `${branch.fromNode} → ${branch.toNode} (${branch.label})`,
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
