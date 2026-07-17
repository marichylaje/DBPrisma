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

  // Join or create room
  socket.on('join_room', ({ roomCode, initialState }) => {
    if (!roomCode) return;

    socketRoomCode = roomCode;
    socket.join(roomCode);
    console.log(`Socket ${socket.id} joined room: ${roomCode}`);

    // If there was a pending deletion timeout for this room, cancel it because a client has joined/reconnected
    if (roomCleanups[roomCode]) {
      clearTimeout(roomCleanups[roomCode]);
      delete roomCleanups[roomCode];
      console.log(`Room cleanup cancelled for room: ${roomCode} (reconnection)`);
    }

    // Initialize room state if it doesn't exist
    if (!activeRooms[roomCode]) {
      activeRooms[roomCode] = initialState || {
        roomCode,
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
      console.log(`Room initialized with code: ${roomCode}`);
    } else if (initialState && initialState.isHost) {
      // If host is reconnecting/re-joining, merge parameters just in case
      activeRooms[roomCode] = {
        ...activeRooms[roomCode],
        ...initialState,
      };
    }

    // Send latest room state back to the joining client
    socket.emit('room_state_updated', activeRooms[roomCode]);
    
    // Notify others in room
    socket.to(roomCode).emit('player_joined', { socketId: socket.id });
  });

  // Synchronize game state
  socket.on('sync_state', ({ roomCode, state }) => {
    if (!roomCode || !state) return;

    // Merge changes into memory
    activeRooms[roomCode] = {
      ...activeRooms[roomCode],
      ...state,
      roomCode, // ensure roomCode is not modified
    };

    // Broadcast the updated state to everyone else in the room
    socket.to(roomCode).emit('room_state_updated', activeRooms[roomCode]);
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
