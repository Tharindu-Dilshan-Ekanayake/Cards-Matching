import { sfx } from '../audio/sfx'
import { send } from '../net/api'
import { useGame } from '../net/gameStore'
import { actionFx, SELF_ANCHOR } from '../net/liveState'
import { CARDS_PER_TABLE } from './layout'

/** The flips the local player has made this turn (confirmed or not). */
function myFlips(state) {
  const { match, localFlips } = state
  return localFlips && match && localFlips.key === match.turnNo ? localFlips.cards : []
}

/** Is it the local player's turn, with a card still to flip? */
export function isMyTurn(state = useGame.getState(), now = Date.now()) {
  const { match } = state
  return Boolean(match && match.phase === 'turn' && match.turn === 'me' && now < match.endsAt + 150)
}

/** Can the local player flip card `i` of their table right now? */
export function canFlip(i, state = useGame.getState(), now = Date.now()) {
  if (!isMyTurn(state, now)) return false
  const table = state.tables[state.match.table]
  if (!table || i < 0 || i >= CARDS_PER_TABLE) return false
  const mine = myFlips(state)
  // Two cards already up this turn (the server's or ours).
  const upCount = Math.max(mine.length, [...table.owners].filter((c) => c === 'u').length)
  if (upCount >= 2) return false
  return table.owners[i] === '-' && !mine.includes(i)
}

/**
 * Turns card `i` of the local player's table face up: the card starts turning at
 * once (its face arrives with the server's answer). Returns true if it did.
 */
export function flipCard(i) {
  const state = useGame.getState()
  if (!canFlip(i, state)) return false
  const { match } = state
  const mine = myFlips(state)
  sfx.flip()
  useGame.setState({ localFlips: { key: match.turnNo, cards: [...mine, i] } })
  // The hand reaches out to the card straight away; the server's echo won't restart it.
  actionFx.set(SELF_ANCHOR, { ...actionFx.get(SELF_ANCHOR), press: Date.now() })
  send({ t: 'flip', i })
  return true
}

/** Can the local player use power-up `id` now (their turn, not used yet this duel)? */
export function canUsePower(id, state = useGame.getState(), now = Date.now()) {
  if (!isMyTurn(state, now)) return false
  const { match } = state
  if (match.used?.includes(id)) return false
  return myFlips(state).length < 2
}

export function activatePower(id) {
  const state = useGame.getState()
  if (!canUsePower(id, state)) return false
  sfx.click()
  send({ t: 'power', id })
  return true
}
