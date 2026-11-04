import { sfx } from '../audio/sfx'
import { confirmPresence, retryConnection } from '../net/api'
import { useGame } from '../net/gameStore'
import { useNow } from './format'

/** "Are you still there?": any input answers it; the button is the obvious way. */
function AfkWarning({ until }) {
  const now = useNow(250)
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return (
    <div className="pointer-events-auto absolute inset-0 z-[65] flex items-center justify-center bg-black/45">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="afk-title"
        className="ui-panel pop-in flex w-[min(90vw,24rem)] flex-col items-center gap-3 px-5 py-4 text-center"
      >
        <div className="text-[2.8rem] leading-none">😴</div>
        <h2 id="afk-title" className="stroke-text text-[1.7rem] font-bold leading-tight text-white">
          Are you still there?
        </h2>
        <p className="text-sm font-semibold leading-snug text-white/85">
          Players who are away get removed so others can join.{' '}
          <span className="font-bold text-[#ffcf4a]">Removing you in {left}s</span>
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => {
            sfx.click()
            confirmPresence()
          }}
          className="btn-3d press w-full bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-2 py-2.5 text-xl font-bold text-white"
        >
          <span className="stroke-thin">I&apos;M HERE! 👋</span>
        </button>
      </div>
    </div>
  )
}

/** Removed for being away: the slot went to someone else; rejoin only when they ask. */
function AfkRemoved() {
  return (
    <div className="pointer-events-auto absolute inset-0 z-[75] flex items-center justify-center bg-black/60">
      <div className="ui-panel pop-in flex w-[min(90vw,24rem)] flex-col items-center gap-3 px-5 py-4 text-center">
        <div className="text-[2.8rem] leading-none">💤</div>
        <h2 className="stroke-text text-[1.7rem] font-bold leading-tight text-white">You were away</h2>
        <p className="text-sm font-semibold leading-snug text-white/85">
          You were removed from the server for being AFK, so someone else could play. Your cash and items are
          saved.
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => {
            sfx.click()
            retryConnection()
          }}
          className="btn-3d press w-full bg-gradient-to-b from-[#5dff5d] to-[#22c522] px-2 py-2.5 text-xl font-bold text-white"
        >
          <span className="stroke-thin">PLAY AGAIN</span>
        </button>
      </div>
    </div>
  )
}

/** The AFK prompt and the "you were removed" screen. */
export function AfkNotice() {
  const status = useGame((s) => s.status)
  const warn = useGame((s) => s.afkWarn)
  if (status === 'afk') return <AfkRemoved />
  if (warn && status === 'online') return <AfkWarning until={warn.until} />
  return null
}

export default AfkNotice
