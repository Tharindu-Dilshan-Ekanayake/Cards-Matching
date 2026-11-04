import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import { Object3D } from 'three'

import { createCardGeometry, createCardMaterial, GOLDEN_CELL, markCardsDirty, setCard } from './cardArt'
import { GIANT_CARD_ITEMS } from './islandGeometry'
import { TOWER } from './layout'
import { HOUSE } from './lobby'
import { useSettings } from './quality'
import { useDisposable } from './useDisposable'

/**
 * Every giant memory card in the world, in one instanced draw call:
 *
 * - the square's centrepiece, a house of cards: HOUSE.tiers tiers of A-frames (two
 *   cards leaning together, animal faces out) each capped with a flat card, under a
 *   big golden ⭐ card spinning on top;
 * - the giant cards turning slowly on their plinths round the island's edge;
 * - on presets with particles, a few cards tumbling through the sky round the island.
 *
 * Cards share cardArt's atlas and shader (with their own material instance). Only the
 * moving cards' matrices are rewritten each frame, with module-level scratch objects.
 */

const S = HOUSE.card
const T = HOUSE.thick
const LEAN = HOUSE.lean
/** Height of an A-frame, and how far each leaning card's middle sits from its frame's centre. */
const FRAME_H = S * Math.cos(LEAN)
const FRAME_OFF = (S * Math.sin(LEAN)) / 2
/** A leaning card's yaw-less tilt: its face (underside) turned out and up. */
const TILT = -(Math.PI / 2 + LEAN)
/** Upright: face towards +Z, reading the right way up. */
const UPRIGHT = -Math.PI / 2

/** Pastel tints behind the faces, and the golden card's. */
const TINTS = ['#ffffff', '#c9f7dc', '#cfeaff', '#ffd9e2', '#fff2b8', '#e6dbff']
const GOLD_TINT = '#ffd23d'

/** Static cards: { p, rx, ry, s: [w, t, d], cell, tint }. */
function houseCards() {
  const cards = []
  let n = 0
  const face = () => {
    n += 1
    return { cell: (n * 5) % 13, tint: TINTS[n % TINTS.length] }
  }
  for (let k = 0; k < HOUSE.tiers; k += 1) {
    const frames = HOUSE.tiers - k
    const y = HOUSE.base + k * (FRAME_H + T)
    for (let i = 0; i < frames; i += 1) {
      const x = TOWER.x + (i - (frames - 1) / 2) * S
      // The front card leans back, the back card forward; each shows a face outward,
      // shifted half its thickness outward so their inner faces meet at the top.
      for (const side of [1, -1]) {
        const ny = Math.sin(LEAN) * (T / 2)
        const nz = Math.cos(LEAN) * (T / 2) * side
        cards.push({
          p: [x, y + FRAME_H / 2 + ny, TOWER.z + side * FRAME_OFF + nz],
          rx: TILT,
          ry: side > 0 ? 0 : Math.PI,
          s: [S, T, S],
          ...face(),
        })
      }
      // The floor laid across the frame, back up.
      cards.push({ p: [x, y + FRAME_H + T / 2, TOWER.z], rx: 0, ry: 0, s: [S, T, S], ...face() })
    }
  }
  return cards
}

const HOUSE_CARDS = houseCards()
const HOUSE_TOP = HOUSE.base + HOUSE.tiers * (FRAME_H + T)

/** The golden card spinning over the top. */
const STAR = { size: S * 1.15, y: HOUSE_TOP + S * 0.95 }

/** Cards drifting round the island (presets with particles): orbit radius, height, speed, phase. */
const FLOATERS = [
  [48, 14, 0.035, 0], [62, 22, -0.025, 1.1], [55, 6, 0.03, 2.3], [70, 18, -0.02, 3.2],
  [52, 26, 0.028, 4.1], [66, 9, -0.032, 5.0], [58, 30, 0.022, 5.7], [74, 12, 0.026, 0.6],
]
const FLOAT_SIZE = 3.2

const STATIC = HOUSE_CARDS.length
const STAR_INDEX = STATIC
const EDGE_START = STAR_INDEX + 1
const FLOAT_START = EDGE_START + GIANT_CARD_ITEMS.length
const TOTAL = FLOAT_START + FLOATERS.length

const _obj = new Object3D()
_obj.rotation.order = 'YXZ'

function place(mesh, i, x, y, z, rx, ry, sx, sy, sz) {
  _obj.position.set(x, y, z)
  _obj.rotation.set(rx, ry, 0)
  _obj.scale.set(sx, sy, sz)
  _obj.updateMatrix()
  mesh.setMatrixAt(i, _obj.matrix)
}

export function CardTower() {
  const { shadows, particles } = useSettings()
  const ref = useRef(null)

  const res = useDisposable(
    () => ({
      geometry: createCardGeometry({ w: 1, d: 1, t: 1, r: 0.12, count: TOTAL }),
      material: createCardMaterial(),
    }),
    [],
  )

  useLayoutEffect(() => {
    const mesh = ref.current
    const g = res.geometry
    HOUSE_CARDS.forEach((c, i) => {
      place(mesh, i, c.p[0], c.p[1], c.p[2], c.rx, c.ry, c.s[0], c.s[1], c.s[2])
      setCard(g, i, c.cell, c.tint)
    })
    setCard(g, STAR_INDEX, GOLDEN_CELL, GOLD_TINT)
    GIANT_CARD_ITEMS.forEach((_c, k) => setCard(g, EDGE_START + k, (k * 4 + 2) % 13, TINTS[(k + 2) % TINTS.length]))
    FLOATERS.forEach((_f, k) =>
      setCard(g, FLOAT_START + k, k % 3 === 0 ? GOLDEN_CELL : (k * 3 + 1) % 13, k % 3 === 0 ? GOLD_TINT : TINTS[k % TINTS.length]),
    )
    markCardsDirty(g)
    mesh.instanceMatrix.needsUpdate = true
  }, [res])

  // The drifting cards only exist on presets with particles.
  useLayoutEffect(() => {
    if (ref.current) ref.current.count = particles ? TOTAL : FLOAT_START
  }, [particles])

  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.elapsedTime

    const bob = Math.sin(t * 1.3) * 0.18
    place(mesh, STAR_INDEX, TOWER.x, STAR.y + bob, TOWER.z, UPRIGHT, t * 0.9, STAR.size, T * 1.4, STAR.size)

    for (let k = 0; k < GIANT_CARD_ITEMS.length; k += 1) {
      const c = GIANT_CARD_ITEMS[k]
      const spin = t * 0.3 * (k % 2 ? -1 : 1) + k * 1.3
      place(mesh, EDGE_START + k, c.x, c.y + Math.sin(t * 0.9 + k) * 0.12, c.z, UPRIGHT, spin, c.w, T * 1.6, c.w)
    }

    if (mesh.count === TOTAL) {
      for (let k = 0; k < FLOATERS.length; k += 1) {
        const [r, h, speed, phase] = FLOATERS[k]
        const a = phase + t * speed
        place(
          mesh,
          FLOAT_START + k,
          Math.sin(a) * r,
          h + Math.sin(t * 0.4 + phase) * 2,
          Math.cos(a) * r,
          t * 0.25 + phase,
          t * 0.35 + phase * 2,
          FLOAT_SIZE,
          T * 1.4,
          FLOAT_SIZE,
        )
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={ref}
      args={[res.geometry, res.material, TOTAL]}
      castShadow={shadows}
      receiveShadow
      // Some cards move every frame; a stale bounding sphere could cull them.
      frustumCulled={false}
    />
  )
}

export default CardTower
