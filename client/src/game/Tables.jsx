import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { BoxGeometry, CanvasTexture, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace } from 'three'

import { useGame } from '../net/gameStore'
import { useCulled } from './culling'
import { Label } from './labels'
import { BOARD, chairById, chairYaw, DATA, FLOOR, RARITY_AURA, RARITY_COLORS, TABLE, seatPosition } from './layout'
import { useSettings } from './quality'
import Auras from './Aura'
import {
  addFinishAttribute,
  createChairCushionGeometry,
  createChairFrameGeometry,
  createChairMaterial,
  createSnowGeometry,
  createSnowMaterial,
  createThroneGemGeometry,
  createThroneGeometry,
  cushionColor,
  setFinish,
} from './furniture'
import Instanced from './Instanced'
import { mergedBoxes, setInstanceColor, writeInstances } from './instancing'
import CardBoards from './CardBoards'
import { useDisposable } from './useDisposable'

/** An unclaimed seat: dark wood frame, cream cushion. */
const EMPTY_CHAIR = '#6b4329'
const EMPTY_CUSHION = '#e9dcc3'

/**
 * Everything of a table below its top, in one geometry: a dark trim under the top's
 * edge, a frame (apron) joining the legs, four legs and a footrest bar.
 */
function createTableBase() {
  const top = TABLE.height - 0.12
  const x = TABLE.width / 2 - 0.16
  const z = TABLE.depth / 2 - 0.16
  return mergedBoxes([
    { size: [TABLE.width + 0.08, 0.06, TABLE.depth + 0.08], at: [0, top - 0.03, 0] },
    { size: [TABLE.width - 0.26, 0.16, 0.06], at: [0, top - 0.14, z] },
    { size: [TABLE.width - 0.26, 0.16, 0.06], at: [0, top - 0.14, -z] },
    { size: [0.06, 0.16, TABLE.depth - 0.26], at: [x, top - 0.14, 0] },
    { size: [0.06, 0.16, TABLE.depth - 0.26], at: [-x, top - 0.14, 0] },
    ...[-x, x].flatMap((lx) => [-z, z].map((lz) => ({ size: [0.13, top, 0.13], at: [lx, top / 2, lz] }))),
    { size: [0.06, 0.06, TABLE.depth - 0.32], at: [0, 0.18, 0] },
  ])
}

/**
 * The felt mat the cards lie on: deep teal baize, a gold rope border, a thin inner
 * line and faint suit marks in the corners. 256 px, shared by every table.
 */
function createFeltTexture() {
  const w = 256
  const h = Math.round((w * BOARD.d) / BOARD.w)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.7)
  g.addColorStop(0, '#13806f')
  g.addColorStop(1, '#0b4f47')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // Felt grain.
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
  }
  ctx.strokeStyle = '#f2c14e'
  ctx.lineWidth = 6
  ctx.strokeRect(4, 4, w - 8, h - 8)
  ctx.strokeStyle = 'rgba(242,193,78,0.45)'
  ctx.lineWidth = 2
  ctx.strokeRect(13, 13, w - 26, h - 26)
  ctx.fillStyle = 'rgba(242,193,78,0.35)'
  ctx.font = '700 18px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ;[['♠', 24, 24], ['♥', w - 24, 24], ['♦', 24, h - 24], ['♣', w - 24, h - 24]].forEach(([c, x, y]) =>
    ctx.fillText(c, x, y),
  )
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const ONE = [1, 1, 1]
const ZERO = [0, 0, 0]

/** Every seat of every table; each chair faces across the table at the other one. */
const SEATS = DATA.tables.flatMap((t) => [0, 1].map((i) => ({ table: t, index: i, ...seatPosition(t.id, i) })))
const placement = () => SEATS.map((s) => ({ p: [s.x, 0, s.z], ry: chairYaw(s), s: ZERO, c: '#ffffff' }))
/** Per-seat placement of the optional parts, rewritten when seats change (scale 0 = hidden). */
const thronePlacement = placement()
const gemPlacement = placement()
const snowPlacement = placement()

/**
 * All fifteen tables: tops, felt mats, legs, both chairs each and the memory cards
 * between them (see CardBoards), as a handful of instanced meshes. Each seat's chair takes the
 * colour, finish and style of the chair its occupant has equipped.
 */
export function Tables() {
  const { shadows, particles } = useSettings()
  const chairsRef = useRef(null)
  const cushionsRef = useRef(null)
  const thronesRef = useRef(null)
  const gemsRef = useRef(null)
  const snowRef = useRef(null)

  const res = useDisposable(
    () => ({
      top: new BoxGeometry(TABLE.width, 0.12, TABLE.depth),
      legs: createTableBase(),
      chair: addFinishAttribute(createChairFrameGeometry(), SEATS.length),
      cushion: createChairCushionGeometry(),
      throne: addFinishAttribute(createThroneGeometry(), SEATS.length),
      gems: createThroneGemGeometry(),
      snow: createSnowGeometry(),
      chairMaterial: createChairMaterial(),
      snowMaterial: createSnowMaterial(),
      gemMaterial: new MeshBasicMaterial({ color: '#ffffff' }),
      wood: new MeshLambertMaterial({ color: '#b8743f' }),
      felt: createFeltTexture(),
      mat: new PlaneGeometry(BOARD.w, BOARD.d).rotateX(-Math.PI / 2),
      darkWood: new MeshLambertMaterial({ color: '#4a2a1a' }),
      tinted: new MeshLambertMaterial({ color: '#ffffff' }),
    }),
    [],
  )

  const tops = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, TABLE.height - 0.06, t.z], ry: t.ry })), [])
  const mats = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, TABLE.height + 0.002, t.z], ry: t.ry })), [])
  const feltMaterial = useDisposable(() => new MeshLambertMaterial({ map: res.felt }), [res])
  const legs = useMemo(() => DATA.tables.map((t) => ({ p: [t.x, 0, t.z], ry: t.ry })), [])
  const chairs = useMemo(() => SEATS.map((s) => ({ p: [s.x, 0, s.z], ry: chairYaw(s), c: EMPTY_CHAIR })), [])

  // Seats follow whoever sits there. Subscribing (rather than selecting) means table
  // updates repaint 20 instances without re-rendering React.
  useEffect(() => {
    const paint = (tables) => {
      const frames = chairsRef.current
      const cushions = cushionsRef.current
      if (!frames || !cushions) return
      SEATS.forEach((s, i) => {
        const occupant = tables[s.table.id]?.seats[s.index]
        const chair = occupant ? chairById(occupant.chair) : null
        const color = chair ? chair.color : EMPTY_CHAIR
        setInstanceColor(frames, i, color)
        setInstanceColor(cushions, i, chair ? `#${cushionColor(color)}` : EMPTY_CUSHION)
        setFinish([res.chair, res.throne], i, chair ?? DATA.chairs[0])
        // Thrones get their crest, armrests and jewels, snow chairs their snow; other
        // seats hide them.
        const throne = chair?.style === 'throne'
        thronePlacement[i].s = throne ? ONE : ZERO
        thronePlacement[i].c = color
        gemPlacement[i].s = throne ? ONE : ZERO
        gemPlacement[i].c = RARITY_COLORS[chair?.rarity] ?? '#ffffff'
        snowPlacement[i].s = chair?.style === 'snow' ? ONE : ZERO
      })
      writeInstances(thronesRef.current, thronePlacement)
      writeInstances(gemsRef.current, gemPlacement)
      writeInstances(snowRef.current, snowPlacement)
    }
    paint(useGame.getState().tables)
    return useGame.subscribe((state, prev) => {
      if (state.tables !== prev.tables) paint(state.tables)
    })
  }, [res])

  useLayoutEffect(() => {
    writeInstances(chairsRef.current, chairs)
    writeInstances(cushionsRef.current, chairs)
  }, [chairs])

  return (
    <>
      <Instanced geometry={res.top} material={res.wood} items={tops} castShadow={shadows} receiveShadow />
      <Instanced geometry={res.mat} material={feltMaterial} items={mats} receiveShadow />
      <Instanced geometry={res.legs} material={res.darkWood} items={legs} castShadow={shadows} />
      <instancedMesh
        ref={chairsRef}
        args={[res.chair, res.chairMaterial, chairs.length]}
        castShadow={shadows}
        receiveShadow
      />
      <instancedMesh ref={cushionsRef} args={[res.cushion, res.tinted, chairs.length]} receiveShadow />
      <instancedMesh ref={thronesRef} args={[res.throne, res.chairMaterial, chairs.length]} castShadow={shadows} />
      <instancedMesh ref={gemsRef} args={[res.gems, res.gemMaterial, chairs.length]} />
      <instancedMesh ref={snowRef} args={[res.snow, res.snowMaterial, chairs.length]} />
      <CardBoards />
      {DATA.tables.map((t) => (
        <TableLabel key={t.id} table={t} />
      ))}
      {/* Seat auras are a nice-to-have: off on the LOW preset (which has no particles). */}
      {particles && <SeatAuras />}
    </>
  )
}

/**
 * A rarity aura under every occupied seat whose player has a bought chair equipped.
 * The selector returns a string, so React only re-renders when that set changes.
 */
function SeatAuras() {
  const key = useGame((s) =>
    SEATS.map((seat) => {
      const chair = s.tables[seat.table.id]?.seats[seat.index]?.chair
      return chair && chair !== 'basic' ? chair : ''
    }).join(','),
  )
  const items = useMemo(
    () =>
      key
        .split(',')
        .map((id, i) => {
          if (!id) return null
          const chair = chairById(id)
          const seat = SEATS[i]
          return {
            x: seat.x,
            // The aura's ring lies 0.02 above `y`: clear of the rug under the seat.
            y: FLOOR.aura - 0.02,
            z: seat.z,
            color: RARITY_COLORS[chair.rarity],
            strength: RARITY_AURA[chair.rarity] * 0.7,
          }
        })
        .filter(Boolean),
    [key],
  )
  if (items.length === 0) return null
  return <Auras items={items} />
}

function tableLines(table, weekend, now) {
  const reward = DATA.winReward * (weekend ? 2 : 1)
  const prize = weekend
    ? { text: `Win $${reward} (x2)`, size: 34, rainbow: true }
    : { text: `Win $${reward}`, size: 34, color: '#5cff5c' }
  if (!table || table.phase === 'waiting') {
    const n = table ? table.seats.filter(Boolean).length : 0
    return [{ text: `🃏 ${n}/2 Players`, size: 40 }, prize]
  }
  if (table.phase === 'countdown') {
    return [{ text: `Starting in ${Math.max(1, Math.ceil((table.endsAt - now) / 1000))}`, size: 40 }]
  }
  if (table.phase === 'ended') return []
  // Spectators get the score.
  return [
    { text: table.phase === 'deal' ? '🃏 Dealing…' : '🃏 Memory Duel', size: 30, color: '#ffcf4a' },
    { text: `${table.scores[0]}  -  ${table.scores[1]}`, size: 38 },
  ]
}

/**
 * "0/2 Players / Win $200" above a table, or the duel's round and score while it
 * plays. Polled, since the countdown ticks. Hidden at the player's own table, where
 * the HUD shows the same thing.
 */
function TableLabel({ table }) {
  const label = useDisposable(() => new Label({ height: 0.42 }), [])

  useEffect(() => {
    const update = () => {
      const s = useGame.getState()
      label.set(
        s.match?.table === table.id ? [] : tableLines(s.tables[table.id], s.profile?.weekend, Date.now()),
      )
    }
    update()
    const id = setInterval(update, 250)
    return () => clearInterval(id)
  }, [label, table.id])

  useCulled(label.sprite, table.x, table.z, { label, group: 'tables' })
  return <primitive object={label.sprite} position={[table.x, 3.3, table.z]} />
}

export default Tables
