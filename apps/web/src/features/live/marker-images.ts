import type { VehicleStatus } from '@gps/shared';

/**
 * Marker artwork, drawn on a canvas so it needs no image files. Colour is never the only signal (gps-fleet-ui §2): every
 * status has its own SHAPE too — an arrow that turns with the heading, a pause mark, a "P", a square, a hollow circle,
 * a dashed circle. Colours come from the design tokens in index.css (the same ones the list badges use).
 */
export const MARKER_PIXEL_RATIO = 2;
const SIZE = 48;
const BADGE = 28;

const TOKEN: Record<VehicleStatus, string> = {
  MOVING: '--color-status-moving',
  IDLING: '--color-status-idling',
  PARKED: '--color-status-parked',
  STATIONARY: '--color-status-stationary',
  OFFLINE: '--color-status-offline',
  NO_DATA: '--color-status-offline',
};
const FALLBACK: Record<VehicleStatus, string> = {
  MOVING: '#17692e',
  IDLING: '#8a5a00',
  PARKED: '#2b4d8f',
  STATIONARY: '#475569',
  OFFLINE: '#556070',
  NO_DATA: '#556070',
};

function token(name: string, fallback: string): string {
  const v = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function canvas(size: number): { g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas is not available');
  return { g };
}

function drawStatus(status: VehicleStatus, color: string): ImageData {
  const { g } = canvas(SIZE);
  const mid = SIZE / 2;
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = '#ffffff';
  g.fillStyle = color;

  if (status === 'MOVING') {
    // A navigation arrow pointing up (north); the map rotates it to the vehicle's heading.
    g.beginPath();
    g.moveTo(mid, 3);
    g.lineTo(SIZE - 8, SIZE - 5);
    g.lineTo(mid, SIZE - 14);
    g.lineTo(8, SIZE - 5);
    g.closePath();
    g.stroke();
    g.fill();
  } else if (status === 'STATIONARY') {
    g.beginPath();
    g.roundRect(mid - 14, mid - 14, 28, 28, 6);
    g.stroke();
    g.fill();
  } else if (status === 'OFFLINE' || status === 'NO_DATA') {
    g.fillStyle = '#ffffff';
    g.strokeStyle = color;
    g.lineWidth = 4;
    if (status === 'NO_DATA') g.setLineDash([5, 4]);
    g.beginPath();
    g.arc(mid, mid, 14, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.setLineDash([]);
    if (status === 'OFFLINE') {
      g.beginPath();
      g.moveTo(mid - 9, mid + 9);
      g.lineTo(mid + 9, mid - 9);
      g.stroke();
    }
  } else {
    // IDLING (pause mark) and PARKED ("P") share a filled disc.
    g.beginPath();
    g.arc(mid, mid, 17, 0, Math.PI * 2);
    g.stroke();
    g.fill();
    g.fillStyle = '#ffffff';
    if (status === 'IDLING') {
      g.fillRect(mid - 7, mid - 8, 5, 16);
      g.fillRect(mid + 2, mid - 8, 5, 16);
    } else {
      g.font = 'bold 22px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('P', mid, mid + 1);
    }
  }
  return g.getImageData(0, 0, SIZE, SIZE);
}

function drawSimulatedBadge(color: string): ImageData {
  const { g } = canvas(BADGE);
  g.fillStyle = color;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(BADGE / 2, BADGE / 2, 11, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = 'bold 15px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('S', BADGE / 2, BADGE / 2 + 1);
  return g.getImageData(0, 0, BADGE, BADGE);
}

export const STATUS_IMAGE_PREFIX = 'veh-';
export const SIM_BADGE_IMAGE = 'sim-badge';

/** All images the map layers refer to, by image id. */
export function createMarkerImages(): Record<string, ImageData> {
  const images: Record<string, ImageData> = {};
  for (const status of Object.keys(TOKEN) as VehicleStatus[]) images[`${STATUS_IMAGE_PREFIX}${status}`] = drawStatus(status, token(TOKEN[status], FALLBACK[status]));
  images[SIM_BADGE_IMAGE] = drawSimulatedBadge(token('--color-brand', '#1d4ed8'));
  return images;
}
