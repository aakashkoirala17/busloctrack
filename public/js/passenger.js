/**
 * BusLocTrack — Passenger Page Logic
 * Live map with bus tracking
 */

(function () {
  'use strict';

  // DOM Elements
  const connectionStatus = document.getElementById('connection-status');
  const wsDot = document.getElementById('ws-dot');
  const busCountEl = document.getElementById('bus-count');
  const busCountBadge = document.getElementById('bus-count-badge');
  const noBusesMsg = document.getElementById('no-buses-msg');
  const routeFilter = document.getElementById('route-filter');
  const locateBtn = document.getElementById('locate-btn');
  const busPanel = document.getElementById('bus-panel');
  const panelClose = document.getElementById('panel-close');
  const panelBusNumber = document.getElementById('panel-bus-number');
  const panelRouteName = document.getElementById('panel-route-name');
  const panelSpeed = document.getElementById('panel-speed');
  const panelDistance = document.getElementById('panel-distance');
  const panelUpdated = document.getElementById('panel-updated');

  // State
  const buses = new Map(); // id -> { marker, data }
  let myLocation = null;
  let myLocationMarker = null;
  let selectedBusId = null;
  let filterText = '';

  // Initialize Map
  const map = L.map('passenger-map', {
    zoomControl: true,
    attributionControl: false
  }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  getMapTileLayer().addTo(map);

  // Move zoom control to bottom-right
  map.zoomControl.setPosition('bottomright');

  // Socket.IO
  const socket = io();

  socket.on('connect', () => {
    wsDot.classList.add('connected');
    connectionStatus.textContent = 'Live — Tracking active';
    showToast('Connected to live tracking', 'success');
    
    // Fetch existing buses
    fetchActiveBuses();
  });

  socket.on('disconnect', () => {
    wsDot.classList.remove('connected');
    connectionStatus.textContent = 'Disconnected — Reconnecting...';
    showToast('Connection lost. Reconnecting...', 'error');
  });

  // Fetch existing active buses on load
  async function fetchActiveBuses() {
    try {
      const res = await fetch('/api/buses');
      const busList = await res.json();
      busList.forEach(bus => {
        if (bus.lat && bus.lng) {
          addOrUpdateBus(bus.id || bus.socketId, bus);
        }
      });
      updateBusCount();
    } catch (err) {
      console.error('Failed to fetch buses:', err);
    }
  }

  // New bus comes online
  socket.on('bus-online', (data) => {
    showToast(`🚌 ${data.busNumber || 'Bus'} is now online on ${data.routeName || 'a route'}`, 'info');
    updateBusCount();
  });

  // Bus location update
  socket.on('bus-update', (data) => {
    addOrUpdateBus(data.id, data);
    updateBusCount();

    // If this bus is selected, update the panel
    if (selectedBusId === data.id) {
      updatePanel(data);
    }
  });

  // Bus goes offline
  socket.on('bus-offline', (data) => {
    removeBus(data.id);
    updateBusCount();

    if (selectedBusId === data.id) {
      closePanel();
      showToast('This bus went offline', 'warning');
    }
  });

  // Add or update a bus marker
  function addOrUpdateBus(id, data) {
    const existing = buses.get(id);

    if (existing) {
      // Update existing marker position with smooth animation
      const currentLatLng = existing.marker.getLatLng();
      const newLatLng = L.latLng(data.lat, data.lng);
      
      animateMarker(existing.marker, currentLatLng, newLatLng, 500);
      existing.data = { ...existing.data, ...data };
      buses.set(id, existing);
    } else {
      // Create new marker
      const marker = L.marker([data.lat, data.lng], {
        icon: createBusIcon(data.busNumber || '?')
      }).addTo(map);

      // Click handler
      marker.on('click', () => {
        selectBus(id);
      });

      buses.set(id, { marker, data });
    }

    // Apply filter
    applyFilter();
  }

  // Smooth marker animation
  function animateMarker(marker, from, to, duration) {
    const start = performance.now();
    const fromLat = from.lat;
    const fromLng = from.lng;
    const toLat = to.lat;
    const toLng = to.lng;

    function step(timestamp) {
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = easeOutCubic(progress);
      const lat = fromLat + (toLat - fromLat) * eased;
      const lng = fromLng + (toLng - fromLng) * eased;
      marker.setLatLng([lat, lng]);

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // Remove bus marker
  function removeBus(id) {
    const existing = buses.get(id);
    if (existing) {
      map.removeLayer(existing.marker);
      buses.delete(id);
    }
  }

  // Select a bus and show panel
  function selectBus(id) {
    const bus = buses.get(id);
    if (!bus) return;

    selectedBusId = id;
    
    // Center map on bus
    map.panTo([bus.data.lat, bus.data.lng]);

    // Show panel
    updatePanel(bus.data);
    busPanel.classList.add('visible');
  }

  // Update info panel
  function updatePanel(data) {
    panelBusNumber.textContent = data.busNumber || 'Unknown Bus';
    panelRouteName.textContent = data.routeName || 'Unknown Route';
    panelSpeed.textContent = data.speed ? formatSpeed(data.speed) : '0';
    panelUpdated.textContent = data.lastUpdate ? timeAgo(data.lastUpdate) : '—';

    // Calculate distance from passenger
    if (myLocation && data.lat && data.lng) {
      const dist = calculateDistance(myLocation.lat, myLocation.lng, data.lat, data.lng);
      panelDistance.textContent = formatDistance(dist);
    } else {
      panelDistance.textContent = '—';
    }
  }

  // Close panel
  function closePanel() {
    busPanel.classList.remove('visible');
    selectedBusId = null;
  }

  panelClose.addEventListener('click', closePanel);

  // Update bus count
  function updateBusCount() {
    const count = buses.size;
    busCountEl.textContent = count;

    if (count === 0) {
      noBusesMsg.classList.remove('hidden');
      busCountBadge.style.display = 'none';
    } else {
      noBusesMsg.classList.add('hidden');
      busCountBadge.style.display = 'flex';
    }
  }

  // Route/bus filter
  routeFilter.addEventListener('input', (e) => {
    filterText = e.target.value.toLowerCase().trim();
    applyFilter();
  });

  function applyFilter() {
    if (!filterText) {
      // Show all
      buses.forEach(({ marker }) => {
        if (!map.hasLayer(marker)) map.addLayer(marker);
      });
      return;
    }

    buses.forEach(({ marker, data }) => {
      const matchRoute = (data.routeName || '').toLowerCase().includes(filterText);
      const matchBus = (data.busNumber || '').toLowerCase().includes(filterText);
      const matchId = (data.routeId || '').toLowerCase().includes(filterText);

      if (matchRoute || matchBus || matchId) {
        if (!map.hasLayer(marker)) map.addLayer(marker);
      } else {
        if (map.hasLayer(marker)) map.removeLayer(marker);
      }
    });
  }

  // Locate me button
  let isLocating = false;
  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported', 'error');
      return;
    }

    locateBtn.classList.toggle('active');
    
    if (!isLocating) {
      isLocating = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          myLocation = { lat: latitude, lng: longitude };

          if (myLocationMarker) {
            myLocationMarker.setLatLng([latitude, longitude]);
          } else {
            myLocationMarker = L.marker([latitude, longitude], {
              icon: createMyLocationIcon()
            }).addTo(map);
          }

          map.setView([latitude, longitude], 15);
          showToast('Location found!', 'success');
          isLocating = false;

          // Update panel distance if a bus is selected
          if (selectedBusId) {
            const bus = buses.get(selectedBusId);
            if (bus) updatePanel(bus.data);
          }
        },
        (err) => {
          console.error('Location error:', err);
          showToast('Could not get your location', 'error');
          locateBtn.classList.remove('active');
          isLocating = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
  });

  // Also watch passenger location for continuous distance updates
  if (navigator.geolocation) {
    navigator.geolocation.watchPosition(
      (pos) => {
        myLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (myLocationMarker) {
          myLocationMarker.setLatLng([myLocation.lat, myLocation.lng]);
        }
      },
      () => {},
      { enableHighAccuracy: false, timeout: 30000, maximumAge: 10000 }
    );
  }

  // Update "time ago" in panel periodically
  setInterval(() => {
    if (selectedBusId) {
      const bus = buses.get(selectedBusId);
      if (bus && bus.data.lastUpdate) {
        panelUpdated.textContent = timeAgo(bus.data.lastUpdate);
      }
      // Also re-calculate distance
      if (bus && myLocation) {
        const dist = calculateDistance(myLocation.lat, myLocation.lng, bus.data.lat, bus.data.lng);
        panelDistance.textContent = formatDistance(dist);
      }
    }
  }, 5000);

  // Swipe down to close panel
  let panelTouchStart = null;
  busPanel.addEventListener('touchstart', (e) => {
    panelTouchStart = e.touches[0].clientY;
  });

  busPanel.addEventListener('touchmove', (e) => {
    if (!panelTouchStart) return;
    const diff = e.touches[0].clientY - panelTouchStart;
    if (diff > 60) {
      closePanel();
      panelTouchStart = null;
    }
  });

  busPanel.addEventListener('touchend', () => {
    panelTouchStart = null;
  });

  // Initial state
  updateBusCount();
})();
