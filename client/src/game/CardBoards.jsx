import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { Color, MeshBasicMaterial, Object3D, PlaneGeometry, Vector3 } from 'three'

import { useGame } from '../net/gameStore'
import { boardFx } from '../net/liveState'
import { canFlip, flipCard } from './cardActions'
import {
  BLANK_CELL,
  cellOfCode,
  createCardGeometry,
  createCardMaterial,
  GOLDEN_CELL,
  markCardsDirty,
  setCard,
} from './cardArt'
import { BOARD, CARD, CARD_Y, CARDS, CARDS_PER_TABLE, cardLocal, DATA, rotateXZ, seatSide, TABLE } from './layout'
import { useDisposable } from './useDisposable'

/**
 * The memory cards on every table: 200 cards (10 tables x 20) in ONE instanced draw
 * call, plus one for the turn lamps at each player's edge of the mat.
 *
 * Each frame works out every card's pose from the synced board (face up or down,
 * who matched it), this player's own unconfirmed flips and private peeks, and the
 * one-off board effects (deal, shuffle, a pair's pop, a miss's shake). A card's
 * matrix, face and tint are only rewritten when they change: nothing is allocated
 * and React never re-renders for it.
 *
 * Picking is analytic (a ray against the table top, then the grid): no triangle
 * tests, and only at the local player's own table.
 */

const TABLES = DATA.tables
const N = CARDS_PER_TABLE
const TOTAL = TABLES.length * N

/** Seconds for a card to turn over. */
const FLIP_S = 0.26
const FLIP_SPEED = Math.PI / FLIP_S
const LIFT = 0.16
const HOVER_LIFT = 0.045
/** Dealing: one card every DEAL_STEP_MS, each landing in DEAL_MS. */
const DEAL_STEP_MS = 55
const DEAL_MS = 380
const SHUFFLE_MS = 950
const POP_MS = 650
const SHAKE_MS = 450

const COLORS = {
  up: new Color('#ffffff'),
  mine: new Color('#5ee08c'),
  theirs: new Color('#7cc4ff'),
  seat: [new Color('#5ee08c'), new Color('#ff9ec7')],
  miss: new Color('#ff6b6b'),
  golden: new Color('#ffd23d'),
  peek: new Color('#e4ccff'),
  hint: new Color('#fff1a0'),
  rest: new Color('#ece6ff'),
}
const LAMP = {
  off: new Color('#3b2f5c'),
  mine: new Color('#5cff8a'),
  theirs: new Color('#ff9ec7'),
  frozen: new Color('#9fe4ff'),
}

const _obj = new Object3D()
_obj.rotation.order = 'YXZ'
const _point = new Vector3()

/* ---- Per-card animation state, struct-of-arrays -------------------------------------- */

/** Flip angle (0 back up .. PI face up). */
const angle = new Float32Array(TOTAL)
/** Last written pose (x, y, z, yaw, flip, scale) per card: skip unchanged cards. */
const written = new Float32Array(TOTAL * 6).fill(NaN)
/** Face cell and tint last written per card (tint as an index into TINT_LIST). */
const shownCell = new Int16Array(TOTAL).fill(-1)
const shownTint = new Int8Array(TOTAL).fill(-1)
const TINT_LIST = [
  COLORS.up, COLORS.mine, COLORS.theirs, COLORS.seat[0], COLORS.seat[1], COLORS.miss,
  COLORS.golden, COLORS.peek, COLORS.hint, COLORS.rest,
]
const TI = Object.fromEntries(['up', 'mine', 'theirs', 'seat0', 'seat1', 'miss', 'golden', 'peek', 'hint', 'rest'].map((k, i) => [k, i]))

/** Per table: the phase seen last frame, when its current deal started (epoch ms). */
const seenPhase = TABLES.map(() => '')
const dealStart = new Float64Array(TABLES.length)
/** Per lamp (table x 2): colour index written. */
const lampShown = new Int8Array(TABLES.length * 2).fill(-1)

/** Grid pitch and each card's resting spot in its table's frame. */
const LOCAL = Array.from({ length: N }, (_, i) => cardLocal(i))
const PITCH_X = CARD.w + CARD.gap
const PITCH_Z = CARD.d + CARD.gap

/** Card under the pointer at the local player's table (global index), or -1. */
const pointer = { hover: -1 }

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const easeOut = (t) => 1 - (1 - t) * (1 - t)

/** Is card `i` in the small `list` (an array of card indices, or of { i })? */
function listed(list, i) {
  if (!list) return false
  for (let k = 0; k < list.length; k += 1) {
    const v = list[k]
    if (v === i || v?.i === i) return true
  }
  return false
}

/**
 * Analytic picking for the cards mesh: the ray against the plane of the cards on the
 * local player's table, then which grid cell it lands in.
 */
function pickCards(raycaster, intersects) {
  const { match } = useGame.getState()
  if (!match) return
  const ti = TABLES.findIndex((t) => t.id === match.table)
  if (ti < 0) return
  const t = TABLES[ti]
  const ray = raycaster.ray
  const y = CARD_Y + CARD.t / 2
  if (Math.abs(ray.direction.y) < 1e-4) return
  const d = (y - ray.origin.y) / ray.direction.y
  if (d <= 0) return
  _point.copy(ray.direction).multiplyScalar(d).add(ray.origin)
  const [lx, lz] = rotateXZ(_point.x - t.x, _point.z - t.z, -t.ry)
  const col = Math.round(lx / PITCH_X + (CARDS.cols - 1) / 2)
  const row = Math.round(lz / PITCH_Z + (CARDS.rows - 1) / 2)
  if (col < 0 || col >= CARDS.cols || row < 0 || row >= CARDS.rows) return
  const i = row * CARDS.cols + col
  // Forgiving: anywhere in the card's cell, gap included.
  if (Math.abs(lx - LOCAL[i][0]) > PITCH_X / 2 || Math.abs(lz - LOCAL[i][1]) > PITCH_Z / 2) return
  intersects.push({ distance: d, point: _point.clone(), object: this, instanceId: ti * N + i })
}

export function CardBoards() {
  const cardsRef = useRef(null)
  const lampsRef = useRef(null)
  const gl = useThree((s) => s.gl)

  const res = useDisposable(
    () => ({
      card: createCardGeometry({ w: CARD.w, d: CARD.d, t: CARD.t, r: CARD.r, count: TOTAL }),
      cardMaterial: createCardMaterial(),
      lamp: new PlaneGeometry(BOARD.w * 0.62, 0.07).rotateX(-Math.PI / 2),
      lampMaterial: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    }),
    [],
  )

  useLayoutEffect(() => {
    const mesh = cardsRef.current
    mesh.raycast = pickCards
    for (let g = 0; g < TOTAL; g += 1) setCard(res.card, g, BLANK_CELL, COLORS.up)
    markCardsDirty(res.card)
    written.fill(NaN)
    shownCell.fill(-1)
    shownTint.fill(-1)
    // Lamps: a glowing strip along each player's edge of the mat.
    const lamps = lampsRef.current
    TABLES.forEach((t, ti) => {
      for (let s = 0; s < 2; s += 1) {
        const [dx, dz] = rotateXZ(0, seatSide(s) * (BOARD.d / 2 - 0.06), t.ry)
        _obj.position.set(t.x + dx, TABLE.height + 0.006, t.z + dz)
        _obj.rotation.set(0, t.ry, 0)
        _obj.scale.set(1, 1, 1)
        _obj.updateMatrix()
        lamps.setMatrixAt(ti * 2 + s, _obj.matrix)
        lamps.setColorAt(ti * 2 + s, LAMP.off)
      }
    })
    lamps.instanceMatrix.needsUpdate = true
    lamps.instanceColor.needsUpdate = true
    lamps.computeBoundingSphere()
    lampShown.fill(-1)
  }, [res])

  useEffect(
    () => () => {
      pointer.hover = -1
    },
    [],
  )

  useFrame((_state, delta) => {
    const mesh = cardsRef.current
    const lamps = lampsRef.current
    if (!mesh || !lamps) return
    const state = useGame.getState()
    const { tables, match, localFlips, reveal } = state
    const now = Date.now()
    const dt = Math.min(delta, 0.05)
    const uniforms = res.cardMaterial.userData.uniforms
    // Faces read upright for the player at this table's -Z end too.
    uniforms.uTurn.value = match?.seat === 1 ? 1 : 0

    let matrices = false
    let attributes = false
    let lampsChanged = false
    const myTurnTable = match && match.phase === 'turn' && match.turn === 'me' ? match.table : -1

    for (let ti = 0; ti < TABLES.length; ti += 1) {
      const def = TABLES[ti]
      const t = tables[def.id]
      const phase = t?.phase || 'waiting'
      const mine = Boolean(match && match.table === def.id)
      const mySeat = mine ? match.seat : -1
      if (phase === 'deal' && seenPhase[ti] !== 'deal') dealStart[ti] = now
      seenPhase[ti] = phase
      const board = t?.board
      const owners = t?.owners
      const flips = mine && localFlips && localFlips.key === match.turnNo ? localFlips.cards : null
      const peek = mine && reveal && reveal.table === def.id && reveal.until > now ? reveal : null
      const fx = boardFx.get(def.id)
      const shuffleT = fx?.shuffleAt ? (now - fx.shuffleAt) / SHUFFLE_MS : 2
      const popT = fx?.matchAt ? (now - fx.matchAt) / POP_MS : 2
      const shakeT = fx?.missAt ? (now - fx.missAt) / SHAKE_MS : 2
      const dealing = phase === 'deal' && now - dealStart[ti] < N * DEAL_STEP_MS + DEAL_MS + 100
      const missing = phase === 'reveal' && t && !t.hit

      // Turn lamps.
      for (let s = 0; s < 2; s += 1) {
        let c = 0
        if (t?.frozen?.[s]) c = 3
        else if (t && t.turn === s && (phase === 'turn' || phase === 'reveal')) c = mine ? (s === mySeat ? 1 : 2) : 1
        const li = ti * 2 + s
        if (lampShown[li] !== c) {
          lampShown[li] = c
          lamps.setColorAt(li, c === 0 ? LAMP.off : c === 1 ? LAMP.mine : c === 2 ? LAMP.theirs : LAMP.frozen)
          lampsChanged = true
        }
      }

      for (let i = 0; i < N; i += 1) {
        const g = ti * N + i
        const code = board ? board[i] : '.'
        const owner = owners ? owners[i] : '-'
        let cell = cellOfCode(code)
        let tint = TI.up
        let up = cell >= 0

        if (!up && flips && listed(flips, i)) {
          up = true
          cell = BLANK_CELL
        }
        if (peek && owner === '-') {
          for (let k = 0; k < peek.cards.length; k += 1) {
            if (peek.cards[k].i !== i) continue
            up = true
            cell = cellOfCode(peek.cards[k].f)
            tint = peek.kind === 'hint' ? TI.hint : TI.peek
          }
        }

        if (owner === '0' || owner === '1') {
          const s = owner === '0' ? 0 : 1
          tint = mine ? (s === mySeat ? TI.mine : TI.theirs) : s === 0 ? TI.seat0 : TI.seat1
        } else if (owner === 'u' && missing) tint = TI.miss
        else if (phase === 'ended' && owner === '-') tint = TI.rest
        if (cell === GOLDEN_CELL) tint = TI.golden

        // Faces stay on while a card turns back down, so it never blanks mid-turn.
        if (cell < 0) cell = shownCell[g] >= 0 ? shownCell[g] : BLANK_CELL
        if (cell !== shownCell[g] || tint !== shownTint[g]) {
          shownCell[g] = cell
          shownTint[g] = tint
          setCard(res.card, g, cell, TINT_LIST[tint])
          attributes = true
        }

        // Turn towards face up / face down at a steady rate.
        const target = up ? Math.PI : 0
        const a0 = angle[g]
        if (a0 !== target) {
          const step = FLIP_SPEED * dt
          angle[g] = a0 < target ? Math.min(target, a0 + step) : Math.max(target, a0 - step)
        }
        const a = angle[g]

        // Pose in the table's frame.
        let lx = LOCAL[i][0]
        let lz = LOCAL[i][1]
        let y = CARD_Y + Math.sin(a) * LIFT
        let spin = 0
        let scale = 1

        if (dealing) {
          const p = clamp01((now - dealStart[ti] - i * DEAL_STEP_MS) / DEAL_MS)
          if (p <= 0) scale = 0
          else {
            const e = easeOut(p)
            // From a stack over the table's middle, spinning down into place.
            lx *= e
            lz *= e
            y += (1 - e) * 0.9
            spin = (1 - e) * Math.PI * 1.5
          }
        } else if (shuffleT < 1 && owner === '-' && !up) {
          const s = Math.sin(shuffleT * Math.PI)
          lx *= 1 - 0.75 * s
          lz *= 1 - 0.75 * s
          y += s * 0.45 + Math.sin(shuffleT * Math.PI * 4 + i) * 0.04 * s
          spin = shuffleT * Math.PI * 2 * (i % 2 ? 1 : -1)
        }
        if (popT < 1 && fx?.matchCards && listed(fx.matchCards, i)) {
          scale *= 1 + 0.18 * Math.sin(popT * Math.PI)
          y += 0.08 * Math.sin(popT * Math.PI)
        }
        if (shakeT < 1 && fx?.missCards && listed(fx.missCards, i)) {
          lx += Math.sin(shakeT * Math.PI * 8) * 0.03 * (1 - shakeT)
        }
        if (def.id === myTurnTable && pointer.hover === g && !up && owner === '-') {
          y += HOVER_LIFT
          scale *= 1.04
        }

        const [dx, dz] = rotateXZ(lx, lz, def.ry)
        const x = def.x + dx
        const z = def.z + dz
        const yaw = def.ry + spin
        const o = g * 6
        if (
          written[o] === x &&
          written[o + 1] === y &&
          written[o + 2] === z &&
          written[o + 3] === yaw &&
          written[o + 4] === a &&
          written[o + 5] === scale
        ) {
          continue
        }
        written[o] = x
        written[o + 1] = y
        written[o + 2] = z
        written[o + 3] = yaw
        written[o + 4] = a
        written[o + 5] = scale
        _obj.position.set(x, y, z)
        _obj.rotation.set(a, yaw, 0)
        _obj.scale.setScalar(scale)
        _obj.updateMatrix()
        mesh.setMatrixAt(g, _obj.matrix)
        matrices = true
      }
    }

    if (matrices) mesh.instanceMatrix.needsUpdate = true
    if (attributes) markCardsDirty(res.card)
    if (lampsChanged) lamps.instanceColor.needsUpdate = true
  })

  const onMove = (e) => {
    const g = e.instanceId ?? -1
    const i = g % N
    const ok = g >= 0 && canFlip(i)
    const next = ok ? g : -1
    if (pointer.hover !== next) {
      pointer.hover = next
      gl.domElement.style.cursor = ok ? 'pointer' : 'grab'
    }
  }

  return (
    <>
      <instancedMesh
        ref={cardsRef}
        args={[res.card, res.cardMaterial, TOTAL]}
        frustumCulled={false}
        onPointerMove={onMove}
        onPointerOut={() => {
          pointer.hover = -1
          gl.domElement.style.cursor = 'grab'
        }}
        onClick={(e) => {
          // A drag that happens to end on a card is not a tap.
          if (e.delta > 8 || e.instanceId === undefined) return
          if (flipCard(e.instanceId % N)) e.stopPropagation()
        }}
      />
      <instancedMesh ref={lampsRef} args={[res.lamp, res.lampMaterial, TABLES.length * 2]} />
    </>
  )
}

export default CardBoards
