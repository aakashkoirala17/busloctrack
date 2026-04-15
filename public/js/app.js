/**
 * BusLocTrack — Shared Utilities
 */

// Deployment server URL - Change this to your live server URL
const SERVER_URL = 'https://busloctrack.onrender.com'; // Your live server URL
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
// If we are on localhost but inside Capacitor, we should still use the remote SERVER_URL
const IS_CAPACITOR = window.Capacitor || window.location.protocol === 'capacitor:';
const SOCKET_URL = IS_LOCAL && !IS_CAPACITOR ? window.location.origin : SERVER_URL;

// --- Authentication Logic ---
(function() {
  const authOverlay = document.getElementById('auth-overlay');
  const authForm = document.getElementById('auth-form');
  const nameField = document.getElementById('field-name');
  const authHeaderTitle = document.getElementById('auth-header-title');
  const authHeaderSubtitle = document.getElementById('auth-header-subtitle');
  const btnAuthSubmit = document.getElementById('btn-auth-submit');
  const btnToggleAuth = document.getElementById('btn-toggle-auth');
  const toggleText = document.getElementById('toggle-text');
  const authError = document.getElementById('auth-error');

  const phoneInput = document.getElementById('auth-phone');
  const nameInput = document.getElementById('auth-name');
  const passwordInput = document.getElementById('auth-password');

  if (!authOverlay || !authForm) return;

  let isSignUpMode = false;

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

  // Toggle between Sign In and Sign Up
  btnToggleAuth.addEventListener('click', () => {
    isSignUpMode = !isSignUpMode;
    
    if (isSignUpMode) {
      authHeaderTitle.textContent = 'Create Account';
      authHeaderSubtitle.textContent = 'Join BusLocTrack to start tracking';
      nameField.classList.remove('hidden');
      btnAuthSubmit.textContent = 'Create Account';
      toggleText.textContent = 'Already have an account?';
      btnToggleAuth.textContent = 'Sign In';
    } else {
      authHeaderTitle.textContent = 'Welcome Back';
      authHeaderSubtitle.textContent = 'Sign in to track buses in real-time';
      nameField.classList.add('hidden');
      btnAuthSubmit.textContent = 'Sign In';
      toggleText.textContent = "Don't have an account?";
      btnToggleAuth.textContent = 'Create Account';
    }
    
    authError.classList.add('hidden');
    authForm.reset();
  });

  // Handle Form Submission
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const phone = phoneInput.value.trim();
    const password = passwordInput.value.trim();
    const name = nameInput.value.trim();

    if (!phone || !password || (isSignUpMode && !name)) {
      showError('Please fill in all fields');
      return;
    }

    btnAuthSubmit.disabled = true;
    btnAuthSubmit.textContent = isSignUpMode ? 'Creating...' : 'Signing In...';
    authError.classList.add('hidden');

    const endpoint = isSignUpMode ? '/api/auth/signup' : '/api/auth/signin';
    const payload = isSignUpMode ? { name, phone, password } : { phone, password };

    try {
      const response = await fetch(SOCKET_URL + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (isSignUpMode) {
        showToast('Account created! Please sign in.', 'success');
        btnToggleAuth.click(); // Switch to Sign In mode
      } else {
        localStorage.setItem('busloctrack_token', data.token);
        localStorage.setItem('busloctrack_user', JSON.stringify(data.user));
        authOverlay.classList.add('hidden');
        showToast('Signed in successfully!', 'success');
        // Reload if on driver/passenger pages to refresh socket auth or state
        if (window.location.pathname !== '/') {
          window.location.reload();
        }
      }
    } catch (err) {
      showError(err.message);
    } finally {
      btnAuthSubmit.disabled = false;
      btnAuthSubmit.textContent = isSignUpMode ? 'Create Account' : 'Sign In';
    }
  });

  function showError(msg) {
    authError.textContent = msg;
    authError.classList.remove('hidden');
  }

  // Global Logout Helper
  window.logout = function() {
    localStorage.removeItem('busloctrack_token');
    localStorage.removeItem('busloctrack_user');
    window.location.href = '/';
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

// Dark map tile layer
function getMapTileLayer() {
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  });
}

// Default map center (Kathmandu, Nepal)
const DEFAULT_CENTER = [27.7172, 85.3240];
const DEFAULT_ZOOM = 13;
