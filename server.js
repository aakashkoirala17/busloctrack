const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'busloctrack-secret-key-123';
const USERS_FILE = path.join(__dirname, 'users.json');

const app = express();
app.use(express.json()); // Handle JSON payloads
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// User Storage Helper
const getUsers = () => {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (e) {
    console.error('Error reading users file:', e);
    return [];
  }
};

const saveUsers = (users) => {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (e) {
    console.error('Error saving users file:', e);
  }
};

// --- Auth Endpoints ---

// POST - Sign Up
app.post('/api/auth/signup', async (req, res) => {
  const { name, phone, password } = req.body;

  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const users = getUsers();
  if (users.find(u => u.phone === phone)) {
    return res.status(400).json({ error: 'User with this phone number already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = { id: 'user_' + Date.now(), name, phone, password: hashedPassword };
  
  users.push(newUser);
  saveUsers(users);

  res.status(201).json({ message: 'User created successfully' });
});

// POST - Sign In
app.post('/api/auth/signin', async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and password are required' });
  }

  const users = getUsers();
  const user = users.find(u => u.phone === phone);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid phone number or password' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, phone: user.phone },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, phone: user.phone }
  });
});

// --- User Profile & Security ---

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token.' });
  }
};

// GET - Get User Profile
app.get('/api/user/profile', verifyToken, (req, res) => {
  const users = getUsers();
  const user = users.find(u => u.id === req.user.id);
  
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    busDetails: user.busDetails || {},
    favorites: user.favorites || []
  });
});

// POST - Update User Profile (Bus details or Favorites)
app.post('/api/user/profile', verifyToken, (req, res) => {
  const { busDetails, favorites } = req.body;
  const users = getUsers();
  const userIndex = users.findIndex(u => u.id === req.user.id);

  if (userIndex === -1) return res.status(404).json({ error: 'User not found' });

  if (busDetails) users[userIndex].busDetails = busDetails;
  if (favorites) users[userIndex].favorites = favorites;

  saveUsers(users);
  res.json({ message: 'Profile updated successfully' });
});

// In-memory store of active buses
const activeBuses = new Map();

// REST API - Get all active buses
app.get('/api/buses', (req, res) => {
  const buses = [];
  activeBuses.forEach((bus, id) => {
    buses.push({ id, ...bus });
  });
  res.json(buses);
});

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication error: No token provided'));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Authenticated client connected: ${socket.user.name} (${socket.id})`);

  // Driver starts sharing location
  socket.on('bus-start', (data) => {
    const busInfo = {
      socketId: socket.id,
      busName: data.busName || 'Bus',
      routeName: data.routeName || 'Unknown Route',
      busNumber: data.busNumber,
      lat: null,
      lng: null,
      speed: 0,
      heading: 0,
      lastUpdate: Date.now(),
      startTime: Date.now()
    };
    activeBuses.set(socket.id, busInfo);
    console.log(`🚌 Bus started: ${busInfo.busName} (${data.busNumber}) on ${data.routeName}`);
    
    // Notify all passengers
    io.emit('bus-online', { id: socket.id, ...busInfo });
  });

  // Driver sends location update
  socket.on('bus-location', (data) => {
    const bus = activeBuses.get(socket.id);
    if (bus) {
      bus.lat = data.lat;
      bus.lng = data.lng;
      bus.speed = data.speed || 0;
      bus.heading = data.heading || 0;
      bus.accuracy = data.accuracy || 0;
      bus.lastUpdate = Date.now();
      activeBuses.set(socket.id, bus);

      // Broadcast to all passengers
      io.emit('bus-update', {
        id: socket.id,
        lat: data.lat,
        lng: data.lng,
        speed: data.speed || 0,
        heading: data.heading || 0,
        accuracy: data.accuracy || 0,
        busName: bus.busName,
        routeName: bus.routeName,
        busNumber: bus.busNumber,
        lastUpdate: bus.lastUpdate
      });
    }
  });

  // Driver stops sharing
  socket.on('bus-stop', () => {
    if (activeBuses.has(socket.id)) {
      const bus = activeBuses.get(socket.id);
      console.log(`🛑 Bus stopped: ${bus.busNumber}`);
      activeBuses.delete(socket.id);
      io.emit('bus-offline', { id: socket.id });
    }
  });

  // Client disconnects
  socket.on('disconnect', () => {
    if (activeBuses.has(socket.id)) {
      const bus = activeBuses.get(socket.id);
      console.log(`❌ Bus disconnected: ${bus.busNumber}`);
      activeBuses.delete(socket.id);
      io.emit('bus-offline', { id: socket.id });
    }
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Clean up stale buses (no update for 2 minutes)
setInterval(() => {
  const now = Date.now();
  activeBuses.forEach((bus, id) => {
    if (bus.lat && now - bus.lastUpdate > 120000) {
      console.log(`🧹 Cleaning stale bus: ${bus.busNumber}`);
      activeBuses.delete(id);
      io.emit('bus-offline', { id });
    }
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`\n🚌 BusLocTrack Server running on http://localhost:${PORT}\n`);
});
