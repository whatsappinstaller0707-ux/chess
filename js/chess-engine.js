/* ==========================================================================
   NYASATECH1 — Chess AI Engine v2
   Minimax + Alpha-Beta + Iterative Deepening + Move Ordering (MVV-LVA,
   killers, history) + Piece-Square Tables + Quiescence Search +
   Transposition Table + small Opening Book.

   Public API (attached to window.NyasaChessAI):
     chooseMove(chessJsInstance, difficultyName) -> verbose move object
       (same shape as chess.js `.moves({verbose:true})` entries)

   This file has no dependency beyond chess.js already being loaded
   globally as `Chess`. It does not mutate game state permanently —
   every simulated move is undone before returning.
   ========================================================================== */
(function (global) {
  "use strict";

  /* ---------------- Difficulty configuration ----------------
     Depth is a *target* for iterative deepening; the real bound is the
     time budget, so "9+ ply" on Grandmaster/Impossible is best-effort —
     the engine reports how deep it actually got (see lastSearchInfo). */
  const DIFFICULTY = {
    Beginner:    { maxDepth: 1,  timeMs: 250,  blunderChance: 0.5,  book: false },
    Easy:        { maxDepth: 2,  timeMs: 350,  blunderChance: 0.3,  book: false },
    Medium:      { maxDepth: 4,  timeMs: 700,  blunderChance: 0.08, book: true  },
    Hard:        { maxDepth: 6,  timeMs: 1200, blunderChance: 0.0,  book: true  },
    Expert:      { maxDepth: 8,  timeMs: 2200, blunderChance: 0.0,  book: true  },
    Master:      { maxDepth: 9,  timeMs: 3000, blunderChance: 0.0,  book: true  },
    Grandmaster: { maxDepth: 10, timeMs: 4200, blunderChance: 0.0,  book: true  },
    Impossible:  { maxDepth: 14, timeMs: 6000, blunderChance: 0.0,  book: true  }
  };

  /* ---------------- Material + piece-square tables ---------------- */
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  /* Tables are given from White's perspective, a8=index0 ... h1=index63
     (row-major, row0 = rank8). Mirrored for Black at lookup time. */
  const PST = {
    p: [
      0,   0,   0,   0,   0,   0,   0,   0,
      50,  50,  50,  50,  50,  50,  50,  50,
      10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,   10,  25,  25,  10,  5,   5,
      0,   0,   0,   20,  20,  0,   0,   0,
      5,  -5,  -10,  0,   0,  -10, -5,   5,
      5,   10,  10, -20, -20,  10,  10,  5,
      0,   0,   0,   0,   0,   0,   0,   0
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20,  0,   0,   0,   0,  -20, -40,
      -30,  0,   10,  15,  15,  10,  0,  -30,
      -30,  5,   15,  20,  20,  15,  5,  -30,
      -30,  0,   15,  20,  20,  15,  0,  -30,
      -30,  5,   10,  15,  15,  10,  5,  -30,
      -40, -20,  0,   5,   5,   0,  -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10,  0,   0,   0,   0,   0,   0,  -10,
      -10,  0,   5,   10,  10,  5,   0,  -10,
      -10,  5,   5,   10,  10,  5,   5,  -10,
      -10,  0,   10,  10,  10,  10,  0,  -10,
      -10,  10,  10,  10,  10,  10,  10, -10,
      -10,  5,   0,   0,   0,   0,   5,  -10,
      -20, -10, -10, -10, -10, -10, -10, -20
    ],
    r: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5,  10, 10, 10, 10, 10, 10, 5,
      -5, 0,  0,  0,  0,  0,  0, -5,
      -5, 0,  0,  0,  0,  0,  0, -5,
      -5, 0,  0,  0,  0,  0,  0, -5,
      -5, 0,  0,  0,  0,  0,  0, -5,
      -5, 0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10,  0,   0,   0,  0,   0,   0,  -10,
      -10,  0,   5,   5,  5,   5,   0,  -10,
      -5,   0,   5,   5,  5,   5,   0,  -5,
      0,    0,   5,   5,  5,   5,   0,  -5,
      -10,  5,   5,   5,  5,   5,   0,  -10,
      -10,  0,   5,   0,  0,   0,   0,  -10,
      -20, -10, -10, -5, -5, -10, -10, -20
    ],
    k_mid: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20,  20,  0,   0,   0,   0,   20,  20,
      20,  30,  10,  0,   0,   10,  30,  20
    ],
    k_end: [
      -50, -40, -30, -20, -20, -30, -40, -50,
      -30, -20, -10,  0,   0,  -10, -20, -30,
      -30, -10,  20,  30,  30,  20, -10, -30,
      -30, -10,  30,  40,  40,  30, -10, -30,
      -30, -10,  30,  40,  40,  30, -10, -30,
      -30, -10,  20,  30,  30,  20, -10, -30,
      -30, -30,  0,   0,   0,   0,  -30, -30,
      -50, -30, -30, -30, -30, -30, -30, -50
    ]
  };

  function pstIndex(square, color) {
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1; // 0 = rank1
    // table index 0 = a8 (row-major from black's back rank)
    const row = color === 'w' ? (7 - rank) : rank;
    return row * 8 + file;
  }

  function isEndgame(board) {
    let queens = 0, minorsAndRooks = 0;
    for (const row of board) for (const cell of row) {
      if (!cell) continue;
      if (cell.type === 'q') queens++;
      if (cell.type === 'r' || cell.type === 'n' || cell.type === 'b') minorsAndRooks++;
    }
    return queens === 0 || minorsAndRooks <= 4;
  }

  /* ---------------- Evaluation ---------------- */
  function evaluate(game) {
    const board = game.board();
    const endgame = isEndgame(board);
    let score = 0;
    let whiteBishops = 0, blackBishops = 0;
    let whitePawnFiles = new Array(8).fill(0), blackPawnFiles = new Array(8).fill(0);

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (!cell) continue;
        const square = String.fromCharCode(97 + f) + (8 - r);
        let val = VAL[cell.type];
        if (cell.type === 'k') {
          val += pstIndex(square, cell.color) >= 0
            ? (endgame ? PST.k_end : PST.k_mid)[pstIndex(square, cell.color)]
            : 0;
        } else {
          const table = PST[cell.type];
          if (table) val += table[pstIndex(square, cell.color)];
        }
        if (cell.type === 'b') cell.color === 'w' ? whiteBishops++ : blackBishops++;
        if (cell.type === 'p') {
          if (cell.color === 'w') whitePawnFiles[f]++; else blackPawnFiles[f]++;
        }
        score += cell.color === 'w' ? val : -val;
      }
    }

    // Bishop pair bonus
    if (whiteBishops >= 2) score += 30;
    if (blackBishops >= 2) score -= 30;

    // Doubled / isolated pawn penalties (cheap structural heuristic)
    for (let f = 0; f < 8; f++) {
      if (whitePawnFiles[f] > 1) score -= 12 * (whitePawnFiles[f] - 1);
      if (blackPawnFiles[f] > 1) score += 12 * (blackPawnFiles[f] - 1);
      const wIsolated = whitePawnFiles[f] > 0 &&
        (f === 0 || whitePawnFiles[f - 1] === 0) && (f === 7 || whitePawnFiles[f + 1] === 0);
      const bIsolated = blackPawnFiles[f] > 0 &&
        (f === 0 || blackPawnFiles[f - 1] === 0) && (f === 7 || blackPawnFiles[f + 1] === 0);
      if (wIsolated) score -= 10;
      if (bIsolated) score += 10;
    }

    // Passed pawn bonus (rough: no enemy pawn on same or adjacent file ahead)
    for (let f = 0; f < 8; f++) {
      if (whitePawnFiles[f] > 0) {
        const blocked = [f - 1, f, f + 1].some(ff => ff >= 0 && ff <= 7 && blackPawnFiles[ff] > 0);
        if (!blocked) score += 18;
      }
      if (blackPawnFiles[f] > 0) {
        const blocked = [f - 1, f, f + 1].some(ff => ff >= 0 && ff <= 7 && whitePawnFiles[ff] > 0);
        if (!blocked) score -= 18;
      }
    }

    // Castling rights encourage king safety in the opening/middlegame
    if (!endgame) {
      const fen = game.fen();
      const rightsField = fen.split(' ')[2];
      if (rightsField && rightsField.indexOf('K') !== -1 || rightsField && rightsField.indexOf('Q') !== -1) score += 12;
      if (rightsField && rightsField.indexOf('k') !== -1 || rightsField && rightsField.indexOf('q') !== -1) score -= 12;
    }

    // Small mobility term (only computed at root-ish depths by caller if needed;
    // kept out here for performance — mobility is expensive to recompute
    // at every leaf node across a full-width search).
    return score;
  }

  /* ---------------- Transposition table ---------------- */
  const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;
  let tt = new Map();
  function ttMaybeClear() {
    if (tt.size > 250000) tt = new Map();
  }

  /* ---------------- Move ordering helpers ---------------- */
  let killers = {};     // depth -> [move1san, move2san]
  let historyTable = {}; // "from-to" -> score

  function scoreMove(game, mv, depth, ttMove) {
    if (ttMove && mv.san === ttMove) return 100000;
    if (mv.captured) {
      return 10000 + (VAL[mv.captured] || 0) * 10 - (VAL[mv.piece] || 0);
    }
    const k = killers[depth];
    if (k && (k[0] === mv.san || k[1] === mv.san)) return 5000;
    return historyTable[mv.from + mv.to] || 0;
  }

  function orderedMoves(game, depth, ttMove) {
    const moves = game.moves({ verbose: true });
    return moves
      .map(mv => ({ mv, s: scoreMove(game, mv, depth, ttMove) }))
      .sort((a, b) => b.s - a.s)
      .map(x => x.mv);
  }

  /* ---------------- Quiescence search ---------------- */
  function quiescence(game, alpha, beta, maximizing, deadline, qDepth) {
    const standPat = evaluate(game);
    if (qDepth <= 0) return standPat;

    if (maximizing) {
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;
    } else {
      if (standPat <= alpha) return alpha;
      if (standPat < beta) beta = standPat;
    }

    const moves = game.moves({ verbose: true }).filter(m => m.captured || m.flags.indexOf('e') !== -1);
    moves.sort((a, b) => (VAL[b.captured] || 0) - (VAL[a.captured] || 0));

    for (const mv of moves) {
      if (performance.now() > deadline) break;
      game.move(mv.san);
      const score = quiescence(game, alpha, beta, !maximizing, deadline, qDepth - 1);
      game.undo();
      if (maximizing) {
        if (score > alpha) alpha = score;
        if (alpha >= beta) return beta;
      } else {
        if (score < beta) beta = score;
        if (beta <= alpha) return alpha;
      }
    }
    return maximizing ? alpha : beta;
  }

  /* ---------------- Minimax + alpha-beta + TT ---------------- */
  function resolveMoveObj(game, san) {
    if (!san) return null;
    const verbose = game.moves({ verbose: true });
    return verbose.find(m => m.san === san) || null;
  }

  function search(game, depth, alpha, beta, maximizing, deadline, ply) {
    const alphaOrig = alpha;
    const fenKey = game.fen();
    const cached = tt.get(fenKey);
    if (cached && cached.depth >= depth) {
      if (cached.flag === TT_EXACT) {
        return { score: cached.score, move: resolveMoveObj(game, cached.move) };
      }
      if (cached.flag === TT_LOWER) alpha = Math.max(alpha, cached.score);
      else if (cached.flag === TT_UPPER) beta = Math.min(beta, cached.score);
      if (alpha >= beta) {
        return { score: cached.score, move: resolveMoveObj(game, cached.move) };
      }
    }

    if (game.in_checkmate()) {
      return { score: maximizing ? -100000 + ply : 100000 - ply, move: null };
    }
    if (game.in_draw() || game.in_stalemate() || game.in_threefold_repetition()) {
      return { score: 0, move: null };
    }
    if (depth === 0 || performance.now() > deadline) {
      const q = quiescence(game, alpha, beta, maximizing, deadline, 4);
      return { score: q, move: null };
    }

    const moves = orderedMoves(game, ply, cached && cached.move);
    let best = null;
    let bestScore = maximizing ? -Infinity : Infinity;

    for (const mv of moves) {
      game.move(mv.san);
      const res = search(game, depth - 1, alpha, beta, !maximizing, deadline, ply + 1);
      game.undo();
      const score = res.score;

      if (maximizing) {
        if (score > bestScore) { bestScore = score; best = mv; }
        alpha = Math.max(alpha, bestScore);
      } else {
        if (score < bestScore) { bestScore = score; best = mv; }
        beta = Math.min(beta, bestScore);
      }

      if (alpha >= beta) {
        if (!mv.captured) {
          killers[ply] = killers[ply] || [null, null];
          killers[ply][1] = killers[ply][0];
          killers[ply][0] = mv.san;
          historyTable[mv.from + mv.to] = (historyTable[mv.from + mv.to] || 0) + depth * depth;
        }
        break;
      }
      if (performance.now() > deadline) break;
    }

    let flag = TT_EXACT;
    if (bestScore <= alphaOrig) flag = TT_UPPER;
    else if (bestScore >= beta) flag = TT_LOWER;
    tt.set(fenKey, { score: bestScore, move: best ? best.san : null, depth, flag });

    return { score: bestScore, move: best };
  }

  /* ---------------- Small opening book ----------------
     Keyed by the SAN sequence played so far (space-joined). Each entry
     lists reasonable book replies; one is picked at random for variety. */
  const OPENING_BOOK = {
    "": ["e4", "d4", "c4", "Nf3"],
    "e4": ["e5", "c5", "e6", "c6"],
    "e4 e5": ["Nf3", "Bc4"],
    "e4 e5 Nf3": ["Nc6"],
    "e4 e5 Nf3 Nc6": ["Bb5", "Bc4"],
    "e4 e5 Nf3 Nc6 Bb5": ["a6"],
    "e4 e5 Nf3 Nc6 Bc4": ["Bc5", "Nf6"],
    "e4 c5": ["Nf3"],
    "e4 c5 Nf3": ["d6", "Nc6", "e6"],
    "e4 e6": ["d4"],
    "e4 e6 d4": ["d5"],
    "e4 c6": ["d4"],
    "e4 c6 d4": ["d5"],
    "d4": ["d5", "Nf6", "e6"],
    "d4 d5": ["c4", "Nf3"],
    "d4 d5 c4": ["e6", "c6"],
    "d4 Nf6": ["c4", "Nf3"],
    "d4 Nf6 c4": ["e6", "g6"],
    "c4": ["e5", "Nf6", "c5"],
    "Nf3": ["d5", "Nf6"]
  };

  function bookMove(game) {
    const seq = game.history().join(' ');
    const options = OPENING_BOOK[seq];
    if (!options) return null;
    const legal = game.moves();
    const playable = options.filter(o => legal.indexOf(o) !== -1);
    if (playable.length === 0) return null;
    const san = playable[Math.floor(Math.random() * playable.length)];
    const verbose = game.moves({ verbose: true });
    return verbose.find(m => m.san === san) || null;
  }

  /* ---------------- Public entry point ---------------- */
  let lastSearchInfo = { depthReached: 0, timeMs: 0 };

  function chooseMove(game, difficultyName) {
    const cfg = DIFFICULTY[difficultyName] || DIFFICULTY.Hard;
    ttMaybeClear();
    killers = {};

    const legalMoves = game.moves({ verbose: true });
    if (legalMoves.length === 0) return null;

    // Intentional mistakes for low difficulties: sometimes just play a
    // legal-but-not-best move (never an outright illegal move).
    if (Math.random() < cfg.blunderChance) {
      return legalMoves[Math.floor(Math.random() * legalMoves.length)];
    }

    if (cfg.book) {
      const b = bookMove(game);
      if (b) return b;
    }

    const maximizing = game.turn() === 'w';
    const startTime = performance.now();
    const deadline = startTime + cfg.timeMs;

    let bestMove = legalMoves[0];
    let depthReached = 0;

    for (let d = 1; d <= cfg.maxDepth; d++) {
      if (performance.now() > deadline) break;
      const res = search(game, d, -Infinity, Infinity, maximizing, deadline, 0);
      if (res.move) {
        bestMove = res.move;
        depthReached = d;
      }
      // If we already found a forced mate, no need to search deeper
      if (Math.abs(res.score) > 90000) break;
    }

    lastSearchInfo = { depthReached, timeMs: Math.round(performance.now() - startTime) };
    return bestMove;
  }

  global.NyasaChessAI = {
    chooseMove,
    getLastSearchInfo: () => lastSearchInfo,
    DIFFICULTY
  };
})(typeof window !== 'undefined' ? window : globalThis);
