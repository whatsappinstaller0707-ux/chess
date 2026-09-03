# NYASATECH1 Games — Upgrade Plan (v1 → v2)

Your brief said: don't rewrite, upgrade — analyze, patch, and explain where
each change lives. This document is that account. Everything described
here has been applied to the copy of your project in this delivery and
tested (see "How this was verified" at the end); nothing is prose-only.

---

## 1. Architecture as found

Three files, no build step, no server:

- **`index.html`** — a single-page app: splash screen → onboarding →
  mode-select → matchmaking-search → game arena, all as toggled
  `<section class="view-section">` blocks.
- **`app.js`** — everything else: a shared `GAME_STATE` object drives
  both Chess (via `chess.js`, loaded from a CDN) and Malawi Checkers
  (a hand-written rules engine — `initCheckersBoard`,
  `getPieceCaptures`, `getPieceNormals`, `getCheckersMoves`), one
  `renderBoard()`/`executeMove()` pair for both games, a local XP/level
  profile system in `localStorage`, and a client-only `socket = io()`
  call with no server behind it.
- **`style.css`** — 8 CSS-variable themes, board/piece styling, cards,
  modals.

## 2. Weaknesses identified

| Area | What was there | Why it's a problem |
|---|---|---|
| Chess AI | `selectBestAiMove()` scores each candidate move with one static heuristic call (`evaluateMoveHeuristic`) and picks the best — zero-ply, no look-ahead at all | Loses to almost any deliberate play; can't see a move-away capture |
| Checkers AI | Same single-ply heuristic; multi-jump chains are decided one jump at a time, so the AI can't compare "capture 1 now" vs "capture 3 via a different first jump" | Structurally can't find the strategic multi-capture sequences the ruleset is built around |
| Multiplayer | `socket = io()` with no server; `find_match`/`opponent_moved` handlers exist client-side but nothing ever emits them | Online play doesn't function at all today |
| Private rooms | Not present | Feature gap |
| Move validation | 100% client-trusted | A modified client could play illegal moves against a real opponent |
| Reconnection | Not present | Any dropped connection ends the match |
| Visuals | Flat single-color piece SVGs, no last-move/check indicators, no captured-piece display | Functional but not "premium" |
| Deployment | No `package.json`, no server entrypoint, nothing Render can run | Can't be deployed as-is |

## 3. What was changed, and where

### 3.1 Chess AI — `js/chess-engine.js` (new file)

A new `window.NyasaChessAI` module. Implements, in the order your spec
listed them:

- **Minimax + alpha-beta pruning** — standard recursion with
  alpha/beta cutoffs (`search()`).
- **Iterative deepening** — `chooseMove()` runs `search()` at depth
  1, 2, 3… up to the difficulty's target depth, stopping early if the
  time budget runs out or a forced mate is found. This is what makes
  "9+ ply" honest on Grandmaster/Impossible: the engine searches as
  deep as it can within its time budget and reports how deep it
  actually got (`getLastSearchInfo()`), rather than claiming a fixed
  depth it can't reliably reach on every position.
- **Move ordering** — transposition-table best move first, then
  MVV-LVA-scored captures, then killer moves (two per ply), then a
  history heuristic table. This is what makes alpha-beta pruning
  actually effective at these depths.
- **Piece-square tables** — per-piece-type tables (`PST`), with a
  separate king table for middlegame vs endgame (`isEndgame()` checks
  queen/minor-piece count).
- **Quiescence search** — `quiescence()` extends the search at leaf
  nodes through capture sequences only, so the engine doesn't misjudge
  a position mid-exchange (the classic "horizon effect").
- **Opening book** — a small hand-built book (`OPENING_BOOK`), keyed
  by the SAN move sequence played so far, covering common first moves
  for e4/d4/c4/Nf3 openings. Only used above Easy difficulty.
- **Endgame heuristics** — passed-pawn, doubled/isolated-pawn, and
  bishop-pair terms in `evaluate()`, plus the king PST swap at
  endgame.
- **Transposition table** — a `Map` keyed on FEN string, storing
  score/depth/flag/best-move, cleared once it exceeds ~250k entries.

**On "king safety, forks, pins, skewers, discovered attacks" specifically:**
real engines don't hand-code pattern detectors for these — they fall out
of the search itself once it's deep enough and the move ordering is good
enough to explore the right lines. That's the architecture delivered here.
I did *not* add bolt-on "if this looks like a pin, add points" heuristics,
because they tend to double-count what the search already finds and can
actively mislead a shallow search. Castling-rights and pawn-shield terms
are included as cheap proxies for king safety in `evaluate()`.

**Difficulty table** (`DIFFICULTY` in `chess-engine.js`):

| Level | Target depth | Time budget | Notes |
|---|---|---|---|
| Beginner | 1 | 250ms | 50% chance of a random legal move |
| Easy | 2 | 350ms | 30% blunder chance |
| Medium | 4 | 700ms | Book enabled |
| Hard | 6 | 1200ms | |
| Expert | 8 | 2200ms | |
| Master | 9 | 3000ms | |
| Grandmaster | 10 | 4200ms | |
| Impossible | 14 | 6000ms | Strongest browser-safe config |

These are constants — tune `timeMs` per level if a deployment target
needs faster/slower responses.

### 3.2 Checkers AI — `js/checkers-engine.js` (new file)

A new `window.NyasaCheckersAI` module, deliberately not duplicating
your rules. It calls the existing global `getPieceCaptures()` and
`getPieceNormals()` functions from `app.js` directly — same rules, one
source of truth on the client.

The key structural fix: `enumerateFullMoves()` DFS-walks every capture
chain to completion (`dfsChain()`), so the AI evaluates and searches over
entire turns, not individual jumps. That's what lets it find sacrifice
combinations and choose the better of two different capture sequences,
not just the first legal jump.

Minimax + alpha-beta runs over these full-turn moves
(`search()`/`chooseChain()`) with the same iterative-deepening/time-budget
pattern as chess. Evaluation (`evaluate()`) weighs material, king value,
advancement/promotion-proximity, and center/back-row control; "trap
creation" is, like chess tactics, an emergent property of search depth
rather than a hand-coded pattern.

**Difficulty table** (`DIFFICULTY` in `checkers-engine.js`): depth 2/250ms
at Beginner up through depth 14/5000ms at Impossible, with blunder
chance tapering to 0 at Hard and above.

### 3.3 Wiring the engines into the existing game loop — `app.js`

`app.js` keeps its exact `executeMove()`/`renderBoard()` animation
pipeline. What changed:

- **`GAME_STATE`** gained `aiPlannedChain`, `aiPlannedIndex`,
  `playerToken`, `lastMove`, `capturedByWhite`, `capturedByBlack`.
  All are reset in `resetGame()`.
- **`triggerAiTurn()`** now branches by game type into
  `triggerCheckersAiTurn()` / `triggerChessAiTurn()` (both new
  functions, same file). Checkers plans the whole chain once via
  `NyasaCheckersAI.chooseChain()`, then plays it back one step per
  `executeMove()` call — so the existing multi-jump animation/locking
  logic (`activeMultiJumpSquare`) is untouched, it's just now fed a
  pre-computed optimal sequence instead of one greedy jump at a time.
  Chess calls `NyasaChessAI.chooseMove()` and converts its chess.js
  verbose move back into your `{from:[r,c], to:[r,c]}` shape
  (`chessVerboseToInternal()`) so `executeMove()` needed no changes at
  all for chess.
- **Fallback safety**: if either engine script fails to load for any
  reason, both trigger functions fall back to the original
  `selectBestAiMove()` heuristic rather than breaking the turn. That
  function is left in place, unused in the normal path.
- **`executeMove()`** gained capture tracking (pushes the captured
  piece into `capturedByWhite`/`capturedByBlack`) and last-move
  tracking, both feeding the visual upgrades below. The one behavioral
  change: AI-chosen promotions now respect `move.promotion` if the
  engine picked an underpromotion, falling back to `'q'` exactly as
  before for ordinary human clicks.

### 3.4 Online multiplayer — new `server.js`, `server/*`, `shared/checkersRules.js`

A real backend, since none existed:

- **`server.js`** — Express serves the static SPA and a `/room/:code`
  route (for invite links); Socket.IO wraps the same HTTP server.
- **`server/rooms.js`** — in-memory room store. `createRoom()`
  generates a 6-character code from an ambiguity-free alphabet (no
  0/O/1/I). `joinRoom()`/`rejoinRoom()` handle the create → join →
  auto-start flow and reconnection by `playerToken` (a client-persisted
  id in `localStorage`, separate from the ephemeral socket id).
- **`server/matchmaking.js`** — a queue per game type. `tryMatch()`
  pairs the longest-waiting player with the closest-rated opponent
  within a tolerance that widens the longer they've waited, so a match
  is still found quickly in a small pool. The client's existing 10s
  countdown-then-bot-substitution logic is untouched — the server just
  gives it a real match to find first, per your "only use bot
  substitution when no player found or timer expires" requirement.
- **`server/socketHandlers.js`** — wires every event: `find_match`,
  `create_room`, `join_room`, `rejoin_room`, `make_move`, `disconnect`.
  Move validation happens here before a move is relayed: chess moves
  are replayed through a server-side `chess.js` instance
  (`validateAndApplyChessMove`), checkers moves through
  `shared/checkersRules.js`'s `isMoveLegal()`/`applyMove()`
  (`validateAndApplyCheckersMove`). An invalid move is silently
  rejected and the sender gets a `state_sync` correction instead of
  being relayed to the opponent — this is the anti-cheat layer.
  Disconnect handling: on `disconnect`, the opponent is told
  `opponent_reconnecting`; a 30-second grace timer either clears (the
  player's socket reconnects and calls `rejoin_room`) or fires
  `opponent_forfeited` to award the win.
- **`shared/checkersRules.js`** — a server-side copy of
  `getPieceCaptures`/`getPieceNormals`/`getCheckersMoves`/
  `initCheckersBoard` plus `applyMove`/`isMoveLegal`. See the
  "Known duplication" note below — this is real, acknowledged
  duplication, not an oversight.
- **`app.js`** client changes: `getPlayerToken()` (persists a
  reconnect id), a `connect` handler that calls `rejoin_room` if a
  match was active, handlers for `room_created` / `room_join_error` /
  `room_ready` / `opponent_reconnecting` / `opponent_back` /
  `opponent_forfeited` / `state_sync`, and `createPrivateRoom()` /
  `joinPrivateRoom()` / `showRoomInviteModal()` /
  `checkRoomCodeInUrl()` helpers. `find_match`'s payload now includes
  a `rating` computed by the new `computePlayerRating()` (a rough proxy
  from the existing local XP/win/loss numbers — see the note on Elo
  below).

### 3.5 Private room UI — `index.html`

The online-play mode-select screen gained a second card ("Private
Room") with a Create Room button and a code-entry field with a Join
button, next to the existing matchmaking card. `server.js`'s
`/room/:code` route plus `app.js`'s `checkRoomCodeInUrl()` (run once on
startup) mean an invite link like `https://your-domain/room/ABCD12`
opens the SPA and prompts to join that exact room.

### 3.6 Visual upgrade — `style.css` + `app.js`'s `renderBoard()`

Kept intentionally lighter-touch, per your stated priority order
(AI > multiplayer > visuals):

- **Last-move highlight** — `.last-move-from`/`.last-move-to` classes,
  driven by the new `GAME_STATE.lastMove`.
- **Check indicator** — a pulsing red glow on the checked king's
  square (`.king-in-check`, `findKingInCheckSquare()`).
- **Checkmate flourish** — `.checkmate-flash` animates the board
  border/glow twice before the existing "Game Over" alert fires.
- **Captured-piece trays** — two new `.captured-tray` strips above/
  below the board (added in `index.html`), populated by
  `renderCapturedTrays()`.
- **Wooden board surface** — a `.board-wood` gradient treatment layered
  on top of your existing theme system (still fully respects all 8
  `body.theme-*` variables — it's a gradient built from the same
  `--board-light`/`--board-dark` custom properties, not a hardcoded
  replacement).
- **Piece animations** — a settle-in animation on render and a
  capture-pop animation class (`captured-piece`) available for pieces
  leaving the board.

Not done in this pass (flagged as a follow-up, since your priority
order put visuals third): a full custom Staunton-style piece SVG set,
drag-and-drop piece movement, and a dedicated light/dark toggle
separate from the existing 8-theme system (the existing `theme-light`
already covers this reasonably well).

## 4. Known duplication (and why it's there)

`shared/checkersRules.js` duplicates four functions that also live in
`app.js`. This is the one place this upgrade didn't fully satisfy
"minimize duplicated code," and it's worth being direct about why: your
client is loaded as plain `<script>` tags with no bundler, so it can't
`require()`/`import` a Node module. The honest fix is a small build step
(esbuild or Vite, e.g.) that lets both the client bundle and the server
import the same `shared/checkersRules.js`. That's a real but contained
change (one new dev dependency, one build command, no behavior change),
and I've deliberately left it out of this delivery rather than bundling
it in unannounced — it changes your deployment step in a way you should
sign off on first. Until then: a checkers rule change must be made in
both `app.js` and `shared/checkersRules.js`.

## 5. Not implemented (scope called out explicitly)

- **Real Elo/rating persistence.** `computePlayerRating()` is a rough
  client-side proxy from your existing local XP/win/loss numbers so
  matchmaking has something to sort by today. A real Elo system needs
  server-side accounts and a database (Postgres, Redis, etc.) — out of
  scope for an in-memory Socket.IO server, and a genuinely separate
  piece of work (auth, persistence, migrations).
- **Web Worker offloading for the AI.** Grandmaster/Impossible chess
  can legitimately use its full 4-6 second time budget on a real
  position, which blocks the main thread for that long. Moving
  `chess-engine.js`/`checkers-engine.js` into a Web Worker would let
  the UI stay responsive during that think time. Structuring for that
  now (both engines are already dependency-light, pure-function modules)
  is straightforward but wasn't in this pass's scope.
- **Match history / stats dashboard / achievement system beyond what
  the client already tracks locally.** These need the same
  server-side persistence layer as real Elo, above.

## 6. How this was verified

No network access was available while building this, so nothing here
was tested against a live npm install of `chess.js`/`express`/
`socket.io` — that's the one gap you should close by running
`npm install && npm start` yourself before deploying. Everything else
was verified directly:

- Both AI engines were run through full AI-vs-AI simulations — chess
  against a lightweight mock of the `chess.js` API to exercise the
  search/TT/quiescence control flow (confirmed no crashes, correct
  time-budget behavior, depth scaling from 1 to 14 across difficulty
  levels), and checkers against your actual, unmodified rule functions
  extracted from `app.js` (confirmed legal multi-capture chains,
  correct promotion-mid-chain handling, and — critically — that a
  stronger difficulty consistently beats a weaker one).
- `server/rooms.js` and `server/matchmaking.js` were unit-tested
  directly (room creation/join/full-room rejection/rejoin, and
  rating-tolerance-based match pairing).
- `shared/checkersRules.js`'s validation primitives
  (`isMoveLegal`/`applyMove`) were tested against real board state,
  including a fabricated illegal move being correctly rejected.
- Every changed/new JavaScript file passes `node --check` (syntax
  validation). HTML/CSS were checked for balanced tags/braces after
  patching.
- The four core checkers rule functions in `app.js`
  (`initCheckersBoard`, `getPieceCaptures`, `getPieceNormals`,
  `getCheckersMoves`) were diffed byte-for-byte against your original
  upload and confirmed unchanged — the upgrade is additive there,
  as promised.
