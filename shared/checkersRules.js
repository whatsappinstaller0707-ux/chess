/* ==========================================================================
   Shared Malawi Checkers rules — server-side copy.

   The browser client (app.js) can't `require()` this directly since it's
   loaded as a plain <script>, not a bundled module — so this is a
   deliberate, minimal duplication of the exact same rule functions that
   live in app.js's "MALAWI CHECKERS ENGINE RULES" section. If NYASATECH1
   later moves to a bundler (esbuild/webpack/vite), this file should
   become the single source of truth that both client and server import.
   Until then: any rule change must be made in BOTH places (see
   UPGRADE_PLAN.md "Known duplication" note).
   ========================================================================== */

function initCheckersBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 === 1) {
        if (r < 3) b[r][c] = { color: 'black', isKing: false };
        else if (r > 4) b[r][c] = { color: 'white', isKing: false };
      }
    }
  }
  return b;
}

function getPieceCaptures(board, r, c) {
  const p = board[r][c];
  const moves = [];
  const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  if (!p.isKing) {
    dirs.forEach(([dr, dc]) => {
      const mr = r + dr, mc = c + dc;
      const er = r + dr * 2, ec = c + dc * 2;
      if (er >= 0 && er < 8 && ec >= 0 && ec < 8) {
        const victim = board[mr] && board[mr][mc];
        if (victim && victim.color !== p.color && !board[er][ec]) {
          moves.push({ from: [r, c], to: [er, ec], captured: [mr, mc] });
        }
      }
    });
  } else {
    dirs.forEach(([dr, dc]) => {
      let step = 1;
      let victimPos = null;
      while (true) {
        const nr = r + dr * step, nc = c + dc * step;
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
        const sq = board[nr][nc];
        if (sq) {
          if (sq.color === p.color || victimPos) break;
          victimPos = [nr, nc];
        } else if (victimPos) {
          moves.push({ from: [r, c], to: [nr, nc], captured: victimPos });
        }
        step++;
      }
    });
  }
  return moves;
}

function getPieceNormals(board, r, c) {
  const p = board[r][c];
  const moves = [];
  if (!p.isKing) {
    const fwdDirs = p.color === 'white' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    fwdDirs.forEach(([dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && !board[nr][nc]) {
        moves.push({ from: [r, c], to: [nr, nc], captured: null });
      }
    });
  } else {
    const dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    dirs.forEach(([dr, dc]) => {
      let step = 1;
      while (true) {
        const nr = r + dr * step, nc = c + dc * step;
        if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8 || board[nr][nc]) break;
        moves.push({ from: [r, c], to: [nr, nc], captured: null });
        step++;
      }
    });
  }
  return moves;
}

function getCheckersMoves(board, player, lockedSquare) {
  let captures = [];
  let normalMoves = [];
  const checkSquare = (r, c) => {
    const p = board[r][c];
    if (p && p.color === player) {
      const caps = getPieceCaptures(board, r, c);
      if (caps.length > 0) captures.push(...caps);
      else if (captures.length === 0) normalMoves.push(...getPieceNormals(board, r, c));
    }
  };
  if (lockedSquare) {
    checkSquare(lockedSquare[0], lockedSquare[1]);
  } else {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) checkSquare(r, c);
  }
  return captures.length > 0 ? captures : normalMoves;
}

function applyMove(board, move) {
  const nb = board.map(row => row.map(cell => (cell ? { ...cell } : null)));
  const p = { ...nb[move.from[0]][move.from[1]] };
  nb[move.from[0]][move.from[1]] = null;
  if (move.captured) nb[move.captured[0]][move.captured[1]] = null;
  if ((p.color === 'white' && move.to[0] === 0) || (p.color === 'black' && move.to[0] === 7)) p.isKing = true;
  nb[move.to[0]][move.to[1]] = p;
  return nb;
}

function isMoveLegal(board, player, move, lockedSquare) {
  const legal = getCheckersMoves(board, player, lockedSquare);
  return legal.some(m =>
    m.from[0] === move.from[0] && m.from[1] === move.from[1] &&
    m.to[0] === move.to[0] && m.to[1] === move.to[1]
  );
}

module.exports = {
  initCheckersBoard,
  getPieceCaptures,
  getPieceNormals,
  getCheckersMoves,
  applyMove,
  isMoveLegal
};
