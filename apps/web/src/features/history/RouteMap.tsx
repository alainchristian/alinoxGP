import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { MapConfigDto } from '@gps/shared';
import { devStyle } from '../live/live-model';
import { boundsOf, segments, travelled, type PlayPoint, type PlayState } from './playback-model';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const ROUTE = 'route';
const DONE = 'travelled';
const NOW = 'now';
const ENDS = 'ends';
const empty = { type: 'FeatureCollection' as const, features: [] };
const cssVar = (name: string, fallback: string) => (typeof document === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

/**
 * The route of one journey: the whole line (split where the vehicle was not tracked), the part driven so far, start and end
 * points and the current position. Only a handful of GeoJSON features, so playback at 16× stays smooth; the map is created
 * once and its sources are updated, never recreated per frame.
 */
export function RouteMap({ config, points, breaks, current, currentTime }: { config: MapConfigDto; points: readonly PlayPoint[]; breaks: readonly number[]; current: PlayState | null; currentTime: number }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const tilesKey = `${config.provider}|${config.tiles?.join(',') ?? ''}`;

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({ container: el, style: devStyle(config) as never, center: [30.0619, -1.9441], zoom: 11, attributionControl: false });
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'The map could not be started');
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ customAttribution: config.attribution, compact: true }), 'bottom-right');
    map.on('load', () => {
      const brand = cssVar('--color-brand', '#2458e8');
      for (const id of [ROUTE, DONE, NOW, ENDS]) map.addSource(id, { type: 'geojson', data: empty });
      map.addLayer({ id: 'route-casing', type: 'line', source: ROUTE, paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'route-line', type: 'line', source: ROUTE, paint: { 'line-color': '#94a3b8', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'done-line', type: 'line', source: DONE, paint: { 'line-color': brand, 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      // Start (green) and end (dark) differ in shape as well as colour: the end is a ring.
      map.addLayer({ id: 'ends-start', type: 'circle', source: ENDS, filter: ['==', ['get', 'kind'], 'start'], paint: { 'circle-radius': 7, 'circle-color': '#16a34a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'ends-end', type: 'circle', source: ENDS, filter: ['==', ['get', 'kind'], 'end'], paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-color': '#0f172a', 'circle-stroke-width': 4 } });
      map.addLayer({ id: 'now-dot', type: 'circle', source: NOW, paint: { 'circle-radius': 9, 'circle-color': brand, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
      setReady(true);
    });
    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesKey]);

  // The route itself: set when the journey changes, then frame it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const lines = segments(points, breaks).filter((s) => s.length > 1).map((s) => s.map((p): [number, number] => [p.longitude, p.latitude]));
    (map.getSource(ROUTE) as GeoJSONSource).setData({ type: 'FeatureCollection', features: lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) });
    const first = points[0];
    const last = points[points.length - 1];
    (map.getSource(ENDS) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: first && last ? [{ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: [first.longitude, first.latitude] } }, { type: 'Feature', properties: { kind: 'end' }, geometry: { type: 'Point', coordinates: [last.longitude, last.latitude] } }] : [],
    });
    const b = boundsOf(points);
    if (b) map.fitBounds(b, { padding: 60, maxZoom: 16, duration: 0 });
  }, [points, breaks, ready]);

  // The position and the travelled part follow the playback clock.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(NOW) as GeoJSONSource).setData(current ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [current.longitude, current.latitude] } } : empty);
    const done = travelled(points, currentTime);
    (map.getSource(DONE) as GeoJSONSource).setData(done.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: done } } : empty);
  }, [current, currentTime, points, ready]);

  if (failure) {
    return <div className="grid h-full min-h-72 place-items-center bg-surface-2 p-6 text-center text-[13px] text-text-muted">The map could not be started on this device ({failure}). The trip details are still available.</div>;
  }
  return <div ref={container} className="h-full min-h-72 w-full" role="img" aria-label="Map of the selected journey" />;
}
