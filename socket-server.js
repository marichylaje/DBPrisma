const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 30000, // 30s timeout for detecting connection drops
  pingInterval: 15000,
});

// In-memory state database
const activeRooms = {};
// Store cleanup timeouts for empty rooms to avoid memory leaks but allow reconnections
const roomCleanups = {};

const createFilledArray = (length, fillValue) => Array.from({ length }, () => fillValue);
const createFilledMatrix = (rows, cols, fillValue) => Array.from({ length: rows }, () => createFilledArray(cols, fillValue));

const normalizeRoomState = (roomCode, state = {}) => {
  const players = Math.max(2, Number(state?.gameParams?.players) || state?.lifeCounts?.length || 6);
  const boardSize = Math.max(6, players);

  return {
    roomCode,
    gameParams: state.gameParams ?? null,
    lifeCounts: Array.isArray(state.lifeCounts) && state.lifeCounts.length > 0
      ? state.lifeCounts
      : createFilledArray(players, 40),
    commanderDamage: Array.isArray(state.commanderDamage) && state.commanderDamage.length > 0
      ? createFilledMatrix(boardSize, boardSize, 0).map((row, rowIndex) => (
          Array.isArray(state.commanderDamage[rowIndex])
            ? createFilledArray(boardSize, 0).map((_, colIndex) => state.commanderDamage[rowIndex][colIndex] ?? 0)
            : row
        ))
      : createFilledMatrix(boardSize, boardSize, 0),
    poison: Array.isArray(state.poison) && state.poison.length > 0
      ? state.poison
      : createFilledArray(boardSize, 0),
    energy: Array.isArray(state.energy) && state.energy.length > 0
      ? state.energy
      : createFilledArray(boardSize, 0),
    experience: Array.isArray(state.experience) && state.experience.length > 0
      ? state.experience
      : createFilledArray(boardSize, 0),
    tax: Array.isArray(state.tax) && state.tax.length > 0
      ? state.tax
      : createFilledArray(boardSize, 0),
    rad: Array.isArray(state.rad) && state.rad.length > 0
      ? state.rad
      : createFilledArray(boardSize, 0),
    playerColors: Array.isArray(state.playerColors) && state.playerColors.length > 0
      ? state.playerColors
      : [],
    timerRemaining: Array.isArray(state.timerRemaining) && state.timerRemaining.length > 0
      ? state.timerRemaining
      : createFilledArray(players, 0),
    activeTimerIndex: state.activeTimerIndex ?? null,
    events: Array.isArray(state.events) ? state.events : [],
    isHost: state.isHost,
  };
};

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  let socketRoomCode = null;

  const normalizeRoomCode = (value) => String(value || '').trim().toUpperCase();
  const hasHostStatePayload = (state) => {
    if (!state || typeof state !== 'object') return false;
    // Host usually sends a complete snapshot. Accept null gameParams as a valid host snapshot.
    return Object.prototype.hasOwnProperty.call(state, 'gameParams') || state.isHost === true;
  };

  // Join or create room
  socket.on('join_room', ({ roomCode, initialState, isHost = false }) => {
    const normalizedRoomCode = normalizeRoomCode(roomCode);
    if (!normalizedRoomCode) return;

    const isHostRequest = Boolean(isHost || initialState?.isHost || hasHostStatePayload(initialState));
    const existingRoomState = activeRooms[normalizedRoomCode];

    // Guests cannot create new rooms; room must exist and have a started game.
    if (!existingRoomState && !isHostRequest) {
      socket.emit('error_message', {
        message: 'La sala no existe o el anfitrion aun no inicio la partida.',
      });
      console.log(`Guest ${socket.id} attempted to join non-existing room: ${normalizedRoomCode}`);
      return;
    }

    if (existingRoomState && !existingRoomState.gameParams && !isHostRequest) {
      socket.emit('error_message', {
        message: 'La sala existe pero la partida aun no fue iniciada por el anfitrion.',
      });
      console.log(`Guest ${socket.id} tried to join room without active game: ${normalizedRoomCode}`);
      return;
    }

    socketRoomCode = normalizedRoomCode;
    socket.join(normalizedRoomCode);
    console.log(`Socket ${socket.id} joined room: ${normalizedRoomCode}`);

    // If there was a pending deletion timeout for this room, cancel it because a client has joined/reconnected
    if (roomCleanups[normalizedRoomCode]) {
      clearTimeout(roomCleanups[normalizedRoomCode]);
      delete roomCleanups[normalizedRoomCode];
      console.log(`Room cleanup cancelled for room: ${normalizedRoomCode} (reconnection)`);
    }

    // Initialize room state if it doesn't exist
    if (!activeRooms[normalizedRoomCode]) {
      activeRooms[normalizedRoomCode] = normalizeRoomState(normalizedRoomCode, initialState || {
        roomCode: normalizedRoomCode,
        gameParams: null,
        lifeCounts: [],
        commanderDamage: [],
        poison: [],
        energy: [],
        experience: [],
        tax: [],
        rad: [],
        playerColors: [],
        timerRemaining: [],
        activeTimerIndex: null,
        events: [],
      });
      console.log(`Room initialized with code: ${normalizedRoomCode}`);
      console.log(`Room created by host ${socket.id}: ${normalizedRoomCode}`);
    } else if (initialState && isHostRequest) {
      // If host is reconnecting/re-joining, merge parameters just in case
      activeRooms[normalizedRoomCode] = normalizeRoomState(normalizedRoomCode, {
        ...activeRooms[normalizedRoomCode],
        ...initialState,
      });
    }

    // Send latest room state back to the joining client and ensure everyone in the room has the exact same state
    activeRooms[normalizedRoomCode] = normalizeRoomState(normalizedRoomCode, activeRooms[normalizedRoomCode]);
    io.to(normalizedRoomCode).emit('room_state_updated', activeRooms[normalizedRoomCode]);
    
    // Notify others in room
    socket.to(normalizedRoomCode).emit('player_joined', { socketId: socket.id });
  });

  // Synchronize game state
  socket.on('sync_state', ({ roomCode, state }) => {
    const normalizedRoomCode = normalizeRoomCode(roomCode);
    if (!normalizedRoomCode || !state) return;
    
    console.log(`Received state sync from ${socket.id} for room ${normalizedRoomCode}:`, Object.keys(state));

    // Merge changes into memory
    activeRooms[normalizedRoomCode] = normalizeRoomState(normalizedRoomCode, {
      ...activeRooms[normalizedRoomCode],
      ...state,
    });

    // Broadcast canonical state to everyone in the room, including sender.
    io.to(normalizedRoomCode).emit('room_state_updated', activeRooms[normalizedRoomCode]);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    if (socketRoomCode) {
      const roomCode = socketRoomCode;
      
      // Use setImmediate/setTimeout to check room size after socket leaves
      setTimeout(() => {
        const room = io.sockets.adapter.rooms.get(roomCode);
        const activeClients = room ? room.size : 0;
        
        console.log(`Room ${roomCode} has ${activeClients} active connections remaining.`);
        
        if (activeClients === 0) {
          // Schedule room cleanup in 10 minutes to allow reconnection in case of internet reload/drop
          console.log(`Room ${roomCode} is empty. Scheduling deletion in 10 minutes...`);
          
          if (roomCleanups[roomCode]) clearTimeout(roomCleanups[roomCode]);
          
          roomCleanups[roomCode] = setTimeout(() => {
            delete activeRooms[roomCode];
            delete roomCleanups[roomCode];
            console.log(`Room ${roomCode} permanently deleted from memory (inactivity).`);
          }, 10 * 60 * 1000); // 10 minutes
        }
      }, 1000);
    }
  });
});

const PORT = process.env.PORT || process.env.SOCKET_PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Realtime Life Counter socket server running on port ${PORT}`);
});
