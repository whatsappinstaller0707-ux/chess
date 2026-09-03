/* ==========================================================================
   NYASATECH1 Games — server entrypoint.

   Serves the static SPA (index.html / app.js / style.css / js/*) and runs
   the Socket.IO real-time layer for matchmaking, private rooms, and
   server-side move validation. Single process, in-memory room/queue
   state — see server/rooms.js for the note on scaling past one instance.
   ========================================================================== */

require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { registerSocketHandlers } = require('./server/socketHandlers');

const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] }
});

// Static assets (index.html, app.js, style.css, js/chess-engine.js, js/checkers-engine.js)
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

// Private-room deep links (/room/ABCD12) — serve the SPA; app.js reads
// the room code out of window.location.pathname on load.
app.get('/room/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Lightweight healthcheck for Render / uptime monitors.
app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`NYASATECH1 Games server listening on port ${PORT}`);
});
