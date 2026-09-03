/* ==========================================================================
   Private room management (in-memory).

   A "room" holds up to two players and one authoritative game state. Rooms
   are created with `createRoom`, joined with `joinRoom`, and can be
   re-entered after a drop with `rejoinRoom` as long as the player's
   `playerToken` (a client-persisted id, not the ephemeral socket id)
   matches a seat already in the room.

   NOTE on scaling: this is a single-process in-memory store, which is
   fine for a single Render web service instance. If NYASATECH1 ever runs
   more than one instance, room state needs to move to something shared
   (Redis, etc.) — flagged in UPGRADE_PLAN.md as a scaling follow-up.
   ========================================================================== */

const { initCheckersBoard } = require('../shared/checkersRules');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
const rooms = new Map(); // roomCode -> room

function generateRoomCode(length = 6) {
  let code;
  do {
    code = '';
    for (let i = 0; i < length; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function freshGameState(gameType) {
  if (gameType === 'checkers') {
    return { board: initCheckersBoard(), turn: 'white', lockedSquare: null, fen: null };
  }
  // Chess: the server also runs chess.js, so we just track FEN.
  return { board: null, turn: 'white', lockedSquare: null, fen: 'start' };
}

function createRoom(gameType, hostPlayer) {
  const roomCode = generateRoomCode();
  const room = {
    roomCode,
    gameType,
    createdAt: Date.now(),
    started: false,
    state: freshGameState(gameType),
    players: [
      { ...hostPlayer, color: 'white', connected: true, disconnectTimer: null }
    ]
  };
  rooms.set(roomCode, room);
  return room;
}

function joinRoom(roomCode, guestPlayer) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'That room code was not found.' };
  if (room.players.length >= 2) {
    // Allow the same token to "join" its own room again (e.g. page refresh
    // before the match started) instead of rejecting it as full.
    const existing = room.players.find(p => p.playerToken === guestPlayer.playerToken);
    if (existing) {
      existing.socketId = guestPlayer.socketId;
      existing.connected = true;
      return { room };
    }
    return { error: 'That room is already full.' };
  }
  if (room.gameType !== guestPlayer.gameType) {
    return { error: 'That room is playing a different game.' };
  }
  room.players.push({ ...guestPlayer, color: 'black', connected: true, disconnectTimer: null });
  room.started = true;
  return { room };
}

function rejoinRoom(roomCode, playerToken, newSocketId) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room no longer exists.' };
  const seat = room.players.find(p => p.playerToken === playerToken);
  if (!seat) return { error: 'No seat for this player in that room.' };
  seat.socketId = newSocketId;
  seat.connected = true;
  if (seat.disconnectTimer) {
    clearTimeout(seat.disconnectTimer);
    seat.disconnectTimer = null;
  }
  return { room, seat };
}

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    const seat = room.players.find(p => p.socketId === socketId);
    if (seat) return { room, seat };
  }
  return null;
}

function getRoom(roomCode) {
  return rooms.get(roomCode) || null;
}

function destroyRoom(roomCode) {
  rooms.delete(roomCode);
}

function otherPlayer(room, socketId) {
  return room.players.find(p => p.socketId !== socketId) || null;
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  rejoinRoom,
  findRoomBySocket,
  getRoom,
  destroyRoom,
  otherPlayer
};
