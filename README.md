# NYASATECH1 Games

Chess and Malawi Checkers — local play, AI opponents (Beginner → Impossible),
and real-time online multiplayer with private rooms.

This is v2 of the project: the original front end (`index.html`, `app.js`,
`style.css`) is preserved and upgraded in place — see `UPGRADE_PLAN.md` for
exactly what changed and why. New in this version: a real search-based AI
for both games, a Node/Express/Socket.IO backend for matchmaking and
private rooms, and visual polish (last-move highlight, check indicator,
captured-piece trays, checkmate flourish).

## Project structure

```
index.html              SPA shell (all views)
app.js                  Client game logic, rendering, socket wiring
style.css                Design system + board/piece styling
js/chess-engine.js       Chess AI (minimax/alpha-beta/iterative deepening)
js/checkers-engine.js    Checkers AI (full capture-chain search)
server.js                Express + Socket.IO entrypoint
server/rooms.js          Private room create/join/rejoin
server/matchmaking.js    Skill-based matchmaking queue
server/socketHandlers.js Socket.IO events + server-side move validation
shared/checkersRules.js  Server-side copy of the checkers rules (see note below)
render.yaml               Render deployment blueprint
package.json
.env.example
```

## Local development

Requires Node.js 18+.

```bash
npm install
cp .env.example .env
npm start
```

Then open `http://localhost:3000`. The client automatically connects to
the Socket.IO server on the same origin — no extra configuration needed
for local dev.

## Deploying to Render

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and point it at the repo —
   `render.yaml` at the project root configures the service automatically
   (Node web service, `npm install` build step, `npm start` run command,
   `/healthz` health check).
3. Once deployed, set `CORS_ORIGIN` in the service's Environment tab to
   your Render URL (e.g. `https://nyasatech1games.onrender.com`) instead
   of `*`, for a tighter production CORS policy.
4. Render assigns `PORT` automatically — `server.js` already reads
   `process.env.PORT`, so no changes are needed there.

If you'd rather configure the service manually instead of using the
blueprint: Build Command `npm install`, Start Command `npm start`,
Health Check Path `/healthz`.

## Private rooms

- **Create Room** (in the online-play screen) generates a 6-character
  code and an invite link of the form `https://your-domain/room/ABCD12`.
- **Join Room** accepts either the typed code or opening the invite link
  directly — `server.js` serves the SPA for any `/room/:code` path, and
  `app.js` reads the code out of the URL on load and prompts to join.
- The match starts automatically once both seats are filled.

## Known duplication (by design, documented)

`shared/checkersRules.js` on the server intentionally duplicates the rule
functions (`getPieceCaptures`, `getPieceNormals`, `getCheckersMoves`,
`initCheckersBoard`) that already live in `app.js` on the client. The
client can't `require()` a shared module today because it's loaded as a
plain `<script>` tag with no bundler — see `UPGRADE_PLAN.md` for the
follow-up recommendation (a small bundler step) that would let both sides
import one real source of truth instead. Until then, **any checkers rule
change must be made in both files.**

## AI engines

Both `js/chess-engine.js` and `js/checkers-engine.js` are plain
`window.NyasaChessAI` / `window.NyasaCheckersAI` globals with no
dependency beyond `chess.js` (chess) already being loaded. They can be
opened directly in a browser console and called as
`NyasaChessAI.chooseMove(chessInstance, 'Grandmaster')` for debugging.
See `UPGRADE_PLAN.md` for the search techniques implemented and their
practical depth/time trade-offs.
