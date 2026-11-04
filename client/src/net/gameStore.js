import { create } from 'zustand'

/**
 * Event-driven game state for the UI: connection, room roster, tables, the local
 * player's match and profile. Updated by socket.js when messages arrive — never
 * from a frame loop. Server durations ("ends in N ms") are converted to local
 * deadlines on receipt so client clock skew can't matter.
 */

let toastId = 0

export const useGame = create((set, get) => ({
  /** 'connecting' | 'online' | 'offline' */
  status: 'connecting',
  selfId: null,
  roomId: null,
  capacity: 20,
  /** id -> { id, name, streak, equipped, proportions } */
  players: {},
  /** id -> public table state + `endsAt` */
  tables: {},
  /** This player's private match state + `endsAt`, or null when not seated. */
  match: null,
  /** Owner's profile view + `giftAt` / `questResetAt` deadlines. */
  profile: null,
  lb: { streaks: [], wins: [], levels: [], playtime: [] },
  toasts: [],
  /** null | 'shop' | 'items' | 'rewards' | 'quests' | 'help' | 'settings' */
  modal: null,
  shopTab: 'chairs',
  /** Duel outcome banner for this player: { win, reward, reason, score, until }. */
  result: null,
  /**
   * Cards this player has flipped this turn but the server may not have confirmed
   * yet: { key, cards: number[] } (key = the turn's number). Lets a card start
   * turning at once.
   */
  localFlips: null,
  /**
   * Private reveals (Peek / Hint): { kind, cards: [{ i, f }], until, table } shown
   * to this player only.
   */
  reveal: null,
  /** The "Quit the duel?" popup is open (only while a duel is under way). */
  quitAsk: false,
  /** Full-screen edge glow at your table: { kind: 'zap' | 'golden' | 'match' | 'freeze', at, delay, until } (ms). */
  flash: null,
  /** Level-up celebration: { level, reward, title, until }. */
  levelUp: null,
  emotesOpen: true,

  openModal: (modal, shopTab) => set({ modal, ...(shopTab ? { shopTab } : {}) }),
  closeModal: () => set({ modal: null }),
  setShopTab: (shopTab) => set({ shopTab }),
  toggleEmotes: () => set({ emotesOpen: !get().emotesOpen }),

  pushToast: (text) => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-3), { id, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 3200)
  },
}))

export const isPlayingPhase = (phase) => phase === 'deal' || phase === 'turn' || phase === 'reveal'
