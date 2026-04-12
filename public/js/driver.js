/**
 * BusLocTrack — Driver Page Logic
 * Handles GPS tracking and location broadcasting
 */

(function () {
  'use strict';

  // DOM Elements
  const routeSelect = document.getElementById('route-select');
  const busNumberInput = document.getElementById('bus-number');
  const driverNameInput = document.getElementById('driver-name');
  const shareBtn = document.getElementById('share-btn');
  const shareBtnText = document.getElementById('share-btn-text');
  const driverForm = document.getElementById('driver-form');
  const statsGrid = document.getElementById('stats-grid');
  const mapContainer = document.getElementById('driver-map-container');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const infoGps = document.getElementById('info-gps');
  const infoSharing = document.getElementById('info-sharing');

  // Stats elements
  const statLat = document.getElementById('stat-lat');
  const statLng = document.getElementById('stat-lng');
  const statSpeed = document.getElementById('stat-speed');
  const statDuration = document.getElementById('stat-duration');

  // State
  let isSharing = false;
  let watchId = null;
  let startTime = null;
  let durationInterval = null;
  let map = null;
  let driverMarker = null;
  let accuracyCircle = null;

  // Socket.IO
  const socket = io();

  socket.on('connect', () => {
    statusDot.classList.add('connected');
    statusText.textContent = 'Connected';
    showToast('Connected to server', 'success');
  });

  socket.on('disconnect', () => {
    statusDot.classList.remove('connected', 'sharing');
    statusText.textContent = 'Disconnected';
    showToast('Disconnected from server', 'error');
  });

  // Enable/disable share button based on form
  function validateForm() {
    const routeSelected = routeSelect.value !== '';
    const busEntered = busNumberInput.value.trim().length > 0;
    shareBtn.disabled = !(routeSelected && busEntered);
  }

  routeSelect.addEventListener('change', validateForm);
  busNumberInput.addEventListener('input', validateForm);

  // Initialize mini map
  function initMap() {
    if (map) return;
    mapContainer.classList.remove('hidden');
    
    map = L.map('driver-map', {
      zoomControl: false,
      attributionControl: false
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    getMapTileLayer().addTo(map);

    // Fix map sizing after showing container
    setTimeout(() => map.invalidateSize(), 100);
  }

  // Update driver marker on map
  function updateMapMarker(lat, lng, accuracy) {
    if (!map) return;

    if (!driverMarker) {
      driverMarker = L.marker([lat, lng], {
        icon: createBusIcon(busNumberInput.value.trim() || 'Me')
      }).addTo(map);

      accuracyCircle = L.circle([lat, lng], {
        radius: accuracy || 50,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.1,
        weight: 1
      }).addTo(map);

      map.setView([lat, lng], 16);
    } else {
      driverMarker.setLatLng([lat, lng]);
      accuracyCircle.setLatLng([lat, lng]);
      if (accuracy) accuracyCircle.setRadius(accuracy);
      map.panTo([lat, lng]);
    }
  }

  // Start sharing location
  function startSharing() {
    if (!navigator.geolocation) {
      showToast('GPS not supported on this device', 'error');
      return;
    }

    const selectedOption = routeSelect.options[routeSelect.selectedIndex];
    const routeId = routeSelect.value;
    const routeName = selectedOption.dataset.name;
    const busNumber = busNumberInput.value.trim();
    const driverName = driverNameInput.value.trim() || 'Driver';

    // Tell server we're starting
    socket.emit('bus-start', {
      routeId,
      routeName,
      busNumber,
      driverName
    });

    // Start watching position
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed, heading, accuracy } = position.coords;

        // Send to server
        socket.emit('bus-location', {
          lat: latitude,
          lng: longitude,
          speed: speed || 0,
          heading: heading || 0,
          accuracy: accuracy || 0
        });

        // Update UI stats
        statLat.textContent = latitude.toFixed(4);
        statLng.textContent = longitude.toFixed(4);
        statSpeed.textContent = formatSpeed(speed);

        // Update map
        updateMapMarker(latitude, longitude, accuracy);
      },
      (error) => {
        console.error('GPS Error:', error);
        let msg = 'GPS error occurred';
        switch (error.code) {
          case 1: msg = 'Location permission denied. Please allow GPS access.'; break;
          case 2: msg = 'Location unavailable. Check your GPS settings.'; break;
          case 3: msg = 'Location request timed out. Retrying...'; break;
        }
        showToast(msg, 'error', 5000);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000
      }
    );

    // Update state  
    isSharing = true;
    startTime = Date.now();

    // UI updates
    shareBtn.className = 'share-btn stop';
    shareBtnText.innerHTML = '<span class="btn-ripple"></span>🛑 Stop Sharing';
    statusDot.classList.add('sharing');
    statusText.textContent = 'Sharing';
    statsGrid.classList.remove('hidden');
    infoGps.classList.add('hidden');
    infoSharing.classList.remove('hidden');

    // Disable form
    routeSelect.disabled = true;
    busNumberInput.disabled = true;
    driverNameInput.disabled = true;

    // Initialize map
    initMap();

    // Duration timer
    durationInterval = setInterval(() => {
      statDuration.textContent = formatDuration(startTime);
    }, 1000);

    showToast(`Sharing location for ${busNumber}`, 'success');
  }

  // Stop sharing location
  function stopSharing() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    socket.emit('bus-stop');

    isSharing = false;
    startTime = null;

    if (durationInterval) {
      clearInterval(durationInterval);
      durationInterval = null;
    }

    // UI updates
    shareBtn.className = 'share-btn start';
    shareBtnText.textContent = '📡 Start Sharing Location';
    statusDot.classList.remove('sharing');
    statusDot.classList.add('connected');
    statusText.textContent = 'Connected';
    infoGps.classList.remove('hidden');
    infoSharing.classList.add('hidden');

    // Re-enable form
    routeSelect.disabled = false;
    busNumberInput.disabled = false;
    driverNameInput.disabled = false;

    showToast('Location sharing stopped', 'info');
  }

  // Share button click
  shareBtn.addEventListener('click', () => {
    if (isSharing) {
      stopSharing();
    } else {
      startSharing();
    }
  });

  // Warn before leaving while sharing
  window.addEventListener('beforeunload', (e) => {
    if (isSharing) {
      e.preventDefault();
      e.returnValue = 'You are currently sharing your bus location. Are you sure you want to leave?';
    }
  });

  // Clean up on page hide (mobile)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isSharing) {
      // Keep sharing in background — GPS watchPosition persists
      console.log('Page hidden, GPS still active');
    }
  });
})();
