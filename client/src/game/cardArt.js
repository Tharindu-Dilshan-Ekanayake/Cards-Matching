import {
  BufferAttribute,
  CanvasTexture,
  Color,
  ExtrudeGeometry,
  InstancedBufferAttribute,
  MeshLambertMaterial,
  Shape,
  SRGBColorSpace,
} from 'three'

import { DATA } from './layout'

/**
 * The memory cards' art, shared by the table boards and the lobby's giant cards.
 *
 * One texture atlas (4 x 4 cells) holds every card face, a blank face and the card
 * back. A card is one rounded slab whose top shows the back, whose underside shows
 * a face and whose rim is plain cream; flipping it turns it over. Which face a card
 * shows and the colour behind it are per-instance attributes, so every card in the
 * world is drawn by one instanced mesh per board set and one shared material.
 *
 * Faces are drawn on a transparent background: the card's tint fills in behind the
 * emoji (white while just turned up, green once matched, red on a miss, gold for
 * the golden pair).
 */

export const GRID = 4
/** Cells 0..12: the face pool (DATA.cards.faces); then the golden face, a blank, the back. */
export const GOLDEN_CELL = DATA.cards.faces.length
export const BLANK_CELL = GOLDEN_CELL + 1
export const BACK_CELL = GRID * GRID - 1
if (BLANK_CELL >= BACK_CELL) throw new Error('cardArt: too many faces for the atlas')

/** The board's face code ('a' + cell) -> atlas cell; '.' (hidden) -> -1. */
export const cellOfCode = (code) => (code && code !== '.' ? code.charCodeAt(0) - 97 : -1)

/** 1024 px on desktop, 512 px on phones (the texture budget). */
const ATLAS_PX =
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 512 : 1024

const EDGE = '#fff4dc'

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** A four-pointed sparkle centred on (x, y). */
function sparkle(ctx, x, y, r) {
  ctx.beginPath()
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4
    const rr = i % 2 ? r * 0.28 : r
    ctx.lineTo(x + Math.sin(a) * rr, y - Math.cos(a) * rr)
  }
  ctx.closePath()
}

function drawFace(ctx, x, y, s, emoji, golden) {
  const pad = s * 0.07
  // A soft inner frame: lighter than the tint behind it.
  roundRect(ctx, x + pad, y + pad, s - pad * 2, s - pad * 2, s * 0.12)
  ctx.lineWidth = s * 0.035
  ctx.strokeStyle = golden ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)'
  ctx.stroke()
  if (!emoji) return
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.round(s * 0.58)}px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif`
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = s * 0.04
  ctx.shadowOffsetY = s * 0.025
  ctx.fillText(emoji, x + s / 2, y + s / 2 + s * 0.04)
  ctx.restore()
  if (golden) {
    ctx.fillStyle = '#ffffff'
    sparkle(ctx, x + s * 0.24, y + s * 0.24, s * 0.08)
    ctx.fill()
    sparkle(ctx, x + s * 0.78, y + s * 0.74, s * 0.06)
    ctx.fill()
  }
}

/** The card back: royal violet, a gold frame, a diamond lattice and a sparkle crest. */
function drawBack(ctx, x, y, s) {
  const r = s * 0.13
  ctx.save()
  roundRect(ctx, x + 1, y + 1, s - 2, s - 2, r)
  const g = ctx.createLinearGradient(x, y, x + s, y + s)
  g.addColorStop(0, '#8b4dff')
  g.addColorStop(1, '#4a1fb8')
  ctx.fillStyle = g
  ctx.fill()
  ctx.clip()

  // Diamond lattice.
  ctx.strokeStyle = 'rgba(255,255,255,0.13)'
  ctx.lineWidth = s * 0.02
  const step = s / 6
  for (let k = -6; k <= 12; k += 1) {
    ctx.beginPath()
    ctx.moveTo(x + k * step, y)
    ctx.lineTo(x + k * step + s, y + s)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x + k * step, y + s)
    ctx.lineTo(x + k * step + s, y)
    ctx.stroke()
  }
  ctx.restore()

  // Gold frame.
  const inset = s * 0.08
  roundRect(ctx, x + inset, y + inset, s - inset * 2, s - inset * 2, r * 0.6)
  ctx.lineWidth = s * 0.035
  ctx.strokeStyle = '#ffd34d'
  ctx.stroke()

  // Crest: a gold medallion with a white sparkle.
  const cx = x + s / 2
  const cy = y + s / 2
  ctx.beginPath()
  ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2)
  const m = ctx.createRadialGradient(cx - s * 0.06, cy - s * 0.07, s * 0.02, cx, cy, s * 0.22)
  m.addColorStop(0, '#fff2a8')
  m.addColorStop(1, '#f0a71c')
  ctx.fillStyle = m
  ctx.fill()
  ctx.lineWidth = s * 0.025
  ctx.strokeStyle = '#7a3d00'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  sparkle(ctx, cx, cy, s * 0.15)
  ctx.fill()

  // Little suit pips in two corners.
  ctx.fillStyle = 'rgba(255,224,120,0.9)'
  ctx.font = `700 ${Math.round(s * 0.13)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('♥', x + s * 0.2, y + s * 0.2)
  ctx.fillText('♠', x + s * 0.8, y + s * 0.8)
}

let atlas = null

/** The shared card atlas (drawn once, on first use). */
export function getCardAtlas() {
  if (atlas && atlas.image) return atlas
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = ATLAS_PX
  const ctx = canvas.getContext('2d')
  const s = ATLAS_PX / GRID
  const cellXY = (cell) => [(cell % GRID) * s, Math.floor(cell / GRID) * s]
  DATA.cards.faces.forEach((emoji, i) => drawFace(ctx, ...cellXY(i), s, emoji, false))
  drawFace(ctx, ...cellXY(GOLDEN_CELL), s, DATA.cards.golden, true)
  drawFace(ctx, ...cellXY(BLANK_CELL), s, null, false)
  drawBack(ctx, ...cellXY(BACK_CELL), s)
  atlas = new CanvasTexture(canvas)
  atlas.colorSpace = SRGBColorSpace
  atlas.anisotropy = 4
  return atlas
}

/**
 * A card: a rounded slab `w` x `d`, `t` thick, lying flat and centred on the
 * origin, back up. `count` instances get their own face and tint attributes
 * (see setCard). UVs: each surface spans 0..1; the shader picks the atlas cell.
 */
export function createCardGeometry({ w, d, t, r, count }) {
  const hw = w / 2
  const hd = d / 2
  const shape = new Shape()
  shape.moveTo(-hw + r, -hd)
  shape.lineTo(hw - r, -hd)
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r)
  shape.lineTo(hw, hd - r)
  shape.quadraticCurveTo(hw, hd, hw - r, hd)
  shape.lineTo(-hw + r, hd)
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r)
  shape.lineTo(-hw, -hd + r)
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd)
  const geometry = new ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 4 })
  // Extruded along +Z: lay it flat, the far cap (z = t) up, centred on y = 0.
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, -t / 2, 0)
  geometry.clearGroups()

  const pos = geometry.attributes.position
  const nrm = geometry.attributes.normal
  const uv = geometry.attributes.uv
  const part = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const ny = nrm.getY(i)
    if (ny > 0.9) {
      // Top (the back): read from above, its top edge towards -Z.
      part[i] = 0
      uv.setXY(i, (x + hw) / w, (-z + hd) / d)
    } else if (ny < -0.9) {
      // Underside (the face): once the card is flipped over its X axis, this reads
      // upright from the +Z end of the table.
      part[i] = 1
      uv.setXY(i, (x + hw) / w, (z + hd) / d)
    } else {
      part[i] = 2
    }
  }
  uv.needsUpdate = true
  geometry.setAttribute('aPart', new BufferAttribute(part, 1))
  geometry.setAttribute('aCell', new InstancedBufferAttribute(new Float32Array(count * 2), 2))
  geometry.setAttribute('aTint', new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3))
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * The card material: Lambert-lit, the atlas cell per instance, the tint behind the
 * face. `uniforms.uTurn.value = 1` turns every face round 180 degrees (for the
 * player at the table's -Z end).
 */
export function createCardMaterial() {
  const material = new MeshLambertMaterial({ map: getCardAtlas() })
  const uniforms = {
    uTurn: { value: 0 },
    uEdge: { value: new Color(EDGE) },
  }
  material.userData.uniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aCell;
attribute vec3 aTint;
attribute float aPart;
uniform float uTurn;
varying vec3 vTint;
varying float vPart;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef USE_MAP
  vec2 cardUv = uv;
  float cardCell = ${BACK_CELL}.0;
  if (aPart > 0.5) {
    cardUv = mix(uv, vec2(1.0) - uv, uTurn);
    cardCell = aCell.x;
  }
  float cardCol = mod(cardCell, ${GRID}.0);
  float cardRow = ${GRID - 1}.0 - floor(cardCell / ${GRID}.0);
  vMapUv = (cardUv + vec2(cardCol, cardRow)) / ${GRID}.0;
#endif
vTint = aTint;
vPart = aPart;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uEdge;
varying vec3 vTint;
varying float vPart;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 cardTexel = texture2D( map, vMapUv );
  if (vPart < 0.5) diffuseColor.rgb = mix(uEdge, cardTexel.rgb, cardTexel.a);
  else if (vPart < 1.5) diffuseColor.rgb = mix(vTint, cardTexel.rgb, cardTexel.a);
  else diffuseColor.rgb = uEdge * mix(vec3(1.0), vTint, 0.35);
#endif`,
      )
  }
  material.customProgramCacheKey = () => 'memory-card-v1'
  return material
}

const _tint = new Color()

/**
 * Sets instance `i`'s face cell and tint (a Color or hex). Call
 * `markCardsDirty(geometry)` after a batch.
 */
export function setCard(geometry, i, cell, tint) {
  geometry.attributes.aCell.setX(i, cell)
  const c = typeof tint === 'string' ? _tint.set(tint) : tint
  geometry.attributes.aTint.setXYZ(i, c.r, c.g, c.b)
}

export function markCardsDirty(geometry) {
  geometry.attributes.aCell.needsUpdate = true
  geometry.attributes.aTint.needsUpdate = true
}
