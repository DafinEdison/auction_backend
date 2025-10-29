require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// Import game logic from local lib
const game = require('./lib/game');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;
const SOCKET_PATH = process.env.SOCKET_PATH || '/socketio';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

const io = new Server(server, {
  path: SOCKET_PATH,
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  // Auction room lifecycle
  socket.on('create', (data) => game.create(io, socket, data));
  socket.on('join', (data) => game.join(io, socket, data));
  socket.on('start', (data) => game.start(io, socket, data));
  socket.on('play', (data) => game.play(socket, data));
  socket.on('bid', (data) => game.bid(socket, data));
  socket.on('next', (data) => game.next(io, data));
  socket.on('rtm-accept', (data) => game.rtmAccept(io, socket, data));
  socket.on('set-settings', (data) => game.settings(io, socket, data));
  socket.on('check-user', (user) => game.checkUser(socket, user));
  socket.on('exit-user', (data) => game.exitUser(io, socket, data));
  socket.on('choose-team', (data) => game.chooseTeam(io, socket, data));
  socket.on('follow', (data) => game.follow(io, socket, data));

  // Cleanup ghost users on disconnect to keep confirmations accurate
  socket.on('disconnect', () => {
    const room = socket?.data?.room;
    const username = socket?.data?.username;
    if (room && username) {
      try {
        game.exitUser(io, socket, { room, user: username });
      } catch (e) {}
    }
  });

  // Utility
  socket.on('list-auctions', () => {
    socket.emit('auctions', game.listAuctions());
  });
});

// Health endpoint
app.get('/health', (_req, res) => res.json({ ok: true }));

server.listen(PORT, () => {
  console.log(`Socket.IO server listening on port ${PORT}, path ${SOCKET_PATH}`);
});