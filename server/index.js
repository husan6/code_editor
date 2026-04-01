const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { Script, createContext } = require('vm');

const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin = '') => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (/^https?:\/\/localhost(?::\d+)?$/i.test(origin)) return true;
  if (/^https:\/\/.*\.vercel\.app$/i.test(origin)) return true;
  return false;
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST'],
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
});

const rooms = {}; // roomId -> { files, users: {socketId: {username, color}}, messages: [] }
const socketRoom = {}; // socketId -> roomId
const savedSessions = {}; // roomId -> { files, messages, updatedAt }

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('join-room', ({ roomId, username }) => {
    if (!roomId || !username) return;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        files: [{ id: uuidv4(), name: 'index.js', code: '// Start coding\n' }],
        users: {},
        messages: [],
      };
    }

    const userColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    rooms[roomId].users[socket.id] = { username, color: userColor };
    socketRoom[socket.id] = roomId;
    socket.join(roomId);

    const room = rooms[roomId];
    socket.emit('room-data', { files: room.files, users: room.users, messages: room.messages });
    socket.to(roomId).emit('user-joined', { socketId: socket.id, username, color: userColor });
    io.in(roomId).emit(
      'active-users',
      Object.entries(room.users).map(([sid, user]) => ({ socketId: sid, ...user })),
    );
  });

  socket.on('code-change', ({ roomId, fileId, code }) => {
    if (!roomId || !fileId || typeof code !== 'string') return;

    const room = rooms[roomId];
    if (!room) return;

    const file = room.files.find((entry) => entry.id === fileId);
    if (!file) return;

    file.code = code;
    socket.to(roomId).emit('code-change', { fileId, code });
  });

  socket.on('cursor-change', ({ roomId, socketId, range }) => {
    if (!roomId || !range || !rooms[roomId] || !rooms[roomId].users[socket.id]) return;
    socket.to(roomId).emit('cursor-change', { socketId, range, ...rooms[roomId].users[socket.id] });
  });

  socket.on('chat-message', ({ roomId, username, message }) => {
    if (!roomId || !message) return;

    const room = rooms[roomId];
    if (!room) return;

    const chat = { username, message, createdAt: new Date().toISOString() };
    room.messages.push(chat);
    io.in(roomId).emit('chat-message', chat);
  });

  socket.on('disconnect', () => {
    const roomId = socketRoom[socket.id];
    if (!roomId) return;

    const room = rooms[roomId];
    if (!room) return;

    const user = room.users[socket.id];
    delete room.users[socket.id];
    delete socketRoom[socket.id];
    socket.to(roomId).emit('user-left', { socketId: socket.id, username: user?.username });
    io.in(roomId).emit(
      'active-users',
      Object.entries(room.users).map(([sid, activeUser]) => ({ socketId: sid, ...activeUser })),
    );

    if (Object.keys(room.users).length === 0) {
      setTimeout(() => {
        if (rooms[roomId] && Object.keys(rooms[roomId].users).length === 0) {
          delete rooms[roomId];
        }
      }, 1000 * 60 * 10);
    }
  });
});

app.post('/run', (req, res) => {
  const { code } = req.body;
  if (typeof code !== 'string') {
    return res.status(400).json({ error: 'code is required' });
  }

  const sandbox = {
    console: {
      output: [],
      log: (...args) => sandbox.console.output.push(args.map((value) => String(value)).join(' ')),
      info: (...args) => sandbox.console.output.push(args.map((value) => String(value)).join(' ')),
      warn: (...args) => sandbox.console.output.push(args.map((value) => String(value)).join(' ')),
      error: (...args) => sandbox.console.output.push(args.map((value) => String(value)).join(' ')),
    },
    document: {
      body: {
        innerHTML: '',
        innerText: '',
        appendChild: () => null,
        insertAdjacentHTML: () => null,
      },
      querySelector: () => null,
      getElementById: () => null,
    },
    window: {},
    location: { href: '' },
  };
  const context = createContext(sandbox);

  try {
    const result = new Script(code).runInContext(context, { timeout: 1000 });
    return res.json({ output: sandbox.console.output || [], result });
  } catch (err) {
    return res.json({
      output: sandbox.console.output || [],
      error: err && err.message ? err.message : String(err),
    });
  }
});

app.post('/save-session', (req, res) => {
  const { roomId, files, messages } = req.body;
  if (!roomId || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'roomId and files are required' });
  }

  savedSessions[roomId] = { files, messages: messages || [], updatedAt: new Date().toISOString() };
  return res.json({ status: 'ok', saved: savedSessions[roomId] });
});

app.get('/session/:roomId', (req, res) => {
  const { roomId } = req.params;
  const session = savedSessions[roomId];
  if (!session) return res.status(404).json({ error: 'session not found' });
  return res.json(session);
});

app.get('/rooms', (req, res) => {
  return res.json({ rooms: Object.keys(rooms), activeRoomCount: Object.keys(rooms).length });
});

app.get('/stats', (req, res) => {
  return res.json({
    activeRooms: Object.keys(rooms).length,
    activeUsers: Object.values(rooms).reduce((sum, room) => sum + Object.keys(room.users).length, 0),
    savedSessions: Object.keys(savedSessions).length,
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Realtime collaborative code editor backend is running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
