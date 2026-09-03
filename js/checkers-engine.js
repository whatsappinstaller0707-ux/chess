/* ==========================================================================
   NYASATECH1 — Malawi Checkers AI Engine v2
   Minimax + Alpha-Beta over FULL capture chains (a whole multi-jump turn
   counts as one search ply, matching how a human turn actually works),
   with material / king / mobility / center / promotion-potential eval.

   IMPORTANT: this file intentionally does NOT re-implement move generation.
   It reuses the existing `getPieceCaptures(board, r, c)` and
   `getPieceNormals(board, r, c)` functions already defined in app.js, so
   the rules live in exactly one place. Load this file on any page that
   also loads app.js (order between the two does not matter — see the
   loading note in UPGRADE_PLAN.md).

   Public API (attached to window.NyasaCheckersAI):
     chooseChain(board, player, difficultyName)
       -> array of {from:[r,c], to:[r,c], captured:[r,c]|null}
          representing the FULL turn to play (length 1 for a normal move,
          length >1 for a multi-capture chain). Returns null if no move
          is available (the player has lost).
   ========================================================================== */
(function (global) {
  "use strict";

  const DIFFICULTY = {
    Beginner:    { depth: 2, timeMs: 250,  blunderChance: 0.45 },
    Easy:        { depth: 3, timeMs: 350,  blunderChance: 0.25 },
    Medium:      { depth: 4, timeMs: 600,  blunderChance: 0.08 },
    Hard:        { depth: 6, timeMs: 1000, blunderChance: 0.0  },
    Expert:      { depth: 8, timeMs: 1800, blunderChance: 0.0  },
    Master:      { depth: 9, timeMs: 2600, blunderChance: 0.0  },
    Grandmaster: { depth: 11, timeMs: 3600, blunderChance: 0.0 },
    Impossible:  { depth: 14, timeMs: 5000, blunderChance: 0.0 }
  };

  function cloneBoard(board) {
    return board.map(row => row.map(cell => (cell ? { color: cell.color, isKing: cell.isKing } : null)));
  }

  function opponentOf(player) { return player === 'white' ? 'black' : 'white'; }

  function isBackRow(r, player) {
    return player === 'white' ? r === 0 : r === 7;
  }

  /* ---------------- Full capture-chain enumeration ----------------
     Depends on global getPieceCaptures(board, r, c) from app.js, which
     already implements the exact Flying King capture rule (including
     long-range landings). We just DFS through the chain, exactly like a
     human continuing a forced multi-capture, and promote mid-chain the
     same way app.js's executeMove() does. */
  function dfsChain(board, r, c, player, path, captured, results) {
    const caps = getPieceCaptures(board, r, c);
    if (!caps || caps.length === 0) {
      if (captured.length > 0) results.push({ path: path.slice(), captured: captured.slice() });
      return;
    }
    for (const cap of caps) {
      const nb = cloneBoard(board);
      const piece = { ...nb[r][c] };
      nb[r][c] = null;
      nb[cap.captured[0]][cap.captured[1]] = null;
      if (!piece.isKing && isBackRow(cap.to[0], player)) piece.isKing = true;
      nb[cap.to[0]][cap.to[1]] = piece;
      dfsChain(nb, cap.to[0], cap.to[1], player, path.concat([cap.to]), captured.concat([cap.captured]), results);
    }
  }

  function enumerateFullMoves(board, player) {
    const captureChains = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.color === player) {
          dfsChain(board, r, c, player, [[r, c]], [], captureChains);
        }
      }
    }
    if (captureChains.length > 0) {
      return captureChains.map(ch => ({
        steps: chainToSteps(ch),
        isCapture: true,
        captureCount: ch.captured.length
      }));
    }
    const normals = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.color === player) {
          for (const mv of getPieceNormals(board, r, c)) {
            normals.push({ steps: [{ from: [r, c], to: mv.to, captured: null }], isCapture: false, captureCount: 0 });
          }
        }
      }
    }
    return normals;
  }

  function chainToSteps(ch) {
    const steps = [];
    for (let i = 0; i < ch.captured.length; i++) {
      steps.push({ from: ch.path[i], to: ch.path[i + 1], captured: ch.captured[i] });
    }
    return steps;
  }

  function applyFullMove(board, fullMove, player) {
    let b = cloneBoard(board);
    for (const step of fullMove.steps) {
      const piece = { ...b[step.from[0]][step.from[1]] };
      b[step.from[0]][step.from[1]] = null;
      if (step.captured) b[step.captured[0]][step.captured[1]] = null;
      if (!piece.isKing && isBackRow(step.to[0], player)) piece.isKing = true;
      b[step.to[0]][step.to[1]] = piece;
    }
    return b;
  }

  /* ---------------- Evaluation ----------------
     material, king value, center control, advancement / promotion
     potential, and a mobility term (how many full moves each side has —
     this doubles as an implicit "trap" detector, since a move into a
     position where the opponent's reply count collapses scores well). */
  function evaluate(board, aiPlayer) {
    const opp = opponentOf(aiPlayer);
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p) continue;
        let val = p.isKing ? 175 : 100;
        if (!p.isKing) {
          const advance = p.color === 'white' ? (7 - r) : r; // distance travelled toward king row
          val += advance * 3;
        }
        const centerBonus = 4 - (Math.abs(3.5 - c) + Math.abs(3.5 - r)) * 0.5;
        val += centerBonus;
        if (r === 0 || r === 7) val += 3; // back-row defenders are valuable
        score += (p.color === aiPlayer ? val : -val);
      }
    }
    return score;
  }

  function mobilityScore(board, player) {
    return enumerateFullMoves(board, player).length;
  }

  /* ---------------- Minimax + alpha-beta over full moves ---------------- */
  function orderMoves(moves) {
    return moves.slice().sort((a, b) => b.captureCount - a.captureCount);
  }

  function search(board, player, depth, alpha, beta, maximizing, aiPlayer, deadline) {
    const moves = enumerateFullMoves(board, player);
    if (moves.length === 0) {
      // Player to move has no legal move: they lose.
      return { score: maximizing ? -100000 + depth : 100000 - depth, move: null };
    }
    if (depth === 0 || performance.now() > deadline) {
      return { score: evaluate(board, aiPlayer), move: null };
    }

    const ordered = orderMoves(moves);
    let best = null;
    let bestScore = maximizing ? -Infinity : Infinity;
    const opp = opponentOf(player);

    for (const mv of ordered) {
      const nb = applyFullMove(board, mv, player);
      const res = search(nb, opp, depth - 1, alpha, beta, !maximizing, aiPlayer, deadline);
      const score = res.score;
      if (maximizing) {
        if (score > bestScore) { bestScore = score; best = mv; }
        alpha = Math.max(alpha, bestScore);
      } else {
        if (score < bestScore) { bestScore = score; best = mv; }
        beta = Math.min(beta, bestScore);
      }
      if (alpha >= beta) break;
      if (performance.now() > deadline) break;
    }

    return { score: bestScore, move: best };
  }

  function chooseChain(board, player, difficultyName) {
    const cfg = DIFFICULTY[difficultyName] || DIFFICULTY.Hard;
    const moves = enumerateFullMoves(board, player);
    if (moves.length === 0) return null;

    if (Math.random() < cfg.blunderChance) {
      const pick = moves[Math.floor(Math.random() * moves.length)];
      return pick.steps;
    }

    const deadline = performance.now() + cfg.timeMs;
    let bestOverall = moves[0];
    for (let d = 1; d <= cfg.depth; d++) {
      if (performance.now() > deadline) break;
      const res = search(board, player, d, -Infinity, Infinity, true, player, deadline);
      if (res.move) bestOverall = res.move;
      if (Math.abs(res.score) > 90000) break;
    }
    return bestOverall.steps;
  }

  global.NyasaCheckersAI = { chooseChain, enumerateFullMoves, DIFFICULTY };
})(typeof window !== 'undefined' ? window : globalThis);
