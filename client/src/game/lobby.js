import { BufferAttribute, BufferGeometry, Color } from 'three'

import {
  DATA,
  DICE,
  FLOOR,
  GUIDE_BOARD,
  LAMPS,
  PLANTERS,
  PLAZA,
  rotateXZ,
  SHOWROOM,
  SPAWN,
  STORE,
  TABLE,
  TOWER,
} from './layout'
import { SUITS } from './sceneStyle'

/**
 * The square's build: the paving (one mesh) and every box-built prop (lamp posts,
 * string lights, crystal planters, the house of cards' plinth, the giant dice, the
 * Store and the guide board's frame), which join the world's shared scenery
 * instanced mesh: no draw calls of their own.
 */

/** Polar -> [x, z] about (cx, cz), angles measured from +Z (south) towards +X (east). */
const polar = (cx, cz, r, a) => [cx + r * Math.sin(a), cz + r * Math.cos(a)]

/* ---- Paving ---------------------------------------------------------------------- */

const PAVE = {
  /** The harlequin: rose diamonds on cream, like the back of a deck. */
  field: '#fff1de',
  diamond: '#f0687e',
  trim: '#e5a52f',
  towerRing: '#ffcf4a',
  towerFelt: '#1d7f73',
  towerPip: '#ffcf4a',
  /** Card-table felt under the two avenues of tables. */
  avenue: '#1f8576',
  avenueEdge: '#ffcf4a',
  path: '#fff7ea',
  band: SUITS.ruby,
  showroomPad: '#ffe1ec',
  storePad: '#efe2ff',
  boardPad: '#dcf5ec',
  walk: '#fff7ea',
}

/**
 * The square's floor as one flat geometry: a harlequin of rose diamonds on cream with
 * a gold trim round it, a felt disc ringed in gold under the house of cards, deep
 * teal felt avenues (edged in gold) under the two rows of tables, the entrance path
 * and paved pads (and the spokes joining them) under the showroom, the Store and the
 * leaderboards. Colours are vertex colours over one shared tile texture (UVs in
 * world units / `tile`).
 *
 * Pieces that overlap are stacked in layers (the field, the diamonds, the felt,
 * then paths), each FLOOR.plazaStep higher, so overlapping tiles never flicker
 * against each other.
 */
/**
 * Tables that share an x line form an avenue (one long felt strip); a table on its
 * own (the centre-stage table behind the house of cards) gets its own felt pad.
 */
const AVENUE_XS = [...new Set(DATA.tables.map((t) => t.x))].filter(
  (x) => DATA.tables.filter((t) => t.x === x).length > 1,
)
const SOLO_TABLES = DATA.tables.filter((t) => !AVENUE_XS.includes(t.x))
/** Felt round a table: across its width, and along its seats (chairs included). */
const FELT_W = TABLE.width + 2.2
const FELT_D = TABLE.depth + TABLE.seatZ * 2 + 2.2

function avenueSpan(x) {
  const zs = DATA.tables.filter((t) => t.x === x).map((t) => t.z)
  const top = Math.min(...zs) - 2.2
  const bottom = Math.max(...zs) + 2.2
  return { z: (top + bottom) / 2, len: bottom - top }
}

export function createPlazaGeometry(tile) {
  const positions = []
  const colors = []
  const color = new Color()
  let y = 0
  const layer = (n) => {
    y = n * FLOOR.plazaStep
  }

  const tri = (a, b, c) => {
    // Every triangle faces up (+Y), whatever order the corners came in.
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
    const pts = cross >= 0 ? [a, b, c] : [a, c, b]
    for (const [x, z] of pts) {
      positions.push(x, y, z)
      colors.push(color.r, color.g, color.b)
    }
  }
  const quad = (a, b, c, d) => {
    tri(a, b, c)
    tri(a, c, d)
  }
  /** A ring segment about (cx, cz) from angle a0 to a1 (radians), in `segments` steps. */
  const arc = (cx, cz, r0, r1, a0, a1, segments, hex) => {
    color.set(hex)
    for (let i = 0; i < segments; i += 1) {
      const t0 = a0 + ((a1 - a0) * i) / segments
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segments
      if (r0 > 0) quad(polar(cx, cz, r0, t0), polar(cx, cz, r1, t0), polar(cx, cz, r1, t1), polar(cx, cz, r0, t1))
      else tri([cx, cz], polar(cx, cz, r1, t0), polar(cx, cz, r1, t1))
    }
  }
  /** A rhombus (a card-suit diamond) with half-diagonals `a` (X) and `b` (Z). */
  const diamond = (x, z, a, b, hex) => {
    color.set(hex)
    quad([x, z - b], [x + a, z], [x, z + b], [x - a, z])
  }
  const rect = (x, z, w, d, hex, ry = 0) => {
    color.set(hex)
    const corner = (sx, sz) => {
      const [dx, dz] = rotateXZ((sx * w) / 2, (sz * d) / 2, ry)
      return [x + dx, z + dz]
    }
    quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1))
  }

  const { x0, x1, z0, z1 } = PLAZA
  // Layer 0: the cream field, its gold trim, and the pads outside it: the showroom's
  // half-disc (east), the Store (west) and the leaderboards' strip (north).
  layer(0)
  rect((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, PAVE.field)
  const trim = 0.6
  rect((x0 + x1) / 2, z0 - trim / 2, x1 - x0 + trim * 2, trim, PAVE.trim)
  rect((x0 + x1) / 2, z1 + trim / 2, x1 - x0 + trim * 2, trim, PAVE.trim)
  rect(x0 - trim / 2, (z0 + z1) / 2, trim, z1 - z0, PAVE.trim)
  rect(x1 + trim / 2, (z0 + z1) / 2, trim, z1 - z0, PAVE.trim)
  arc(SHOWROOM.x, SHOWROOM.z, 0, SHOWROOM.radius + 2.2, 0, Math.PI, 30, PAVE.showroomPad)
  rect(STORE.x + 0.5, STORE.z, 7.4, 10.4, PAVE.storePad)
  // Narrow enough that its corners stay on the round island.
  rect(0, -22.5, 34, 3.8, PAVE.boardPad)
  rect(GUIDE_BOARD.x, GUIDE_BOARD.z, 6.6, 2.6, PAVE.walk, GUIDE_BOARD.ry)
  rect(DICE.x, DICE.z, 3.8, 3.8, PAVE.walk)

  // Layer 1: the harlequin. Rose diamonds sit corner to corner; the cream between
  // them makes the other half of the pattern. 8 across, 9 down, all inside the field.
  layer(1)
  const cols = 8
  const rows = 9
  const ha = (x1 - x0) / (cols * 2)
  const hb = (z1 - z0) / (rows * 2)
  for (let c = 0; c < cols; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      diamond(x0 + ha * (2 * c + 1), z0 + hb * (2 * r + 1), ha * 0.94, hb * 0.94, PAVE.diamond)
    }
  }

  // Layer 2: the felt disc and gold ring under the house of cards, four gold pips
  // round it, the two avenues of tables in teal felt with gold edges, and the
  // centre-stage table's own felt pad.
  layer(2)
  const ring = 4.4
  arc(TOWER.x, TOWER.z, 0, ring, 0, Math.PI * 2, 40, PAVE.towerFelt)
  arc(TOWER.x, TOWER.z, ring, ring + 0.55, 0, Math.PI * 2, 40, PAVE.towerRing)
  for (let k = 0; k < 4; k += 1) {
    const [px, pz] = polar(TOWER.x, TOWER.z, ring + 1.3, Math.PI / 4 + (k * Math.PI) / 2)
    diamond(px, pz, 0.42, 0.62, PAVE.towerPip)
  }
  for (const x of AVENUE_XS) {
    const { z, len } = avenueSpan(x)
    rect(x, z, FELT_D + 0.5, len + 0.5, PAVE.avenueEdge)
  }
  for (const t of SOLO_TABLES) rect(t.x, t.z, FELT_W + 0.5, FELT_D + 0.5, PAVE.avenueEdge, t.ry)

  // Layer 3: the felt itself (inside its gold edge), the entrance path from the spawn
  // point with ruby edges beside it (not over it), and the spokes joining the pads
  // to the square.
  layer(3)
  for (const x of AVENUE_XS) {
    const { z, len } = avenueSpan(x)
    rect(x, z, FELT_D, len, PAVE.avenue)
  }
  for (const t of SOLO_TABLES) rect(t.x, t.z, FELT_W, FELT_D, PAVE.avenue, t.ry)
  const pathStart = z1 + trim - 0.2
  const pathEnd = SPAWN[2] + 3
  const pathMid = (pathStart + pathEnd) / 2
  const pathLen = pathEnd - pathStart
  rect(0, pathMid, 4.8, pathLen, PAVE.path)
  rect(-2.6, pathMid, 0.4, pathLen, PAVE.band)
  rect(2.6, pathMid, 0.4, pathLen, PAVE.band)
  rect((x1 + SHOWROOM.x) / 2, 0, SHOWROOM.x - x1 + 1, 3.4, PAVE.walk)
  rect((x0 + STORE.x + 3.2) / 2, 0, x0 - STORE.x - 3.2 + 1, 3.4, PAVE.walk)
  rect(0, (z0 - 20.5) / 2, 3.4, z0 - -20.5 + 1, PAVE.walk)

  const position = new Float32Array(positions)
  const uv = new Float32Array((position.length / 3) * 2)
  const normal = new Float32Array(position.length)
  for (let i = 0; i < position.length / 3; i += 1) {
    uv[i * 2] = position[i * 3] / tile
    uv[i * 2 + 1] = position[i * 3 + 2] / tile
    normal[i * 3 + 1] = 1
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  geometry.computeBoundingSphere()
  return geometry
}

/* ---- Props ----------------------------------------------------------------------- */

const LAMP_METAL = SUITS.navy
const LAMP_GLOW = '#fff1c4'
const STRING_LIGHTS = ['#ff5c7a', '#ffd23d', '#3ff0d2', '#b77bff', '#ffffff']
const LAMP_TOP = 3.98
const ROPE_Y = 3.62
const SAG = 0.5
const GOLD = SUITS.gold
const BRASS = '#f2b53a'
const CREAM = SUITS.cream

/** Strings of little coloured bulbs hung between neighbouring lamp posts, sagging a little. */
function stringLights() {
  const rope = []
  const bulbs = []
  for (let k = 0; k + 1 < LAMPS.length; k += 1) {
    const [ax, az] = LAMPS[k]
    const [bx, bz] = LAMPS[k + 1]
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    const ry = Math.atan2(-dz, dx)
    const at = (s) => [ax + dx * s, ROPE_Y - SAG * 4 * s * (1 - s), az + dz * s]
    const ropeSegments = 8
    for (let i = 0; i < ropeSegments; i += 1) {
      const [x, y, z] = at((i + 0.5) / ropeSegments)
      rope.push({ p: [x, y, z], s: [len / ropeSegments + 0.05, 0.03, 0.03], c: '#2c2840', ry })
    }
    const count = Math.max(6, Math.round(len / 1.1))
    for (let i = 0; i < count; i += 1) {
      const [x, y, z] = at((i + 0.5) / count)
      bulbs.push({ p: [x, y - 0.1, z], s: [0.13, 0.17, 0.13], c: STRING_LIGHTS[(i + k) % STRING_LIGHTS.length], ry })
    }
  }
  return { rope, bulbs }
}
const STRINGS = stringLights()

/** The glowing parts, drawn unlit in their own mesh (see World): lamp globes and string lights. */
export const LAMP_BULBS = [
  ...LAMPS.map(([x, z]) => ({ p: [x, LAMP_TOP, z], s: [0.34, 0.42, 0.34], c: LAMP_GLOW })),
  ...STRINGS.bulbs,
]

/** Lamp posts: a navy post on a cream-and-gold foot, a lantern frame and a pointed cap. */
function lampBoxes() {
  const boxes = []
  for (const [x, z] of LAMPS) {
    boxes.push(
      { p: [x, 0.18, z], s: [0.6, 0.36, 0.6], c: CREAM },
      { p: [x, 0.42, z], s: [0.36, 0.14, 0.36], c: BRASS },
      { p: [x, 2.0, z], s: [0.14, 3.3, 0.14], c: LAMP_METAL },
      { p: [x, LAMP_TOP - 0.27, z], s: [0.48, 0.07, 0.48], c: BRASS },
      { p: [x, LAMP_TOP + 0.27, z], s: [0.56, 0.08, 0.56], c: BRASS },
      { p: [x, LAMP_TOP + 0.4, z], s: [0.3, 0.18, 0.3], c: LAMP_METAL, ry: Math.PI / 4 },
      { p: [x, LAMP_TOP + 0.56, z], s: [0.12, 0.14, 0.12], c: SUITS.ruby, ry: Math.PI / 4 },
    )
    // Four thin posts framing the lantern.
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) boxes.push({ p: [x + cx * 0.2, LAMP_TOP, z + cz * 0.2], s: [0.05, 0.5, 0.05], c: LAMP_METAL })
    }
  }
  return boxes
}

/** Cream stone planters by the entrance, rimmed in gold; their crystals are drawn by Island. */
function planterBoxes() {
  const boxes = []
  for (const [x, z, w, d] of PLANTERS) {
    boxes.push({ p: [x, 0.28, z], s: [w, 0.56, d], c: CREAM })
    boxes.push({ p: [x, 0.6, z], s: [w + 0.12, 0.08, d + 0.12], c: BRASS })
    // A dark bed inside the rim, just proud of it, for the crystals to grow from.
    boxes.push({ p: [x, 0.655, z], s: [w - 0.24, 0.03, d - 0.24], c: SUITS.navy })
  }
  return boxes
}

/**
 * The house of cards (see CardTower): giant square cards `card` wide and `thick`
 * thick, leaning `lean` from upright in pairs (A-frames), with a flat card on each
 * pair, in `tiers` tiers, standing on a plinth whose top is at `base`.
 */
export const HOUSE = { card: 2.2, thick: 0.1, lean: Math.PI / 6, base: 0.62, tiers: 3 }

/** The house of cards' plinth: cream stone steps, a gold rim and a felt top. */
function towerBoxes() {
  const { x, z, w, d } = TOWER
  return [
    { p: [x, 0.2, z], s: [w, 0.4, d], c: CREAM },
    { p: [x, 0.47, z], s: [w - 0.3, 0.14, d - 0.3], c: GOLD },
    { p: [x, 0.58, z], s: [w - 0.5, 0.08, d - 0.5], c: '#1d7f73' },
  ]
}

/** Pip layouts on a die face, in units of a third of its width: 1 to 6. */
const PIPS = [
  [],
  [[0, 0]],
  [[-1, -1], [1, 1]],
  [[-1, -1], [0, 0], [1, 1]],
  [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
]

/**
 * One die: a cube `size` wide whose bottom sits at `y`, turned `ry`, with pips on
 * its five visible faces. `faces` gives the number on top, +Z, -Z, +X and -X.
 */
function dieBoxes(cx, y, cz, size, ry, body, pip, faces) {
  const boxes = [{ p: [cx, y + size / 2, cz], s: [size, size, size], c: body, ry }]
  const k = size * 0.27
  const p = size * 0.17
  const out = size / 2 + 0.004
  const at = (lx, ly, lz) => {
    const [dx, dz] = rotateXZ(lx, lz, ry)
    return [cx + dx, y + size / 2 + ly, cz + dz]
  }
  const [top, front, back, east, west] = faces
  for (const [u, v] of PIPS[top]) boxes.push({ p: at(u * k, out, v * k), s: [p, 0.03, p], c: pip, ry })
  for (const [u, v] of PIPS[front]) boxes.push({ p: at(u * k, v * k, out), s: [p, p, 0.03], c: pip, ry })
  for (const [u, v] of PIPS[back]) boxes.push({ p: at(u * k, v * k, -out), s: [p, p, 0.03], c: pip, ry })
  for (const [u, v] of PIPS[east]) boxes.push({ p: at(out, v * k, u * k), s: [0.03, p, p], c: pip, ry })
  for (const [u, v] of PIPS[west]) boxes.push({ p: at(-out, v * k, u * k), s: [0.03, p, p], c: pip, ry })
  return boxes
}

/** A giant pair of dice by the entrance: a ruby die with a cream one stacked on it. */
function diceBoxes() {
  const { x, z } = DICE
  return [
    { p: [x, 0.08, z], s: [2.6, 0.16, 2.6], c: GOLD, ry: Math.PI / 4 },
    ...dieBoxes(x - 0.2, 0.16, z + 0.1, 1.7, 0.35, SUITS.ruby, '#ffffff', [5, 3, 4, 6, 1]),
    ...dieBoxes(x - 0.05, 1.86, z + 0.05, 1.1, -0.45, CREAM, SUITS.ruby, [6, 2, 5, 3, 4]),
  ]
}

/**
 * The Store: a booth on the west side, open towards the square, with a counter, a
 * till and shelves of little chair-coloured blocks. Its striped awning, sign and the
 * chair on its roof are drawn in Shops.jsx.
 */
export const STORE_ROOF_Y = 4.08

function storeBoxes() {
  const { x, z } = STORE
  const at = (lx, ly, lz) => [x + lx, ly, z + lz]
  const PURPLE = '#7b4dff'
  const boxes = [
    { p: at(0.3, 0.125, 0), s: [5, 0.25, 8], c: '#e8d9c0' },
    { p: at(-2, 2.05, 0), s: [0.4, 3.6, 8], c: PURPLE },
    ...[-1, 1].map((side) => ({ p: at(-0.3, 2.05, side * 3.85), s: [3.8, 3.6, 0.3], c: '#6a3dff' })),
    ...[-1, 1].map((side) => ({ p: at(1.95, 2.05, side * 3.85), s: [0.3, 3.6, 0.3], c: GOLD })),
    { p: at(0, STORE_ROOF_Y - 0.13, 0), s: [4.6, 0.26, 8.3], c: '#5b2fd8' },
    { p: at(1.2, 0.8, 0), s: [1.2, 1.1, 6], c: '#ffcf4a' },
    { p: at(1.2, 1.41, 0), s: [1.4, 0.12, 6.2], c: '#ffffff' },
    // The till.
    { p: at(1.2, 1.65, 2), s: [0.55, 0.36, 0.65], c: '#3c3f52' },
    { p: at(1.49, 1.72, 2), s: [0.04, 0.2, 0.44], c: '#5cff5c' },
  ]
  // Two shelves on the back wall, stocked with blocks in the Store's chair colours.
  const stock = DATA.chairs.filter((c) => !c.lobby && c.id !== 'basic').map((c) => c.color)
  for (const [k, y] of [1.35, 2.45].entries()) {
    boxes.push({ p: at(-1.55, y, 0), s: [0.55, 0.08, 7.2], c: '#5b3520' })
    for (let i = 0; i < 9; i += 1) {
      boxes.push({
        p: at(-1.55, y + 0.23, -3.1 + i * 0.775),
        s: [0.38, 0.38, 0.38],
        c: stock[(i + k * 5) % stock.length],
        ry: (i % 3) * 0.3,
      })
    }
  }
  return boxes
}

/** The guide board's posts and frame; its face is drawn by GuideBoard. */
export const GUIDE = { width: 4.8, height: 3.3, y: 2.55 }

function guideFrameBoxes() {
  const { x, z, ry } = GUIDE_BOARD
  const at = (lx, lz) => {
    const [dx, dz] = rotateXZ(lx, lz, ry)
    return [x + dx, z + dz]
  }
  const boxes = []
  for (const side of [-1, 1]) {
    const [px, pz] = at(side * (GUIDE.width / 2 + 0.12), 0)
    boxes.push({ p: [px, GUIDE.y / 2 + 0.9, pz], s: [0.28, GUIDE.y + 1.8, 0.28], c: SUITS.navy, ry })
  }
  const [fx, fz] = at(0, -0.06)
  boxes.push({ p: [fx, GUIDE.y, fz], s: [GUIDE.width + 0.3, GUIDE.height + 0.3, 0.16], c: GOLD, ry })
  const [rx, rz] = at(0, 0)
  boxes.push({ p: [rx, GUIDE.y + GUIDE.height / 2 + 0.28, rz], s: [GUIDE.width + 0.8, 0.22, 0.6], c: BRASS, ry })
  return boxes
}

/** Every prop box of the square, for the scenery mesh. */
export function lobbyBoxes() {
  return [
    ...lampBoxes(),
    ...STRINGS.rope,
    ...planterBoxes(),
    ...towerBoxes(),
    ...diceBoxes(),
    ...storeBoxes(),
    ...guideFrameBoxes(),
  ]
}

/** Rug colours cycled down the felt avenues: soft suit tones that stand out on teal. */
export const RUG_COLORS = ['#ffb3c0', '#ffe08a', '#bfe9ff', '#ddc8ff', '#c2f2d6']

/** A rug under each table and its two chairs, turned with it. */
export const RUG_ITEMS = DATA.tables.map((t, i) => ({
  p: [t.x, FLOOR.rug, t.z],
  s: [TABLE.width + 1.4, 1, TABLE.depth + 2.2 * TABLE.seatZ],
  ry: t.ry,
  c: RUG_COLORS[i % RUG_COLORS.length],
}))
