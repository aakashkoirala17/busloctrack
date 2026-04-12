const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

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

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Driver starts sharing location
  socket.on('bus-start', (data) => {
    const busInfo = {
      socketId: socket.id,
      routeId: data.routeId,
      routeName: data.routeName,
      busNumber: data.busNumber,
      driverName: data.driverName || 'Driver',
      lat: null,
      lng: null,
      speed: 0,
      heading: 0,
      lastUpdate: Date.now(),
      startTime: Date.now()
    };
    activeBuses.set(socket.id, busInfo);
    console.log(`🚌 Bus started: ${data.busNumber} on ${data.routeName}`);
    
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
        routeId: bus.routeId,
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
