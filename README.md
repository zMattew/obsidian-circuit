# Circuit Renderer and Editor for Obsidian

An Obsidian plugin for rendering and editing electrical circuit schematics stored as JSON in `circuit` code blocks.

## Features

- Render circuit diagrams as SVGs in reading view, including components, connections, labels, current annotations, sign conventions, and mesh loops.
- Pan and zoom embedded diagrams. Save the current view to the code block or fit the diagram to its components.
- Switch rendered circuit blocks between the schematic, an oriented topology graph, and the node-branch incidence matrix.
- Open a visual editor from a rendered block, or use the `Insert schematic` command.
- Place, move, rotate, and edit components. Connect pins by clicking a source and target pin or by dragging between pins. Dropping a wire on an existing wire creates a junction.
- Add and edit mesh-loop annotations, connection properties, and text or LaTeX annotations.
- Use context menus on components, connections, loops, and the canvas for editing and other actions.
- Toggle the grid, clear the schematic, and undo or redo edits.
- Copy the JSON for a rendered circuit to the clipboard.

## Components

The editor supports these component types:

| Category | JSON `type` values |
| --- | --- |
| Passive components | `resistor`, `capacitor`, `inductor`, `diode` |
| Independent sources | `dc_source`, `ac_source`, `current_source` |
| Dependent sources | `vcvs`, `ccvs`, `vccs`, `cccs` |
| Switches | `switch_open`, `switch_closed`, `switch_spdt` |
| Connection and ground | `ground`, `junction` |
| Annotations | `text` |
| Mesh-loop annotation | `loop` (stored in `loops`, not `components`) |

## Use in a note

Add a `circuit` code block to a Markdown note:

````markdown
```circuit
{
  "width": 600,
  "height": 400,
  "grid": true,
  "components": [
    {
      "id": "V1",
      "type": "dc_source",
      "label": "V1",
      "value": "12V",
      "x": 100,
      "y": 200,
      "rotation": 90
    },
    {
      "id": "R1",
      "type": "resistor",
      "label": "R1",
      "value": "1k",
      "x": 260,
      "y": 100
    },
    {
      "id": "GND1",
      "type": "ground",
      "label": "GND",
      "x": 260,
      "y": 300
    }
  ],
  "connections": [
    { "from": "V1.p1", "to": "R1.p1" },
    { "from": "V1.p2", "to": "GND1.in" }
  ],
  "loops": [
    {
      "id": "M1",
      "label": "M1",
      "value": "V1 - VR1 = 0",
      "x": 180,
      "y": 200,
      "direction": "cw"
    }
  ]
}
```
````

The top-level `width`, `height`, and `grid` properties control the drawing size and grid. `components`, `connections`, and `loops` are arrays and may be omitted when empty. Component coordinates and loop coordinates are in the diagram coordinate system.

Each component requires a unique `id`, a supported `type`, and `x` and `y` coordinates. Optional component properties include `label`, `value`, `rotation`, `convention` (`none`, `passive`, or `active`), `currentLabel`, `voltageLabel`, `controlFormula`, `text`, and `fontSize`. `controlFormula` is used by dependent sources; `text` and `fontSize` are used by text annotations.

Connections require `from` and `to` pin identifiers. Most components use `.p1` and `.p2`; ground uses `.in`, junction uses `.j`, and the SPDT switch uses `.in`, `.out1`, and `.out2`. Optional connection properties include `color`, `current`, `currentDirection` (`forward` or `backward`), and `waypoints`.

Loops require `id`, `label`, `x`, and `y`. They may also specify `value`, `radius`, and `direction` (`cw` or `ccw`).

The editor assigns default IDs and values when placing components. Double-click a component, connection, or loop to edit its properties. Text annotations open an inline editor. Right-click an item or the canvas to open its context menu.

## Topology views

Use the `Schematic`, `Graph`, and `Matrix` controls on a rendered circuit block to switch views. The graph and matrix are derived from the circuit connections and do not alter the circuit JSON. Nodes are numbered left-to-right, with the lowest node in the diagram numbered last. Branches connected to that lowest node are numbered first, left-to-right; the remaining branches are numbered by increasing distance between node numbers. Each two-terminal component forms one branch oriented from pin `p1` to pin `p2`; wires and junctions combine terminals into nodes. Graph edges and matrix columns show the branch number and component label. The incidence matrix uses `-1` at the branch's starting node, `+1` at its ending node, and `0` elsewhere.

The standard node-branch incidence matrix does not model multi-terminal components such as an SPDT switch. Such components are omitted from the branch list and shown in a visible warning. Invalid connection endpoints are also reported in the topology views.

## Editor controls

| Input | Action |
| --- | --- |
| Click a component tool, then click the canvas | Place a component |
| Press `R` while placing or with a component selected | Rotate by 90 degrees |
| Drag a component | Move it |
| Click a pin, then click another pin; or drag between pins | Create a connection |
| Drag a pin to an existing connection | Insert a junction and branch the connection |
| Double-click an item | Edit its properties; text annotations open inline editing |
| Right-click an item or empty canvas | Open the context menu |
| `Delete` or `Backspace` | Delete the selected component, connection, or loop |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` / `Cmd+Shift+Z` | Redo |
| `Ctrl+S` / `Cmd+S` | Save the schematic to the note and close the editor |
| `Escape` | Cancel the active action, or close the editor |
| Hold `Space` and drag, middle-button drag, or drag the empty canvas | Pan the editor view |
| Mouse wheel | Zoom around the pointer |

The toolbar also provides selection, component tools, rotate, delete, undo, redo, grid, clear, fit-view, and save-view controls. Rotate is available when placing or after selecting a rotatable item; delete is enabled when an item is selected.

## Installation

1. Build the plugin with `npm run build`, or download `main.js`, `manifest.json`, and `styles.css` from the release.
2. Create `.obsidian/plugins/obsidian-circuit/` in your vault if it does not already exist.
3. Copy `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` into that folder.
4. In Obsidian, open Settings, then Community plugins, and enable Circuit.

The build writes the JavaScript bundle and installable plugin files to `dist/`; it does not create `main.js` in the repository root. If the configured local vault plugin directory exists, the production build also copies the generated plugin files there.

## Development

Install dependencies and run the available scripts:

```bash
npm install
npm run lint
npm run dev
npm run build
```

`npm run dev` watches the source and writes a development bundle to `dist/main.js`. `npm run build` runs ESLint and creates a minified production bundle and installable plugin files in `dist/`.

## License

This project is licensed under the [MIT License](LICENSE).
