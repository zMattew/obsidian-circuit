import { CircuitData } from '../types';
import { getComponentPins } from './geometry';

export interface CircuitTopologyNode {
  id: string;
  pins: string[];
}

export interface CircuitTopologyBranch {
  id: string;
  label: string;
  fromNode: string;
  toNode: string;
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
  const validPins = new Set<string>();
  const warnings: string[] = [];

  for (const component of components) {
    const pins = getComponentPins(component).map((pin) => pin.pinId);
    componentPins.set(component.id, pins);
    for (const pin of pins) {
      validPins.add(pin);
      disjointSet.add(pin);
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

  const groups = new Map<string, string[]>();
  for (const component of components) {
    for (const pin of componentPins.get(component.id) || []) {
      const root = disjointSet.find(pin);
      const group = groups.get(root) || [];
      group.push(pin);
      groups.set(root, group);
    }
  }

  const nodes: CircuitTopologyNode[] = [];
  const nodeForPin = new Map<string, string>();
  for (const pins of groups.values()) {
    const id = `N${nodes.length + 1}`;
    nodes.push({ id, pins });
    for (const pin of pins) nodeForPin.set(pin, id);
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
    });
  }

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
