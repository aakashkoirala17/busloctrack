/**
 * BusLocTrack — Driver Page Logic
 * Handles GPS tracking and location broadcasting
 */

(function () {
  'use strict';

  // DOM Elements
  const busNameInput = document.getElementById('bus-name');
  const routeNameInput = document.getElementById('route-name');
  const busNumberInput = document.getElementById('bus-number');
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
  let backgroundWatchId = null;
  let startTime = null;
  let durationInterval = null;
  let map = null;
  let driverMarker = null;
  let accuracyCircle = null;
  const BackgroundGeolocation = window.Capacitor?.Plugins?.BackgroundGeolocation || null;
  const App = window.Capacitor?.Plugins?.App || null;

  // Socket.IO
  const token = localStorage.getItem('busloctrack_token');
  const socket = io(SOCKET_URL, {
    auth: { token }
  });

  // Handle socket auth errors
  socket.on('connect_error', (err) => {
    console.error('Socket Auth Error:', err.message);
    if (err.message.includes('Authentication error')) {
      showToast('Session expired. Please log in again.', 'error');
      setTimeout(() => logout(), 2000);
    }
  });

  // Load saved driver details (try server first, then fallback to local)
  async function loadSavedDetails() {
    const token = localStorage.getItem('busloctrack_token');
    
    // Try to fetch from server first
    try {
      const response = await fetch(`${SOCKET_URL}/api/user/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const profile = await response.json();
        if (profile.busDetails) {
          const { busName, routeName, busNumber } = profile.busDetails;
          if (busName) busNameInput.value = busName;
          if (routeName) routeNameInput.value = routeName;
          if (busNumber) busNumberInput.value = busNumber;
          validateForm();
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch profile from server, using local fallback', e);
    }

    // Fallback to local storage
    const saved = localStorage.getItem('driver_details');
    if (saved) {
      try {
        const details = JSON.parse(saved);
        if (details.busName) busNameInput.value = details.busName;
        if (details.routeName) routeNameInput.value = details.routeName;
        if (details.busNumber) busNumberInput.value = details.busNumber;
        validateForm();
      } catch (e) {
        console.error('Error loading saved details', e);
      }
    }
  }

  // Save driver details
  async function saveDetails() {
    const details = {
      busName: busNameInput.value.trim(),
      routeName: routeNameInput.value.trim(),
      busNumber: busNumberInput.value.trim()
    };
    
    // Save locally
    localStorage.setItem('driver_details', JSON.stringify(details));

    // Async save to server
    const token = localStorage.getItem('busloctrack_token');
    try {
      await fetch(`${SOCKET_URL}/api/user/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ busDetails: details })
      });
    } catch (e) {
      console.error('Failed to sync details with server', e);
    }
  }

  loadSavedDetails();

  // Handle Android Back Button
  if (App) {
    App.addListener('backButton', ({ canGoBack }) => {
      if (isSharing) {
        // If sharing, show a confirmation or just don't exit the sharing mode
        if (window.confirm('You are sharing location. Do you want to stop sharing and go back?')) {
          stopSharing();
          window.location.href = '/';
        }
      } else if (canGoBack) {
        window.history.back();
      } else {
        window.location.href = '/';
      }
    });
  }

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
    const busNameEntered = busNameInput.value.trim().length > 0;
    const routeEntered = routeNameInput.value.trim().length > 0;
    const busNumEntered = busNumberInput.value.trim().length > 0;
    shareBtn.disabled = !(busNameEntered && routeEntered && busNumEntered);
  }

  busNameInput.addEventListener('input', validateForm);
  routeNameInput.addEventListener('input', validateForm);
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

  // Initial location request
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // We don't show the map yet, but we'll use this location
        // when the map is finally initialized
        console.log('Driver location found:', latitude, longitude);
      },
      (err) => console.warn('Driver location error:', err),
      { enableHighAccuracy: true, timeout: 5000 }
    );
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
  async function startSharing() {
    if (!navigator.geolocation) {
      showToast('GPS not supported on this device', 'error');
      return;
    }

    const busName = busNameInput.value.trim();
    const routeName = routeNameInput.value.trim();
    const busNumber = busNumberInput.value.trim();

    // Save details for next time
    saveDetails();

    // Tell server we're starting
    socket.emit('bus-start', {
      busName,
      routeName,
      busNumber
    });

    const isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform();

    if (isCapacitor && BackgroundGeolocation) {
      // Use Capacitor Background Geolocation
      try {
        backgroundWatchId = await BackgroundGeolocation.addWatcher(
          {
            backgroundMessage: "Cancel to prevent battery drain.",
            backgroundTitle: "BusLocTrack is tracking your location",
            requestPermissions: true,
            stale: false,
            distanceFilter: 10
          },
          (location, error) => {
            if (error) {
              if (error.code === "NOT_AUTHORIZED") {
                if (window.confirm("This app needs your location, but does not have permission.\n\nOpen settings now?")) {
                  BackgroundGeolocation.openSettings();
                }
              }
              return console.error(error);
            }

            const { latitude, longitude, speed, bearing, accuracy } = location;

            // Send to server
            socket.emit('bus-location', {
              lat: latitude,
              lng: longitude,
              speed: speed || 0,
              heading: bearing || 0,
              accuracy: accuracy || 0
            });

            // Update UI stats
            statLat.textContent = latitude.toFixed(4);
            statLng.textContent = longitude.toFixed(4);
            statSpeed.textContent = formatSpeed(speed);

            // Update map
            updateMapMarker(latitude, longitude, accuracy);
          }
        );
      } catch (err) {
        console.error('Background Geolocation Error:', err);
        showToast('Failed to start background tracking', 'error');
        return;
      }
    } else {
      // Use standard Geolocation
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
    }

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
    busNameInput.disabled = true;
    routeNameInput.disabled = true;
    busNumberInput.disabled = true;

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

    if (backgroundWatchId !== null && BackgroundGeolocation) {
      BackgroundGeolocation.removeWatcher({ id: backgroundWatchId });
      backgroundWatchId = null;
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
    busNameInput.disabled = false;
    routeNameInput.disabled = false;
    busNumberInput.disabled = false;

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

  // Disconnect on back button
  const backBtn = document.getElementById('btn-back');
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      // Don't disconnect socket here if we want background to work
      // only disconnect if we aren't sharing
      if (!isSharing) {
        socket.disconnect();
      }
    });
  }

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
