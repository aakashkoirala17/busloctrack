/**
 * BusLocTrack — Shared Utilities
 */

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
function createBusIcon(busNumber) {
  return L.divIcon({
    className: 'bus-marker-icon',
    html: `
      <div class="bus-marker">
        <span>🚌</span>
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
