/**
 * The scene's whole look in one place: "Card Kingdom", an island floating above a
 * sea of pink-tinted clouds on a bright afternoon. A clear sky-blue sky warming to
 * peach at the horizon, mint stone underfoot, a ruby-and-cream harlequin square,
 * gold trim, and soft warm sunlight.
 *
 * Colours are sRGB hex, exactly as you would pick them in an image editor.
 *
 * Light intensities are three.js physical units: a light of intensity PI (~3.14)
 * lights a surface facing it to its full texture colour. The hemisphere fill plus the
 * sun add up to just over that on the ground; shadowed ground only gets the fill, so
 * shadows read as a softer, cooler tone.
 */

export const SKY = {
  /** Straight up: clear sky blue. */
  top: '#4f9dff',
  /** At eye level: a warm peach glow. Fog uses the same colour so distant things melt into the sky. */
  horizon: '#ffd9c7',
  /** Lower = the blue reaches further down towards the horizon. */
  exponent: 0.6,
}

/** Haze at the horizon. Distances scale with the quality preset's view distance. */
export const FOG = {
  color: SKY.horizon,
  /** Fraction of the view distance where the haze starts. */
  nearFraction: 0.3,
}

export const CLOUDS = {
  /** Sunlit tops. */
  top: '#ffffff',
  /** Undersides, a soft rose-lilac. */
  bottom: '#f0d3e6',
  count: 18,
}

/** The sea of clouds far below the island; the fog blends it into the sky. */
export const CLOUD_SEA = {
  base: '#ffe3ea',
  puff: '#ffffff',
  y: -32,
}

/** The island's flagstones, two shades of mint stone. */
export const GROUND = {
  base: '#a9dcc6',
  alt: '#9cd2bb',
}

/** The island's rocky underside: warm sandstone at the top, dusky rose towards the tip. */
export const ROCK = {
  rim: '#e3c3a6',
  mid: '#c2928a',
  deep: '#7d5878',
}

/** Gold trim (railings, plinth rims) and the dark navy of posts and frames. */
export const BRASS = {
  rail: '#ffc93d',
  post: '#2f2a5a',
  gear: '#ffc93d',
}

/** Suit colours used round the map: ruby, gold, teal, violet. */
export const SUITS = {
  ruby: '#ef3f5a',
  gold: '#ffc93d',
  teal: '#22c7b2',
  violet: '#8b4dff',
  cream: '#fff3e2',
  navy: '#2a2556',
}

export const LIGHTS = {
  /** Fill from above (bright sky) and below (bounce off the mint stone). */
  hemiSky: '#fff8f0',
  hemiGround: '#9fc9bb',
  hemiIntensity: 2.0,

  sunColor: '#fff0dc',
  sunIntensity: 1.85,
  /**
   * Direction *towards* the sun: high and a little to the left, behind the default
   * camera, so the side of the character you look at is lit and its shadow falls
   * beside it where you can see it, not hidden behind its back.
   */
  sunDirection: [-0.35, 0.9, 0.2],
  /** 1 = shadows get no sunlight at all; lower = lighter shadows. */
  shadowIntensity: 0.7,
  /** Blur radius of shadow edges, in shadow-map texels. */
  shadowSoftness: 4,
}
