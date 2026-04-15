/**
 * BusLocTrack — Shared Utilities
 */

// Deployment server URL - Change this to your live server URL
const SERVER_URL = 'https://busloctrack.onrender.com'; // Your live server URL
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
// If we are on localhost but inside Capacitor, we should still use the remote SERVER_URL
const IS_CAPACITOR = window.Capacitor || window.location.protocol === 'capacitor:';
const SOCKET_URL = IS_LOCAL && !IS_CAPACITOR ? window.location.origin : SERVER_URL;

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyC96fkl5Jzs2uBjjidw3nz9V83CDzyyot8",
  authDomain: "studio-3264384714-e1ead.firebaseapp.com",
  projectId: "studio-3264384714-e1ead",
  storageBucket: "studio-3264384714-e1ead.firebasestorage.app",
  messagingSenderId: "818570224559",
  appId: "1:818570224559:web:76ca2c1596cc7d6beb055a"
};

// Initialize Firebase
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
}

// --- Authentication Logic ---
(function() {
  const authOverlay = document.getElementById('auth-overlay');
  const btnGoogleAuth = document.getElementById('btn-google-auth');
  const authError = document.getElementById('auth-error');

  if (!authOverlay || !btnGoogleAuth) return;

  // Check if user is already logged in
  const token = localStorage.getItem('busloctrack_token');
  if (!token) {
    authOverlay.classList.remove('hidden');
  } else {
    // Show personalized welcome
    const user = JSON.parse(localStorage.getItem('busloctrack_user') || '{}');
    const welcomeEl = document.getElementById('landing-welcome');
    if (welcomeEl && user.name) {
      welcomeEl.innerHTML = `Welcome back, <strong>${user.name}</strong> 👋`;
    }
  }

  // Handle Google Sign-In
  btnGoogleAuth.addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    authError.classList.add('hidden');
    btnGoogleAuth.disabled = true;
    btnGoogleAuth.innerHTML = '<span>Signing In...</span>';

    try {
      // Use signInWithPopup for easiest flow
      const result = await firebase.auth().signInWithPopup(provider);
      const user = result.user;
      const idToken = await user.getIdToken();

      // Sync with our backend
      const response = await fetch(SOCKET_URL + '/api/auth/firebase-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Backend synchronization failed');
      }

      // Store local session
      localStorage.setItem('busloctrack_token', data.token);
      localStorage.setItem('busloctrack_user', JSON.stringify(data.user));
      
      authOverlay.classList.add('hidden');
      showToast(`Welcome, ${data.user.name}!`, 'success');
      
      // Reload welcome message
      const welcomeEl = document.getElementById('landing-welcome');
      if (welcomeEl) {
        welcomeEl.innerHTML = `Welcome back, <strong>${data.user.name}</strong> 👋`;
      }

      // Reload if on driver/passenger pages
      if (window.location.pathname !== '/') {
        window.location.reload();
      }
    } catch (err) {
      console.error('Auth Error:', err);
      showError(err.message || 'Google Sign-In failed');
    } finally {
      btnGoogleAuth.disabled = false;
      btnGoogleAuth.innerHTML = `
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google Logo">
        <span>Sign in with Google</span>
      `;
    }
  });

  function showError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  // Global Logout Helper
  window.logout = function() {
    firebase.auth().signOut().then(() => {
      localStorage.removeItem('busloctrack_token');
      localStorage.removeItem('busloctrack_user');
      window.location.href = '/';
    });
  };
})();

// Toast notification system
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Calculate distance between two GPS coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

// Format distance
function formatDistance(km) {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`;
  }
  return `${km.toFixed(1)}km`;
}

// Format speed (m/s to km/h)
function formatSpeed(speedMs) {
  if (!speedMs || speedMs < 0) return '0';
  return Math.round(speedMs * 3.6).toString();
}

// Format time ago
function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Format duration (mm:ss)
function formatDuration(startTime) {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Estimate ETA based on distance and speed
function estimateETA(distanceKm, speedKmh) {
  if (!speedKmh || speedKmh < 1) return '—';
  const hours = distanceKm / speedKmh;
  const minutes = Math.round(hours * 60);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `~${h}h ${m}m`;
}

// Create custom bus marker icon for Leaflet
function createBusIcon(busNumber, isFavorite = false) {
  return L.divIcon({
    className: `bus-marker-icon ${isFavorite ? 'favorite' : ''}`,
    html: `
      <div class="bus-marker">
        <span>🚌</span>
        ${isFavorite ? '<div class="marker-star">⭐</div>' : ''}
      </div>
      <div class="bus-marker-label">${busNumber || 'Bus'}</div>
    `,
    iconSize: [40, 55],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
  });
}

// Create "my location" marker
function createMyLocationIcon() {
  return L.divIcon({
    className: 'my-location-icon',
    html: `
      <div class="my-location-ring"></div>
      <div class="my-location-marker" style="position:absolute;top:12px;left:12px;"></div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });
}

// Light map tile layer
function getMapTileLayer() {
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  });
}

// Default map center (Kathmandu, Nepal)
const DEFAULT_CENTER = [27.7172, 85.3240];
const DEFAULT_ZOOM = 13;
