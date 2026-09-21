let watchId = null;
let current = null;
let currentHeading = null;
let lastPositionTimestamp = null;
let logs = [];

const $ = (id) => document.getElementById(id);

function toRad(d) { return d * Math.PI / 180; }
function toDeg(r) { return r * 180 / Math.PI; }
function norm360(d) { return (d % 360 + 360) % 360; }

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp/2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function bearingDegrees(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) -
            Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return norm360(toDeg(Math.atan2(y, x)));
}

function getTarget() {
  const lat = parseFloat($("targetLat").value);
  const lon = parseFloat($("targetLon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function updateNavigation() {
  const target = getTarget();
  if (!current || !target) return;

  const distance = distanceMeters(current.lat, current.lon, target.lat, target.lon);
  const bearing = bearingDegrees(current.lat, current.lon, target.lat, target.lon);

  $("distance").textContent = distance.toFixed(1);
  $("bearing").textContent = `${bearing.toFixed(1)}°`;

  if (currentHeading !== null) {
    const relative = norm360(bearing - currentHeading);
    $("relative").textContent = `${relative.toFixed(1)}°`;
    $("arrow").style.transform = `rotate(${relative}deg)`;
    $("status").textContent = distance < 8 ? "Near target" : "Navigating";
  } else {
    $("relative").textContent = "No heading";
    $("arrow").style.transform = "rotate(0deg)";
    $("status").textContent = "GPS active; compass unavailable";
  }

  logSample(distance, bearing);
}

function logSample(distance, bearing) {
  if (!current) return;
  logs.push({
    timestamp: new Date().toISOString(),
    latitude: current.lat,
    longitude: current.lon,
    accuracy_m: current.accuracy,
    heading_deg: currentHeading ?? "",
    distance_to_target_m: Number.isFinite(distance) ? distance : "",
    bearing_to_target_deg: Number.isFinite(bearing) ? bearing : ""
  });
  $("samples").textContent = logs.length;
}

function onPosition(pos) {
  const c = pos.coords;
  current = {
    lat: c.latitude,
    lon: c.longitude,
    accuracy: c.accuracy
  };

  $("lat").textContent = c.latitude.toFixed(7);
  $("lon").textContent = c.longitude.toFixed(7);
  $("accuracy").textContent = `${c.accuracy.toFixed(1)} m`;

  if (lastPositionTimestamp !== null) {
    const interval = (pos.timestamp - lastPositionTimestamp) / 1000;
    $("interval").textContent = `${interval.toFixed(2)} s`;
  }
  lastPositionTimestamp = pos.timestamp;

  updateNavigation();
}

function onPositionError(err) {
  $("status").textContent = `Location error: ${err.message}`;
}

function handleOrientation(event) {
  let heading = null;

  // iOS Safari may expose webkitCompassHeading directly.
  if (typeof event.webkitCompassHeading === "number") {
    heading = event.webkitCompassHeading;
  } else if (event.absolute === true && typeof event.alpha === "number") {
    // alpha is clockwise from device coordinate frame; convert to compass-like heading.
    heading = norm360(360 - event.alpha);
  } else if (typeof event.alpha === "number") {
    heading = norm360(360 - event.alpha);
  }

  if (heading !== null) {
    currentHeading = heading;
    $("heading").textContent = `${heading.toFixed(1)}°`;
    updateNavigation();
  }
}

async function enableOrientation() {
  try {
    if (typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function") {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== "granted") {
        $("status").textContent = "Motion/orientation permission not granted";
        return;
      }
    }
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
  } catch (e) {
    $("status").textContent = `Compass error: ${e.message}`;
  }
}

async function startTest() {
  if (!navigator.geolocation) {
    $("status").textContent = "Geolocation not supported by this browser";
    return;
  }

  await enableOrientation();

  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  $("status").textContent = "Requesting GPS...";
  watchId = navigator.geolocation.watchPosition(
    onPosition,
    onPositionError,
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000
    }
  );
}

$("startBtn").addEventListener("click", startTest);

$("useCurrentBtn").addEventListener("click", () => {
  if (!current) {
    $("status").textContent = "Start GPS first, then use current location as target";
    return;
  }
  $("targetLat").value = current.lat;
  $("targetLon").value = current.lon;
  $("status").textContent = "Target set to current location";
  updateNavigation();
});

$("downloadBtn").addEventListener("click", () => {
  if (!logs.length) return;
  const headers = Object.keys(logs[0]);
  const rows = [
    headers.join(","),
    ...logs.map(row => headers.map(h => JSON.stringify(row[h] ?? "")).join(","))
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `whichway-web-spike-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

$("clearBtn").addEventListener("click", () => {
  logs = [];
  $("samples").textContent = "0";
});
