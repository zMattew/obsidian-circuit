import { CircuitData } from '../types';
import { getComponentPins } from './geometry';

export interface CircuitTopologyNode {
  id: string;
  pins: string[];
}

export interface CircuitTopologyBranch {
  id: string;
  number: number;
  label: string;
  fromNode: string;
  toNode: string;
}

interface NodeGroup {
  pins: string[];
  x: number;
  y: number;
}

export interface CircuitTopology {
  nodes: CircuitTopologyNode[];
  branches: CircuitTopologyBranch[];
  warnings: string[];
}

class DisjointSet {
  private parents = new Map<string, string>();

  add(value: string): void {
    if (!this.parents.has(value)) this.parents.set(value, value);
  }

  find(value: string): string {
    const parent = this.parents.get(value);
    if (!parent) return value;
    if (parent === value) return value;
    const root = this.find(parent);
    this.parents.set(value, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parents.set(rootB, rootA);
  }
}

export function buildCircuitTopology(data: CircuitData): CircuitTopology {
  const components = data.components || [];
  const disjointSet = new DisjointSet();
  const componentPins = new Map<string, string[]>();
  const pinPositions = new Map<string, { x: number; y: number }>();
  const validPins = new Set<string>();
  const warnings: string[] = [];

  for (const component of components) {
    const componentPinInfo = getComponentPins(component);
    const pins = componentPinInfo.map((pin) => pin.pinId);
    componentPins.set(component.id, pins);
    for (const pin of componentPinInfo) {
      validPins.add(pin.pinId);
      disjointSet.add(pin.pinId);
      pinPositions.set(pin.pinId, pin.point);
    }
  }

  for (const connection of data.connections || []) {
    const from = resolveEndpoint(connection.from, componentPins, validPins);
    const to = resolveEndpoint(connection.to, componentPins, validPins);
    if (!from || !to) {
      warnings.push(
        `Collegamento non valido (${connection.from} → ${connection.to}): terminale sconosciuto.`
      );
      continue;
    }
    disjointSet.union(from, to);
  }

  const groups = new Map<string, NodeGroup>();
  for (const component of components) {
    for (const pin of componentPins.get(component.id) || []) {
      const root = disjointSet.find(pin);
      const group = groups.get(root) || { pins: [], x: 0, y: 0 };
      const point = pinPositions.get(pin);
      group.pins.push(pin);
      if (point) {
        group.x += point.x;
        group.y += point.y;
      }
      groups.set(root, group);
    }
  }

  const orderedGroups = Array.from(groups.values()).map((group) => ({
    ...group,
    x: group.x / group.pins.length,
    y: group.y / group.pins.length,
  }));
  const referenceNode = orderedGroups.reduce<NodeGroup | null>(
    (lowest, group) => (!lowest || group.y > lowest.y ? group : lowest),
    null
  );
  const nonReferenceNodes = orderedGroups
    .filter((group) => group !== referenceNode)
    .sort((a, b) => a.x - b.x || a.y - b.y || a.pins[0].localeCompare(b.pins[0]));
  const nodeOrder = referenceNode
    ? [...nonReferenceNodes, referenceNode]
    : nonReferenceNodes;
  const nodes: CircuitTopologyNode[] = [];
  const nodeForPin = new Map<string, string>();
  for (const group of nodeOrder) {
    const id = String(nodes.length + 1);
    nodes.push({ id, pins: group.pins });
    for (const pin of group.pins) nodeForPin.set(pin, id);
  }

  const branches: CircuitTopologyBranch[] = [];
  for (const component of components) {
    const pins = componentPins.get(component.id) || [];
    if (pins.length > 2) {
      warnings.push(
        `${component.label || component.id}: elemento a ${pins.length} terminali, non rappresentabile nella matrice di incidenza standard.`
      );
      continue;
    }
    if (pins.length !== 2) continue;

    const fromNode = nodeForPin.get(pins[0]);
    const toNode = nodeForPin.get(pins[1]);
    if (!fromNode || !toNode) continue;
    branches.push({
      id: component.id,
      label: component.label || component.id,
      fromNode,
      toNode,
      number: 0,
    });
  }

  branches.sort((a, b) => {
    const fromA = Number(a.fromNode);
    const toA = Number(a.toNode);
    const fromB = Number(b.fromNode);
    const toB = Number(b.toNode);
    const referenceA = Math.max(fromA, toA) === nodes.length ? 0 : 1;
    const referenceB = Math.max(fromB, toB) === nodes.length ? 0 : 1;
    if (referenceA !== referenceB) return referenceA - referenceB;
    if (referenceA === 0) {
      return Math.min(fromA, toA) - Math.min(fromB, toB);
    }
    const spanA = Math.abs(fromA - toA);
    const spanB = Math.abs(fromB - toB);
    return spanA - spanB || Math.min(fromA, toA) - Math.min(fromB, toB);
  });
  branches.forEach((branch, index) => {
    branch.number = index + 1;
  });

  return { nodes, branches, warnings };
}

function resolveEndpoint(
  endpoint: string,
  componentPins: Map<string, string[]>,
  validPins: Set<string>
): string | null {
  if (validPins.has(endpoint)) return endpoint;

  // Older blocks may refer directly to a one-terminal element instead of its pin.
  const pins = componentPins.get(endpoint);
  return pins?.length === 1 ? pins[0] : null;
}
