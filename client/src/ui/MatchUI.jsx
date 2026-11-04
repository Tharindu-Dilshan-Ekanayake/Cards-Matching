import { useEffect, useState } from 'react'

import { sfx } from '../audio/sfx'
import { activatePower, canUsePower } from '../game/cardActions'
import { CARDS, DATA, emoteById, POWERS, titleById } from '../game/layout'
import { send } from '../net/api'
import { isPlayingPhase, useGame } from '../net/gameStore'
import { boardFx, bubbles } from '../net/liveState'
import { money, useNow } from './format'
import { useTouch } from './touch'

const secondsLeft = (endsAt, now) => Math.max(0, Math.ceil((endsAt - now) / 1000))
const TURN_MS = CARDS.turnSec * 1000
/** Seconds left in your turn when the ring starts to hurry you. */
const HURRY_S = 4

/**
 * Big centre text (countdown, result), below the duel bar.
 * `top` is its own prop: two `top-*` classes on one element would fight.
 */
function Banner({ children, top = 'top-[30%]' }) {
  return (
    <div className={`pointer-events-none absolute left-1/2 z-30 w-[92vw] -translate-x-1/2 text-center ${top}`}>
      {children}
    </div>
  )
}

/** Leaves the table; mid-duel (`forfeit`) it asks first, in the QuitDialog. */
function LeaveButton({ label = 'Leave', forfeit = false }) {
  return (
    <button
      type="button"
      onClick={() => {
        sfx.click()
        if (forfeit) useGame.setState({ quitAsk: true })
        else send({ t: 'leave' })
      }}
      className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#ff5a5a] to-[#d81f1f] px-4 py-1.5 text-base font-bold text-white"
    >
      <span className="stroke-thin">{label}</span>
    </button>
  )
}

/**
 * "Quit the duel?" in the middle of the screen, in the game's own style (not the
 * browser's confirm box). Quitting is a loss: you pay up to DATA.forfeit.penalty to
 * your opponent. Esc or a tap outside keeps playing.
 */
function QuitDialog() {
  const cash = useGame((s) => s.profile?.cash ?? 0)
  const pay = Math.min(DATA.forfeit.penalty, cash)
  const stay = () => {
    sfx.click()
    useGame.setState({ quitAsk: false })
  }
  const quit = () => {
    sfx.click()
    useGame.setState({ quitAsk: false })
    send({ t: 'leave' })
  }

  useEffect(() => {
    // Captured first, so Esc only closes this (and doesn't also open Bloxity's menu).
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      useGame.setState({ quitAsk: false })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={stay}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quit-title"
        onClick={(e) => e.stopPropagation()}
        className="ui-panel pop-in flex w-[min(90vw,24rem)] flex-col items-center gap-3 px-5 py-4 text-center"
      >
        <div className="text-[2.8rem] leading-none">🏃💨</div>
        <h2 id="quit-title" className="stroke-text text-[1.7rem] font-bold leading-tight text-white">
          Quit the duel?
        </h2>
        <p className="text-sm font-semibold leading-snug text-white/85">
          Quitting counts as a loss and your opponent wins the prize
          {pay > 0 && (
            <>
              {' '}
              <span className="font-bold text-[#ff8a8a]">plus {money(pay)} of your cash</span>
            </>
          )}
          .
        </p>
        <div className="mt-1 flex w-full gap-2">
          <button
            type="button"
            autoFocus
            onClick={stay}
            className="btn-3d press flex-1 bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-2 py-2 text-base font-bold text-white"
          >
            <span className="stroke-thin">KEEP PLAYING</span>
          </button>
          <button
            type="button"
            onClick={quit}
            className="btn-3d press flex-1 bg-gradient-to-b from-[#ff5a5a] to-[#d81f1f] px-2 py-2 text-base font-bold text-white"
          >
            <span className="stroke-thin">QUIT{pay > 0 ? ` −${money(pay)}` : ''}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/** What a duelist last said (an emote, "Got it! 😎", "Combo x2! 🔥"), while it lasts. */
function speechOf(id, now) {
  const b = id ? bubbles.get(id) : null
  return b && b.text && b.until > now ? b.text : null
}

/** The power-ups a player has left, as little icons (used ones faded). */
function PowersLeft({ used, align }) {
  return (
    <span className={`flex gap-0.5 ${align === 'left' ? '' : 'flex-row-reverse'}`}>
      {POWERS.map((p) => (
        <span
          key={p.id}
          title={p.name}
          className={`text-[0.8rem] leading-none ${used?.includes(p.id) ? 'opacity-25 grayscale' : ''}`}
        >
          {p.icon}
        </span>
      ))}
    </span>
  )
}

/** One side of the duel bar: title, name, points, turn / frozen badges, a speech bubble. */
function DuelistCard({ player, isSelf, score, active, frozen, used, speech, align }) {
  const title = titleById(player?.title)
  const left = align === 'left'
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${left ? 'items-start' : 'items-end'}`}>
      <div
        className={`ui-panel flex w-full min-w-0 items-center gap-2 px-2.5 py-1 ${left ? '' : 'flex-row-reverse'} ${
          active ? 'outline outline-[3px] outline-offset-1 outline-[#5cff8a]' : ''
        }`}
      >
        <span
          className={`stroke-text min-w-[2.2ch] text-center text-[2.1rem] font-bold leading-none ${
            isSelf ? 'text-[#7dff9a]' : 'text-[#9fd2ff]'
          }`}
        >
          {score}
        </span>
        <div className={`flex min-w-0 flex-1 flex-col ${left ? 'items-start text-left' : 'items-end text-right'}`}>
          {title && (
            <span
              className={`max-w-full truncate text-[0.65rem] font-bold leading-tight ${title.rainbow ? 'rainbow-text' : ''}`}
              style={title.rainbow ? undefined : { color: title.color }}
            >
              {title.name}
            </span>
          )}
          <span className={`stroke-thin flex max-w-full items-center gap-1 text-base font-bold leading-tight text-white ${left ? '' : 'flex-row-reverse'}`}>
            <span className="truncate">{player?.name || '…'}</span>
            {isSelf && <span className="shrink-0 rounded bg-[#2a6bff] px-1 text-[0.6rem]">YOU</span>}
          </span>
          <span className={`mt-0.5 flex items-center gap-1.5 ${left ? '' : 'flex-row-reverse'}`}>
            <PowersLeft used={used} align={align} />
            {frozen && (
              <span className="stroke-thin pop-in whitespace-nowrap rounded-full border-2 border-black/70 bg-gradient-to-b from-[#bdf0ff] to-[#4fb8ff] px-1.5 text-[0.65rem] font-bold leading-snug text-white">
                ❄️ FROZEN
              </span>
            )}
          </span>
        </div>
      </div>
      {speech && (
        <div
          key={speech}
          className={`speech pop-in max-w-full rounded-xl border-2 border-black/70 bg-white px-2 py-0.5 text-sm font-bold leading-snug text-[#1d2433] ${
            left ? 'speech-left' : 'speech-right'
          }`}
        >
          {speech}
        </div>
      )}
    </div>
  )
}

/** The middle of the duel bar: the turn timer ring, and whose turn it is. */
function TurnClock({ match, now }) {
  const turn = match.phase === 'turn' || match.phase === 'reveal'
  const mine = match.turn === 'me'
  const left = match.phase === 'turn' ? Math.max(0, match.endsAt - now) : TURN_MS
  const secs = Math.ceil(left / 1000)
  const hurry = match.phase === 'turn' && mine && secs <= HURRY_S

  // A tick on each of your last seconds.
  useEffect(() => {
    if (hurry && secs > 0) sfx.hurry()
  }, [hurry, secs])

  let label = 'VS'
  if (match.phase === 'deal') label = 'DEALING'
  else if (turn) label = mine ? 'YOUR TURN' : 'THEIR TURN'
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
      <div
        className={`turn-ring flex items-center justify-center ${hurry ? 'turn-hurry' : ''}`}
        style={{
          '--p': turn ? left / TURN_MS : 1,
          '--ring': !turn ? '#ffcf4a' : hurry ? '#ff5a5a' : mine ? '#5cff8a' : '#ff9ec7',
        }}
      >
        <span className="stroke-thin text-xl font-bold text-white">
          {match.phase === 'countdown' ? 'VS' : turn ? secs : '🃏'}
        </span>
      </div>
      <span
        className={`stroke-thin whitespace-nowrap rounded-md px-1.5 text-[0.7rem] font-bold text-white ${
          turn && mine ? 'bg-[#1f9d4d]' : 'bg-black/45'
        }`}
      >
        {label}
      </span>
    </div>
  )
}

/** Top of the screen during a duel: you | the turn | your opponent. */
function DuelBar({ match, now }) {
  const selfId = useGame((s) => s.selfId)
  const profile = useGame((s) => s.profile)
  const them = useGame((s) => (match.opponent ? s.players[match.opponent] : null))
  const self = { name: profile?.name || 'You', title: profile?.equippedTitle }
  const turn = match.phase === 'turn' || match.phase === 'reveal'

  return (
    <div className="hud-top pointer-events-none absolute left-1/2 z-40 flex w-[min(96vw,38rem)] -translate-x-1/2 items-start gap-2">
      <DuelistCard
        player={self}
        isSelf
        score={match.myScore}
        active={turn && match.turn === 'me'}
        frozen={match.frozen}
        used={match.used}
        speech={speechOf(selfId, now)}
        align="left"
      />
      <TurnClock match={match} now={now} />
      <DuelistCard
        player={them}
        score={match.theirScore}
        active={turn && match.turn === 'them'}
        frozen={match.theirFrozen}
        used={match.theirUsed}
        speech={speechOf(match.opponent, now)}
        align="right"
      />
    </div>
  )
}

/**
 * A short banner under the duel bar as things happen: who goes first, whose turn it
 * is, "GO AGAIN!" after a pair, the reveal of a pair or a miss.
 */
function BoardBanner({ match }) {
  const theirName = useGame((s) => (match.opponent && s.players[match.opponent]?.name) || 'Opponent')
  const hit = useGame((s) => s.tables[match.table]?.hit)
  const [shown, setShown] = useState(null)
  const mine = match.turn === 'me'

  useEffect(() => {
    let next = null
    if (match.phase === 'deal') {
      next = mine
        ? { text: 'You go first! 🃏', color: 'text-[#7dff9a]' }
        : { text: `${theirName} goes first`, color: 'text-white' }
    } else if (match.phase === 'turn') {
      if (mine && match.combo > 0) next = { text: 'GO AGAIN! 🔥', color: 'text-[#ffcf4a]' }
      else if (mine) next = { text: 'YOUR TURN! 🃏', color: 'text-[#7dff9a]' }
      else next = { text: `${theirName.toUpperCase()}'S TURN`, color: 'text-white' }
    } else if (match.phase === 'reveal') {
      const golden = hit && Date.now() - (boardFx.get(match.table)?.matchAt || 0) < 1500 && boardFx.get(match.table)?.golden
      if (golden) next = { text: `GOLDEN PAIR! +${CARDS.goldenPoints} ⭐`, color: 'text-[#ffe23d]' }
      else if (hit) next = { text: mine ? 'PAIR! ✅' : 'They found a pair', color: mine ? 'text-[#7dff9a]' : 'text-[#9fd2ff]' }
      else next = { text: 'NO MATCH ✗', color: 'text-[#ff7a7a]' }
    }
    if (!next) return undefined
    // Shown on a timer, from an effect: not derived from render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown({ ...next, key: `${match.phase}-${match.turnNo}` })
    const id = setTimeout(() => setShown(null), match.phase === 'deal' ? 2000 : 1300)
    return () => clearTimeout(id)
  }, [match.phase, match.turnNo, match.combo, mine, hit, theirName, match.table])

  if (!shown) return null
  return (
    <div className="board-banner-pos pointer-events-none absolute left-1/2 z-30 -translate-x-1/2">
      <span key={shown.key} className={`slam stroke-text block whitespace-nowrap text-[2.2rem] font-bold leading-none ${shown.color}`}>
        {shown.text}
      </span>
    </div>
  )
}

/** While a Peek or Hint is showing: a note that only you can see it. */
function RevealNote() {
  const reveal = useGame((s) => s.reveal)
  const now = useNow(200)
  if (!reveal || reveal.until < now) return null
  const hint = reveal.kind === 'hint'
  return (
    <div className="pointer-events-none absolute left-1/2 top-[28%] z-30 -translate-x-1/2">
      <span className="stroke-thin pop-in block whitespace-nowrap rounded-full border-2 border-black/70 bg-gradient-to-b from-[#c79bff] to-[#7b3cff] px-3 py-1 text-base font-bold text-white">
        {hint ? '💡 HINT: those two are a pair!' : '👁️ PEEK: only you can see it!'}
      </span>
    </div>
  )
}

/** The four power-ups, bottom centre: each once per duel, on your turn. Keys 1-4. */
function PowerBar({ match }) {
  // Re-render as flips / turns change what can be used.
  useGame((s) => s.localFlips)
  const touch = useTouch((s) => s.touch)
  const now = useNow(250)
  const state = useGame.getState()
  const myTurn = match.phase === 'turn' && match.turn === 'me'

  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || useGame.getState().quitAsk || useGame.getState().modal) return
      const k = Number(e.key)
      if (k >= 1 && k <= POWERS.length && activatePower(POWERS[k - 1].id)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="power-pos pointer-events-none absolute left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {myTurn && !useGame.getState().localFlips?.cards?.length && (
        <span className="stroke-thin pop-in whitespace-nowrap rounded-full bg-black/50 px-3 py-0.5 text-sm font-bold text-white">
          {touch ? 'Tap 2 cards to flip them' : 'Click 2 cards to flip them'}
        </span>
      )}
      <div className="flex gap-1.5">
        {POWERS.map((p, k) => {
          const used = match.used?.includes(p.id)
          const live = canUsePower(p.id, state, now)
          return (
            <button
              key={p.id}
              type="button"
              disabled={!live}
              title={`${p.name}: ${p.desc}`}
              onClick={() => activatePower(p.id)}
              className={`btn-3d press power-btn pointer-events-auto relative flex flex-col items-center px-1 py-1 text-white ${
                live ? 'power-ready' : ''
              } ${used ? 'opacity-45 grayscale' : ''}`}
              style={{ background: `linear-gradient(180deg, ${p.color}, #3a1d9e)` }}
            >
              <span className="text-[1.6rem] leading-none">{p.icon}</span>
              <span className="stroke-thin text-[0.7rem] font-bold leading-tight">{p.name}</span>
              <span className="text-[0.55rem] font-bold leading-tight text-white/85">{used ? 'USED' : p.desc}</span>
              {!touch && !used && (
                <span className="absolute right-1 top-0.5 text-[0.55rem] font-bold text-white/70">{k + 1}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A soft glow around the screen's edges at your table: a pair (green), the golden
 * pair (gold), a freeze (ice blue), a jolt: a fade in and out, never a hard flash.
 */
function ScreenFlash() {
  const flash = useGame((s) => s.flash)
  useEffect(() => {
    if (!flash) return undefined
    const id = setTimeout(() => useGame.setState({ flash: null }), Math.max(0, flash.until - Date.now()))
    return () => clearTimeout(id)
  }, [flash])
  if (!flash) return null
  return (
    <div
      key={flash.at}
      className={`pointer-events-none absolute inset-0 z-[45] flash-${flash.kind}`}
      style={{ animationDelay: `${flash.delay || 0}ms` }}
    />
  )
}

/** Quick phrases bought in the Store, said in a bubble over your head. */
function EmotePanel({ hiddenInPortrait }) {
  const owned = useGame((s) => s.profile?.ownedEmotes) || []
  const isOpen = useGame((s) => s.emotesOpen)
  const toggle = useGame((s) => s.toggleEmotes)

  return (
    <div
      className={`pointer-events-none absolute bottom-3 left-3 z-40 flex flex-col items-start gap-2 ${
        hiddenInPortrait ? 'portrait:hidden' : ''
      }`}
    >
      {isOpen && (
        <div className="ui-panel pop-in pointer-events-auto w-[15rem] p-2">
          <div className="game-scroll flex max-h-[min(30vh,14rem)] flex-col gap-1.5 overflow-y-auto pr-1">
            {owned.map((id) => {
              const e = emoteById(id)
              if (!e) return null
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    sfx.pop()
                    send({ t: 'emote', id })
                  }}
                  className="btn-3d press flex items-center justify-between bg-gradient-to-b from-[#fff35c] to-[#f2c200] px-2 py-1"
                >
                  <span className="stroke-thin truncate text-base font-bold text-white">
                    {e.label} {e.icon}
                  </span>
                  <span className="text-xs font-bold text-black/50">USE</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        className="btn-3d press pointer-events-auto bg-gradient-to-b from-[#3ee7ff] to-[#2a6bff] px-3 py-1.5 text-lg font-bold text-white"
      >
        <span className="stroke-text">Emotes 👀</span>
      </button>
    </div>
  )
}

const RESULT_TEXT = {
  win: { cards: 'You found more pairs!', forfeit: 'They quit the duel!', afk: 'They stopped playing 😴' },
  lose: { cards: 'They found more pairs', forfeit: 'You quit the duel', afk: 'You stopped playing' },
}

function ResultBanner() {
  const result = useGame((s) => s.result)
  const now = useNow(250)

  useEffect(() => {
    if (!result) return undefined
    const id = setTimeout(() => useGame.setState({ result: null }), Math.max(0, result.until - Date.now()))
    return () => clearTimeout(id)
  }, [result])

  if (!result || result.until < now) return null
  const reason = RESULT_TEXT[result.win ? 'win' : 'lose'][result.reason] || ''
  let reward = result.reward ? `+${money(result.reward)} ${result.win ? '💵' : 'for playing'}` : ''
  // A quitter's money changes hands: it is already in the winner's reward.
  if (result.penalty && result.win) reward = `+${money(result.reward)} 💵 (incl. their ${money(result.penalty)})`
  const lost = result.penalty && !result.win ? `−${money(result.penalty)}` : ''
  const title = result.win ? 'YOU WIN! 🏆' : result.reason === 'cards' ? 'EJECTED! 🚀' : 'YOU LOSE 😭'

  return (
    <Banner top="top-[24%]">
      <div className="pop-in flex flex-col items-center">
        <div
          className={`stroke-text text-[3.4rem] font-bold leading-none ${result.win ? 'text-[#ffe23d]' : 'text-[#ff4040]'}`}
        >
          {title}
        </div>
        {result.reason === 'cards' && (
          <div className="stroke-text mt-1 text-3xl font-bold text-white">
            {result.score[0]} - {result.score[1]}
          </div>
        )}
        <div className="stroke-text mt-2 text-2xl font-bold text-white">
          {reason}
          {reward && <span className="text-[#5cff5c]">{`  ·  ${reward}`}</span>}
          {lost && <span className="text-[#ff6b6b]">{`  ·  ${lost}`}</span>}
        </div>
      </div>
    </Banner>
  )
}

/** Everything on screen while seated at a table: waiting, countdown, the duel. */
export function MatchUI() {
  const match = useGame((s) => s.match)
  const quitAsk = useGame((s) => s.quitAsk)
  const now = useNow(150)

  // A wood-block tick on each second of the "Starting in 3, 2, 1" countdown.
  const countdown = match?.phase === 'countdown' ? Math.max(1, secondsLeft(match.endsAt, now)) : 0
  useEffect(() => {
    if (countdown) sfx.tick()
  }, [countdown])

  const playing = isPlayingPhase(match?.phase)

  return (
    <>
      <ScreenFlash />
      {match && <EmotePanel hiddenInPortrait={playing} />}
      {match && (match.phase === 'countdown' || playing) && <DuelBar match={match} now={now} />}

      {match?.phase === 'waiting' && (
        <div className="pointer-events-none absolute bottom-[16%] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
          <span className="stroke-text whitespace-nowrap text-2xl font-bold text-white">Waiting for an opponent… (1/2)</span>
          <LeaveButton />
        </div>
      )}

      {match?.phase === 'countdown' && (
        <>
          <Banner>
            <span className="stroke-text text-[3.6rem] font-bold text-white">
              Starting in {Math.max(1, secondsLeft(match.endsAt, now))}
            </span>
          </Banner>
          <div className="pointer-events-none absolute bottom-[16%] left-1/2 z-30 -translate-x-1/2">
            <LeaveButton />
          </div>
        </>
      )}

      {playing && (
        <>
          <BoardBanner match={match} />
          <RevealNote />
          <PowerBar match={match} />
          <div className="pointer-events-none absolute bottom-3 right-3 z-40 portrait:bottom-auto portrait:top-[7.5rem]">
            <LeaveButton label="Quit duel" forfeit />
          </div>
        </>
      )}

      <ResultBanner />
      {quitAsk && playing && <QuitDialog />}
    </>
  )
}

export default MatchUI
