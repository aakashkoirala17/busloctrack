const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const admin = require('firebase-admin');

// Initialize Firebase Admin
// This requires a service account key. We'll check for an ENV variable or a local file.
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT env:', err);
  }
} else {
  const accountPath = path.join(__dirname, 'firebase-service-account.json');
  if (fs.existsSync(accountPath)) {
    try {
      serviceAccount = JSON.parse(fs.readFileSync(accountPath, 'utf8'));
    } catch (err) {
      console.error('Failed to read firebase-service-account.json:', err);
    }
  }
}

if (serviceAccount) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized');
  } catch (err) {
    console.error('Failed to initialize Firebase Admin:', err);
  }
} else {
  console.warn('Firebase Admin NOT initialized: No service account key found.');
}

const JWT_SECRET = process.env.JWT_SECRET || 'busloctrack-secret-key-123';
const USERS_FILE = path.join(__dirname, 'users.json');

const app = express();
app.use(cors()); // Enable CORS for all origins
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

// POST - Firebase Sync (Google Sign-In)
app.post('/api/auth/firebase-sync', async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'Firebase ID Token is required' });
  }

  try {
    let decodedToken;
    
    if (admin.apps.length > 0) {
      // Real verification
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } else {
      // Fallback for development if no service account is provided yet
      // This allows the user to see the UI work while they set up the key
      console.warn('Firebase Admin not initialized. Skipping real token verification.');
      decodedToken = jwt.decode(idToken); // Just decode for placeholder data
      if (!decodedToken) throw new Error('Invalid token format');
    }

    const { uid, name, email, picture, phone_number } = decodedToken;
    const users = getUsers();
    
    let user = users.find(u => u.uid === uid || u.email === email);
    
    if (!user) {
      // Create new user record
      user = {
        id: 'user_' + Date.now(),
        uid,
        name: name || 'Google User',
        email,
        picture,
        phone: phone_number || '',
        createdAt: new Date().toISOString()
      };
      users.push(user);
      saveUsers(users);
    } else {
      // Update existing user data from Google if needed
      user.name = name || user.name;
      user.picture = picture || user.picture;
      saveUsers(users);
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, picture: user.picture }
    });

  } catch (err) {
    console.error('Firebase Sync Error:', err);
    res.status(401).json({ error: 'Failed to verify Firebase token' });
  }
});

// Remove old sign-up/sign-in endpoints since we are moving to Google-only
// (Kept commented out for reference if needed)
/*
app.post('/api/auth/signup', ...);
app.post('/api/auth/signin', ...);
*/

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
