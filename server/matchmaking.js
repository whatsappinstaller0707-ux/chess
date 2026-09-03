/* ==========================================================================
   Skill-based matchmaking queue (in-memory, per game type).

   Players enqueue with a rough rating (derived from XP / win-loss record
   on the client, sent at find_match time). `tryMatch` looks for the
   closest-rated waiting opponent within a tolerance window that widens
   the longer someone has been waiting, so a match is still found quickly
   even in a small player pool. If nobody suitable is found, the caller
   (socketHandlers.js) leaves the player queued — the CLIENT already runs
   its own 10s timer and substitutes a bot if the server never finds a
   human match in time, so bot substitution only ever happens as a last
   resort, exactly as requested.
   ========================================================================== */

const queues = new Map(); // gameType -> array of { socketId, playerToken, name, rating, joinedAt }

function getQueue(gameType) {
  if (!queues.has(gameType)) queues.set(gameType, []);
  return queues.get(gameType);
}

function enqueue(gameType, entry) {
  const q = getQueue(gameType);
  // Replace any stale entry for the same socket first.
  const idx = q.findIndex(e => e.socketId === entry.socketId);
  if (idx !== -1) q.splice(idx, 1);
  q.push({ ...entry, joinedAt: Date.now() });
}

function dequeueBySocket(gameType, socketId) {
  const q = getQueue(gameType);
  const idx = q.findIndex(e => e.socketId === socketId);
  if (idx !== -1) q.splice(idx, 1);
}

function removeSocketEverywhere(socketId) {
  for (const gameType of queues.keys()) dequeueBySocket(gameType, socketId);
}

/* Tolerance widens the longer the FRONT of the queue has waited, so two
   very differently rated players can still eventually be paired rather
   than waiting forever for a perfect match. */
function toleranceFor(waitedMs) {
  if (waitedMs < 3000) return 75;
  if (waitedMs < 6000) return 150;
  if (waitedMs < 9000) return 400;
  return Infinity;
}

/* Call after enqueueing a new player: looks for the best opponent already
   waiting. Returns { a, b } (both removed from the queue) or null. */
function tryMatch(gameType) {
  const q = getQueue(gameType);
  if (q.length < 2) return null;

  // Try to pair the longest-waiting player with their closest-rated peer.
  q.sort((x, y) => x.joinedAt - y.joinedAt);
  const anchor = q[0];
  const tolerance = toleranceFor(Date.now() - anchor.joinedAt);

  let bestIdx = -1, bestDiff = Infinity;
  for (let i = 1; i < q.length; i++) {
    const diff = Math.abs((q[i].rating || 1000) - (anchor.rating || 1000));
    if (diff <= tolerance && diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  if (bestIdx === -1) return null;

  const b = q.splice(bestIdx, 1)[0];
  const a = q.splice(0, 1)[0];
  return { a, b };
}

module.exports = { enqueue, dequeueBySocket, removeSocketEverywhere, tryMatch };
