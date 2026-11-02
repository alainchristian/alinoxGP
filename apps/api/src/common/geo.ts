const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Implied speed in km/h between two fixes (minimum interval 1 s so identical timestamps cannot divide by zero). */
export function impliedSpeedKmh(distanceM: number, intervalMs: number): number {
  return (distanceM / Math.max(1, intervalMs / 1000)) * 3.6;
}
