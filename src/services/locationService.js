import * as Location from 'expo-location';
import { VIBE_RADIUS_M } from '../constants';

// Geohashing utilities for privacy-preserving location sharing
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat, lon, precision = 6) {
  let isEven = true;
  let bits = 0, bitsTotal = 0, hashValue = 0;
  let maxLat = 90, minLat = -90;
  let maxLon = 180, minLon = -180;
  let geohash = '';

  while (geohash.length < precision) {
    if (isEven) {
      const mid = (maxLon + minLon) / 2;
      if (lon > mid) { hashValue = (hashValue << 1) + 1; minLon = mid; }
      else { hashValue = hashValue << 1; maxLon = mid; }
    } else {
      const mid = (maxLat + minLat) / 2;
      if (lat > mid) { hashValue = (hashValue << 1) + 1; minLat = mid; }
      else { hashValue = hashValue << 1; maxLat = mid; }
    }
    isEven = !isEven;
    bits++;
    if (bits === 5) {
      geohash += BASE32[hashValue];
      bits = 0;
      hashValue = 0;
    }
  }
  return geohash;
}

export function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isWithinRadius(userLat, userLon, placeLat, placeLon, radiusMeters) {
  return getDistanceMeters(userLat, userLon, placeLat, placeLon) <= radiusMeters;
}

export async function checkSavedPlacesAndAutoPlay(userLocation, savedPlaces, onArrive) {
  if (!userLocation) return;
  for (const place of savedPlaces) {
    if (isWithinRadius(userLocation.latitude, userLocation.longitude, place.lat, place.lon, place.radius)) {
      onArrive(place);
      break;
    }
  }
}
