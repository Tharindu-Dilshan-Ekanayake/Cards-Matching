const DATA = require('./data')

const T = DATA.timing
const C = DATA.cards
const CARD_COUNT = C.cols * C.rows
const PAIRS = CARD_COUNT / 2
/** Face index of the golden pair (the face pool's indices come first). */
const GOLDEN = C.faces.length
/** After the result: when the loser's chair launches them out, in seconds. */
const EJECT_AT_S = 0.9
/** Phases in which a duel is under way (leaving one is a forfeit). */
const PLAYING = new Set(['deal', 'turn', 'reveal'])
const POWER_IDS = new Set(DATA.powers.map((p) => p.id))
/** A flip that arrives just after the turn ran out still counts (network delay). */
const GRACE_MS = 200
/** What a player sometimes says after a miss. */
const MISS_LINES = ['Oops! 😅', 'Argh! 😤', 'So close! 😬', 'Hmm… 🤔']

const randomInt = (n) => Math.floor(Math.random() * n)

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** A fresh deck: PAIRS - 1 random faces from the pool plus the golden pair, each twice, shuffled. */
function newDeck() {
  const picked = shuffleInPlace([...C.faces.keys()]).slice(0, PAIRS - 1)
  return shuffleInPlace([...picked, GOLDEN].flatMap((f) => [f, f]))
}

const pointsFor = (face) => (face === GOLDEN ? C.goldenPoints : 1)
/** A face as one character of the synced board ('a' + face index). */
const code = (face) => String.fromCharCode(97 + face)

/**
 * One two-seat table and the memory duel played at it.
 *
 * Twenty cards lie face down: nine random pairs from the face pool and one golden
 * pair worth DATA.cards.goldenPoints (so the points can never end level). Players
 * take turns flipping two cards; both see every flip. A pair scores and the same
 * player goes again; a miss turns both back and passes the turn. A turn lasts
 * DATA.cards.turnSec. Each player may use each power-up once per duel, on their own
 * turn: Peek (one hidden card, to them alone) and Shuffle (every hidden card swaps
 * places). The duel ends as soon as the leader can no longer be caught.
 *
 * Phases:
 *   waiting   - zero or one player seated
 *   countdown - both seats filled, "Starting in 3..."
 *   deal      - the cards are dealt
 *   turn      - `turn` seat is choosing cards (up to two face up)
 *   reveal    - two cards are up: a pair (`hit`) or a miss, briefly shown
 *   ended     - result on screen; both players are stood up when it runs out
 *
 * The faces of hidden cards never leave the server: the synced board shows only
 * cards that are face up or matched.
 */
class Table {
  /**
   * @param {{ id: number, x: number, z: number }} def
   * @param {import('./GameRoom')} room
   * @param {object} state this table's synced TableState, for every client to see
   */
  constructor(def, room, state) {
    this.id = def.id
    this.x = def.x
    this.z = def.z
    this.room = room
    this.state = state
    /** @type {Array<import('./Session')|null>} */
    this.seats = [null, null]
    this.token = 0
    this.reset()
  }

  reset() {
    this.phase = 'waiting'
    this.endsAt = 0
    /** Face index at each position (empty until a duel deals). */
    this.faces = []
    /** Seat that matched each position, -1 while unmatched. */
    this.owner = new Array(CARD_COUNT).fill(-1)
    /** Positions face up this turn (0..2). */
    this.up = []
    this.turn = -1
    /** Counts turns (a fresh turn after a pair too), so clients can tell them apart. */
    this.turnNo = 0
    this.score = [0, 0]
    /** Pairs found in a row in the current turn. */
    this.combo = 0
    /** The reveal on show is a pair. */
    this.hit = false
    /** Power-ups each seat has used this duel. */
    this.used = [new Set(), new Set()]
    /** Turns in a row each seat let run out without flipping a card. */
    this.idle = [0, 0]
    /** This turn's player has flipped at least one card. */
    this.acted = false
    /** Seat that found the most recent pair (the tie-break, should one ever happen). */
    this.lastFound = -1
    this.winner = -1
    // Invalidates any setTimeout scheduled for the previous match.
    this.token += 1
  }

  seatOf(session) {
    return this.seats.indexOf(session)
  }

  sit(session, now) {
    if (this.phase !== 'waiting') return 'This table is already playing'
    const free = this.seats.indexOf(null)
    if (free < 0) return 'This table is full'

    this.seats[free] = session
    session.seat = { table: this, index: free }

    if (this.seats[0] && this.seats[1]) {
      this.phase = 'countdown'
      this.endsAt = now + T.countdown * 1000
    }
    this.sync(now)
    return null
  }

  /**
   * A seated player stands up (`gone` false: they pressed Quit / Leave) or
   * disconnected (`gone` true). Leaving a duel under way is a forfeit.
   */
  leave(session, now, { gone = false } = {}) {
    const i = this.seatOf(session)
    if (i < 0) return
    const other = this.seats[1 - i]

    if (PLAYING.has(this.phase) && other) {
      this.finish(1 - i, i, 'forfeit', now)
      if (!gone) this.room.bubble(session, 'I give up! 🏳️')
    } else if (this.phase === 'countdown') {
      other?.toast('Your opponent left the table')
    }

    this.unseat(i)
    if (this.phase !== 'ended') {
      // The remaining player (if any) keeps their seat and waits for someone new.
      this.reset()
      if (other) this.room.bubble(other, '')
    }
    this.sync(now)
  }

  unseat(i) {
    const session = this.seats[i]
    if (!session) return
    this.seats[i] = null
    session.seat = null
    session.send('match', { match: null })
  }

  /** Deals a fresh board; a random player goes first once it has landed. */
  deal(now) {
    this.faces = newDeck()
    this.owner.fill(-1)
    this.up = []
    this.turn = randomInt(2)
    this.phase = 'deal'
    this.endsAt = now + C.dealSec * 1000
    this.sync(now)
  }

  startTurn(seat, now) {
    if (this.turn !== seat) this.combo = 0
    this.turn = seat
    this.turnNo += 1
    this.up = []
    this.acted = false
    this.phase = 'turn'
    this.endsAt = now + C.turnSec * 1000
    this.sync(now)
  }

  /** The turn goes to the other player. */
  passTurn(now) {
    this.combo = 0
    this.startTurn(1 - this.turn, now)
  }

  canAct(i, now) {
    return this.phase === 'turn' && this.turn === i && now <= this.endsAt + GRACE_MS
  }

  /** A player turns card `pos` face up. */
  flip(session, pos, now) {
    const i = this.seatOf(session)
    if (i < 0 || !this.canAct(i, now)) return
    if (!Number.isInteger(pos) || pos < 0 || pos >= CARD_COUNT) return
    if (this.owner[pos] >= 0 || this.up.includes(pos)) return

    this.up.push(pos)
    this.acted = true
    this.idle[i] = 0
    this.room.broadcast('fx', { kind: 'flip', id: session.id, table: this.id, card: pos })
    if (this.up.length === 2) this.resolve(i, now)
    else this.sync(now)
  }

  /** Two cards are up: a pair scores, a miss is shown before they turn back. */
  resolve(i, now) {
    const [a, b] = this.up
    const session = this.seats[i]
    this.hit = this.faces[a] === this.faces[b]
    if (this.hit) {
      const face = this.faces[a]
      const golden = face === GOLDEN
      this.owner[a] = i
      this.owner[b] = i
      this.score[i] += pointsFor(face)
      this.combo += 1
      this.lastFound = i
      if (session) {
        this.room.questEvent(session, 'pair', now)
        if (golden) this.room.questEvent(session, 'golden', now)
        if (this.combo === 3) this.room.questEvent(session, 'combo3', now)
        let line = 'Got it! 😎'
        if (golden) line = 'GOLDEN PAIR! ⭐'
        else if (this.combo >= 2) line = `Combo x${this.combo}! 🔥`
        this.room.bubble(session, line)
      }
      this.room.broadcast('fx', { kind: 'match', id: session?.id ?? '', table: this.id, cards: [a, b], golden })
      this.endsAt = now + C.matchMs
    } else {
      if (session && Math.random() < 0.35) this.room.bubble(session, MISS_LINES[randomInt(MISS_LINES.length)])
      this.room.broadcast('fx', { kind: 'miss', id: session?.id ?? '', table: this.id, cards: [a, b] })
      this.endsAt = now + C.missMs
    }
    this.phase = 'reveal'
    this.sync(now)
  }

  /** Points still on the board. */
  remaining() {
    let points = 0
    for (let p = 0; p < CARD_COUNT; p += 1) if (this.owner[p] < 0) points += pointsFor(this.faces[p])
    // Each pair was counted twice (once per card).
    return points / 2
  }

  /** The seat that has already won (nobody can catch them), or -1. */
  decided() {
    const left = this.remaining()
    const [a, b] = this.score
    if (a > b + left) return 0
    if (b > a + left) return 1
    if (left === 0) return this.lastFound >= 0 ? this.lastFound : randomInt(2)
    return -1
  }

  afterReveal(now) {
    if (this.hit) {
      const w = this.decided()
      if (w >= 0) {
        this.finish(w, 1 - w, 'cards', now)
        return
      }
      // A pair: the same player goes again, with a fresh turn.
      this.startTurn(this.turn, now)
      return
    }
    this.up = []
    this.passTurn(now)
  }

  /** The turn ran out: any card up turns back and the turn passes. Two empty turns in a row lose. */
  timeout(now) {
    const i = this.turn
    if (!this.acted) this.idle[i] += 1
    if (this.idle[i] >= C.afkTurns) {
      // The other player let their last turn run out too: nobody is playing.
      if (this.idle[1 - i] >= C.afkTurns - 1) {
        // Nobody is playing: call the duel off rather than run it forever.
        for (const s of this.seats) s?.toast('Nobody is flipping cards: duel cancelled')
        this.unseat(0)
        this.unseat(1)
        this.reset()
        this.sync(now)
        return
      }
      this.finish(1 - i, i, 'afk', now)
      return
    }
    const session = this.seats[i]
    if (session) this.room.bubble(session, 'Too slow! 🐢')
    this.up = []
    this.passTurn(now)
  }

  /** A player uses a power-up (once each per duel, on their own turn). */
  power(session, id, now) {
    const i = this.seatOf(session)
    if (i < 0 || !this.canAct(i, now) || !POWER_IDS.has(id)) return
    if (this.used[i].has(id)) {
      session.toast('You already used that power-up this duel')
      return
    }
    const hidden = []
    for (let p = 0; p < CARD_COUNT; p += 1) if (this.owner[p] < 0 && !this.up.includes(p)) hidden.push(p)
    const opponent = this.seats[1 - i]

    if (id === 'peek') {
      if (!hidden.length) return session.toast('No hidden cards to peek at')
      const p = hidden[randomInt(hidden.length)]
      session.send('reveal', { kind: 'peek', ms: C.peekMs, cards: [{ i: p, f: code(this.faces[p]) }] })
    } else if (id === 'shuffle') {
      if (hidden.length < 2) return session.toast('Not enough hidden cards to shuffle')
      const mixed = shuffleInPlace(hidden.map((p) => this.faces[p]))
      hidden.forEach((p, k) => {
        this.faces[p] = mixed[k]
      })
      this.room.broadcast('fx', { kind: 'shuffle', table: this.id, id: session.id })
      opponent?.toast(`🔀 ${session.player.name} shuffled the cards!`)
    }

    this.used[i].add(id)
    this.room.questEvent(session, 'power', now)
    const p = DATA.powers.find((x) => x.id === id)
    this.room.bubble(session, `${p.name}! ${p.icon}`)
    this.room.broadcast('fx', { kind: 'power', id: session.id, power: id })
    this.sync(now)
  }

  /**
   * Ends the duel. A quitter (`reason` 'forfeit') pays DATA.forfeit.penalty, which
   * goes to the winner on top of the prize. A loser still in their seat is launched
   * out of it by their chair, then respawns in the lobby while the winner dances.
   */
  finish(w, l, reason, now) {
    this.phase = 'ended'
    this.endsAt = now + T.results * 1000
    this.winner = w
    this.up = []

    const winner = this.seats[w]
    const loser = this.seats[l]
    let reward = 0

    const played = reason === 'cards'
    const penalty = reason === 'forfeit' && loser ? this.room.takeCash(loser, DATA.forfeit.penalty, now) : 0
    if (winner) {
      reward = this.room.recordWin(winner, { bigWin: played && this.score[w] - this.score[l] >= 4 }, now)
      if (penalty) reward += this.room.bonusCash(winner, penalty, now)
    }
    let consolation = 0
    if (loser) consolation = this.room.recordLoss(loser, now, reason)
    if (loser && played) this.room.bubble(loser, 'NOOO! 😭')
    if (winner) this.room.bubble(winner, reason === 'forfeit' ? 'GG 👍' : 'Too easy! 😎')

    this.room.broadcast('result', {
      table: this.id,
      winner: winner?.id ?? null,
      loser: loser?.id ?? null,
      score: [...this.score],
      reward,
      consolation,
      penalty,
      reason,
    })
    this.sync(now)
    // Duel end: report leaderboard scores now rather than at the next batch.
    this.room.flushScores()

    const token = this.token
    const stillSeated = () => this.token === token && loser && this.seats[l] === loser
    this.room.clock.setTimeout(() => {
      if (stillSeated()) this.room.broadcast('fx', { kind: 'eject', id: loser.id, by: winner?.id ?? '' })
    }, EJECT_AT_S * 1000)
    this.room.clock.setTimeout(() => {
      if (!stillSeated()) return
      this.unseat(l)
      loser.respawn()
      this.sync(Date.now())
    }, T.loserRespawn * 1000)
  }

  tick(now) {
    if (this.phase === 'waiting' || now < this.endsAt) return

    if (this.phase === 'countdown') {
      this.deal(now)
    } else if (this.phase === 'deal') {
      this.startTurn(this.turn, now)
    } else if (this.phase === 'turn') {
      if (now > this.endsAt + GRACE_MS) this.timeout(now)
    } else if (this.phase === 'reveal') {
      this.afterReveal(now)
    } else if (this.phase === 'ended') {
      this.unseat(0)
      this.unseat(1)
      this.reset()
      this.sync(now)
    }
  }

  /**
   * The public board: one character per card, '.' while hidden, else its face.
   * Every face shows once the duel has ended.
   */
  boardString() {
    if (!this.faces.length) return '.'.repeat(CARD_COUNT)
    let s = ''
    for (let p = 0; p < CARD_COUNT; p += 1) {
      const shown = this.owner[p] >= 0 || this.up.includes(p) || this.phase === 'ended'
      s += shown ? code(this.faces[p]) : '.'
    }
    return s
  }

  /** Who matched each card: '0' / '1', 'u' for a card up this turn, '-' otherwise. */
  ownerString() {
    let s = ''
    for (let p = 0; p < CARD_COUNT; p += 1) {
      if (this.owner[p] >= 0) s += String(this.owner[p])
      else s += this.up.includes(p) ? 'u' : '-'
    }
    return s
  }

  privateState(i, now) {
    const o = 1 - i
    const ended = this.phase === 'ended'
    let turn = null
    if (this.turn >= 0 && this.phase !== 'ended') turn = this.turn === i ? 'me' : 'them'
    return {
      table: this.id,
      seat: i,
      phase: this.phase,
      endsInMs: Math.max(0, this.endsAt - now),
      turn,
      turnNo: this.turnNo,
      myScore: this.score[i],
      theirScore: this.score[o],
      combo: this.turn === i ? this.combo : 0,
      used: [...this.used[i]],
      theirUsed: [...this.used[o]],
      won: ended && this.winner === i,
      opponent: this.seats[o]?.id ?? null,
    }
  }

  /**
   * Publishes the table: the public part through the synced state (Colyseus sends
   * only fields that changed), the private part to each seated player.
   */
  sync(now = Date.now()) {
    const st = this.state
    st.phase = this.phase
    st.seat0 = this.seats[0]?.id ?? ''
    st.seat1 = this.seats[1]?.id ?? ''
    st.chair0 = this.seats[0]?.profile.equippedChair ?? ''
    st.chair1 = this.seats[1]?.profile.equippedChair ?? ''
    st.winner = this.phase === 'ended' ? (this.seats[this.winner]?.id ?? '') : ''
    st.endsAt = this.phase === 'waiting' ? 0 : this.endsAt
    st.turn = this.phase === 'turn' || this.phase === 'reveal' ? this.turn : -1
    st.score0 = this.score[0]
    st.score1 = this.score[1]
    st.board = this.boardString()
    st.owners = this.ownerString()
    st.hit = this.phase === 'reveal' && this.hit
    this.seats.forEach((s, i) => s?.send('match', { match: this.privateState(i, now) }))
  }
}

module.exports = Table
