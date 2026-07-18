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
      activeRooms[normalizedRoomCode] = initialState || {
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
      };
      console.log(`Room initialized with code: ${normalizedRoomCode}`);
      console.log(`Room created by host ${socket.id}: ${normalizedRoomCode}`);
    } else if (initialState && isHostRequest) {
      // If host is reconnecting/re-joining, merge parameters just in case
      activeRooms[normalizedRoomCode] = {
        ...activeRooms[normalizedRoomCode],
        ...initialState,
        roomCode: normalizedRoomCode,
      };
    }

    // Send latest room state back to the joining client and ensure everyone in the room has the exact same state
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
    activeRooms[normalizedRoomCode] = {
      ...activeRooms[normalizedRoomCode],
      ...state,
      roomCode: normalizedRoomCode,
    };

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
