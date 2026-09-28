const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = process.env.PORT || 3000;

// Initialize the Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize Socket.io
  const io = new Server(server, {
    cors: {
      origin: (process.env.CORS_ORIGINS || `http://localhost:${port}`).split(','),
      methods: ["GET", "POST"]
    }
  });

  // Expose to Next.js route handlers (server/realtime.ts publishes through this)
  globalThis.__agriIO = io;

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join a role-specific room (e.g., 'farmer_123', 'gov_national', 'supply_chain_bd')
    socket.on('join_room', (room) => {
      socket.join(room);
      console.log(`[Socket.io] ${socket.id} joined room: ${room}`);
    });

    // Handle alert broadcasts
    socket.on('broadcast_alert', (data) => {
      console.log(`[Socket.io] Broadcasting alert to ${data.targetRoom}:`, data.title);
      // Broadcast to specific room
      io.to(data.targetRoom).emit('new_alert', data);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.io server running`);
  });
});
