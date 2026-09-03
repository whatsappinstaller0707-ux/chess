/* ==========================================================================
   Socket.IO event wiring for NYASATECH1 online play.

   Covers: skill-based matchmaking, private room create/join/rejoin,
   disconnect-with-grace-period reconnection, and server-side move
   validation (anti-cheat) for both games before a move is relayed to
   the opponent.
   ========================================================================== */

const { Chess } = require('chess.js');
const checkersRules = require('../shared/checkersRules');
const rooms = require('./rooms');
const matchmaking = require('./matchmaking');

const RECONNECT_GRACE_MS = 30000;

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {

    /* ---------------- Matchmaking ---------------- */
    socket.on('find_match', (data) => {
      const gameType = data && data.gameType === 'chess' ? 'chess' : 'checkers';
      matchmaking.enqueue(gameType, {
        socketId: socket.id,
        playerToken: data.playerToken,
        name: data.playerName || 'Player',
        rating: data.rating || 1000
      });

      const pair = matchmaking.tryMatch(gameType);
      if (!pair) return;

      const room = rooms.createRoom(gameType, {
        socketId: pair.a.socketId,
        playerToken: pair.a.playerToken,
        name: pair.a.name
      });
      const joinResult = rooms.joinRoom(room.roomCode, {
        socketId: pair.b.socketId,
        playerToken: pair.b.playerToken,
        name: pair.b.name,
        gameType
      });
      if (joinResult.error) return; // extremely unlikely race; both players simply re-queue on next search

      io.to(pair.a.socketId).emit('match_found', {
        opponentName: pair.b.name, roomId: room.roomCode, assignedColor: 'white'
      });
      io.to(pair.b.socketId).emit('match_found', {
        opponentName: pair.a.name, roomId: room.roomCode, assignedColor: 'black'
      });

      socket.join(room.roomCode);
      io.sockets.sockets.get(pair.a.socketId) && io.sockets.sockets.get(pair.a.socketId).join(room.roomCode);
      io.sockets.sockets.get(pair.b.socketId) && io.sockets.sockets.get(pair.b.socketId).join(room.roomCode);
    });

    socket.on('cancel_matchmaking', () => {
      matchmaking.removeSocketEverywhere(socket.id);
    });

    /* ---------------- Private rooms ---------------- */
    socket.on('create_room', (data) => {
      const gameType = data && data.gameType === 'chess' ? 'chess' : 'checkers';
      const room = rooms.createRoom(gameType, {
        socketId: socket.id,
        playerToken: data.playerToken,
        name: data.playerName || 'Player'
      });
      socket.join(room.roomCode);
      const origin = (socket.handshake.headers.origin) || '';
      socket.emit('room_created', {
        roomCode: room.roomCode,
        inviteLink: origin + '/room/' + room.roomCode
      });
    });

    socket.on('join_room', (data) => {
      const result = rooms.joinRoom(data.roomCode, {
        socketId: socket.id,
        playerToken: data.playerToken,
        name: data.playerName || 'Player',
        gameType: data.gameType === 'chess' ? 'chess' : 'checkers'
      });
      if (result.error) {
        socket.emit('room_join_error', { message: result.error });
        return;
      }
      const room = result.room;
      socket.join(room.roomCode);
      const host = room.players[0];
      const guest = room.players[1];
      io.to(host.socketId).emit('room_ready', { opponentName: guest.name, roomId: room.roomCode, assignedColor: 'white' });
      io.to(guest.socketId).emit('room_ready', { opponentName: host.name, roomId: room.roomCode, assignedColor: 'black' });
    });

    socket.on('rejoin_room', (data) => {
      const result = rooms.rejoinRoom(data.roomId, data.playerToken, socket.id);
      if (result.error) return;
      socket.join(data.roomId);

      const room = result.room;
      const opponent = rooms.otherPlayer(room, socket.id);
      if (opponent) io.to(opponent.socketId).emit('opponent_back');

      const payload = { turn: room.state.turn };
      if (room.gameType === 'checkers') payload.board = room.state.board;
      else payload.fen = room.state.fen;
      socket.emit('state_sync', payload);
    });

    /* ---------------- Move relay + server-side validation ---------------- */
    socket.on('make_move', (data) => {
      const found = rooms.findRoomBySocket(socket.id);
      if (!found) return;
      const { room, seat } = found;
      if (room.roomCode !== data.roomId) return;

      const opponent = rooms.otherPlayer(room, socket.id);
      if (!opponent) return;

      if (room.gameType === 'chess') {
        if (!validateAndApplyChessMove(room, seat.color, data.move)) {
          socket.emit('state_sync', { fen: room.state.fen, turn: room.state.turn });
          return;
        }
      } else {
        if (!validateAndApplyCheckersMove(room, seat.color, data.move)) {
          socket.emit('state_sync', { board: room.state.board, turn: room.state.turn });
          return;
        }
      }

      io.to(opponent.socketId).emit('opponent_moved', { gameType: room.gameType, move: data.move });
    });

    /* ---------------- Disconnect / reconnect ---------------- */
    socket.on('disconnect', () => {
      matchmaking.removeSocketEverywhere(socket.id);

      const found = rooms.findRoomBySocket(socket.id);
      if (!found) return;
      const { room, seat } = found;
      seat.connected = false;

      const opponent = rooms.otherPlayer(room, socket.id);
      if (opponent) io.to(opponent.socketId).emit('opponent_reconnecting');

      seat.disconnectTimer = setTimeout(() => {
        const stillGone = !seat.connected;
        if (stillGone) {
          if (opponent) io.to(opponent.socketId).emit('opponent_forfeited');
          rooms.destroyRoom(room.roomCode);
        }
      }, RECONNECT_GRACE_MS);
    });
  });
}

/* ---------------- Server-authoritative validation helpers ---------------- */

function validateAndApplyChessMove(room, color, move) {
  const chess = new Chess(room.state.fen === 'start' ? undefined : room.state.fen);
  const turnColor = chess.turn() === 'w' ? 'white' : 'black';
  if (turnColor !== color) return false;

  const fromSquare = String.fromCharCode(97 + move.from[1]) + (8 - move.from[0]);
  const toSquare = String.fromCharCode(97 + move.to[1]) + (8 - move.to[0]);
  const result = chess.move({ from: fromSquare, to: toSquare, promotion: move.promotion || 'q' });
  if (!result) return false;

  room.state.fen = chess.fen();
  room.state.turn = chess.turn() === 'w' ? 'white' : 'black';
  return true;
}

function validateAndApplyCheckersMove(room, color, move) {
  if (room.state.turn !== color) return false;
  if (!checkersRules.isMoveLegal(room.state.board, color, move, room.state.lockedSquare)) return false;

  room.state.board = checkersRules.applyMove(room.state.board, move);

  if (move.captured) {
    const subCaptures = checkersRules.getPieceCaptures(room.state.board, move.to[0], move.to[1]);
    if (subCaptures.length > 0) {
      room.state.lockedSquare = move.to;
      return true; // same player continues; turn does not flip
    }
  }
  room.state.lockedSquare = null;
  room.state.turn = color === 'white' ? 'black' : 'white';
  return true;
}

module.exports = { registerSocketHandlers };
