import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre runs tile processing in a web worker. By default it derives the worker's URL from its own file location, which
// breaks in the production build (the worker file is not emitted) and in Vite's dev pre-bundling. Vite bundles the worker
// WITH its imports and gives us its URL, which is the same in development and in the build.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { VEHICLE_STATUSES, type MapConfigDto, type VehicleStatus } from '@gps/shared';
import { STATUS_META } from '../monitor/monitor-model';
import { devStyle, type Bounds, type FeatureCollection, type PointFeature, type TrailPoint } from './live-model';
import { MARKER_PIXEL_RATIO, SIM_BADGE_IMAGE, STATUS_IMAGE_PREFIX, createMarkerImages } from './marker-images';

export interface LiveMapProps {
  config: MapConfigDto;
  features: FeatureCollection;
  selectedId: string | null;
  /** The selected vehicle, drawn on its own layer on top of the clusters (null when it has no position). */
  selectedFeature: PointFeature | null;
  trail: readonly TrailPoint[];
  follow: boolean;
  /** Increment to ask the map to frame every vehicle. */
  fitRequest: number;
  bounds: Bounds | null;
  onSelect: (vehicleId: string | null) => void;
  /** The user dragged or zoomed the map themselves: follow mode must let go. */
  onUserMoved: () => void;
  /** Full-screen shows the whole live page (list and detail included), not just the canvas. */
  fullscreenContainer: HTMLElement | null;
}

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const DEFAULT_CENTER: [number, number] = [30.0619, -1.9441]; // Kigali (only until vehicles are known)
const DEFAULT_ZOOM = 11;
const VEHICLES = 'vehicles';
const SELECTED = 'selected';
const TRAIL = 'trail';
const CLUSTER_PROPS = Object.fromEntries(
  VEHICLE_STATUSES.map((s) => [s.toLowerCase(), ['+', ['case', ['==', ['get', 'status'], s], 1, 0]] as ExpressionSpecification]),
);

const cssVar = (name: string, fallback: string) => (typeof document === 'undefined' ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

/** "12 vehicles: 8 moving, 2 idling, 2 offline" — the breakdown shown when hovering a cluster. */
function describeCluster(p: Record<string, number>): string {
  const parts = VEHICLE_STATUSES.map((s) => ({ s, n: Number(p[s.toLowerCase()] ?? 0) })).filter((x) => x.n > 0).map((x) => `${x.n} ${STATUS_META[x.s as VehicleStatus].label.toLowerCase()}`);
  return `${p['point_count']} vehicles: ${parts.join(', ')}`;
}

/**
 * The map. All vehicles are ONE clustered GeoJSON source drawn by symbol layers — never one DOM marker per vehicle — so it
 * stays smooth with thousands (gps-fleet-ui §4). Data is pushed to the source at most once per animation frame. Only the
 * (few) cluster counts are DOM elements, which also avoids needing a font server for text labels.
 */
export function LiveMap(props: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const frame = useRef<number | null>(null);
  const didInitialFit = useRef(false);
  const lastFollow = useRef(0);

  // ---------------------------------------------------------------- create the map once per provider configuration
  const tilesKey = `${props.config.provider}|${props.config.tiles?.join(',') ?? ''}`;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({ container, style: devStyle(latest.current.config) as never, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, attributionControl: false, dragRotate: false, pitchWithRotate: false });
    } catch (err) {
      // No WebGL (old browser, blocked GPU): the vehicle list keeps working.
      setFailure(err instanceof Error ? err.message : 'The map could not be started');
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl({ container: latest.current.fullscreenContainer ?? undefined }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    const clusterLabels = new Map<number, Marker>();
    let labelTimer: ReturnType<typeof setTimeout> | null = null;
    const popup: Popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'cluster-popup' });

    const refreshClusterLabels = () => {
      labelTimer = null;
      if (!map.getSource(VEHICLES)) return;
      const seen = new Set<number>();
      // Exactly the clusters drawn right now (with their counts); a cluster can appear in several tiles, hence the de-duplication.
      for (const f of map.queryRenderedFeatures(undefined, { layers: ['clusters'] })) {
        const id = f.properties?.['cluster_id'] as number | undefined;
        if (id === undefined || seen.has(id)) continue;
        seen.add(id);
        const [lon, lat] = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
        let marker: Marker;
        const existing = clusterLabels.get(id);
        if (existing) marker = existing;
        else {
          const el = document.createElement('div');
          el.className = 'cluster-label';
          // The position must be set BEFORE the marker is added: MapLibre throws when it lays out a marker that has none.
          marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
          clusterLabels.set(id, marker);
        }
        marker.setLngLat([lon, lat]);
        marker.getElement().textContent = String(f.properties?.['point_count'] ?? '');
      }
      for (const [id, marker] of clusterLabels) {
        if (!seen.has(id)) {
          marker.remove();
          clusterLabels.delete(id);
        }
      }
    };
    const scheduleLabels = () => {
      if (!labelTimer) labelTimer = setTimeout(refreshClusterLabels, 200);
    };

    map.on('load', () => {
      for (const [id, data] of Object.entries(createMarkerImages())) map.addImage(id, data, { pixelRatio: MARKER_PIXEL_RATIO });

      map.addSource(TRAIL, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(SELECTED, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(VEHICLES, { type: 'geojson', data: latest.current.features as never, cluster: true, clusterRadius: 48, clusterMaxZoom: 14, clusterProperties: CLUSTER_PROPS });

      map.addLayer({ id: 'trail-line', type: 'line', source: TRAIL, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': cssVar('--color-brand', '#1d4ed8'), 'line-width': 4, 'line-opacity': 0.75 } });
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: VEHICLES,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#1e293b',
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 25, 200, 30],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: 'alert-ring',
        type: 'circle',
        source: VEHICLES,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'alert'], true]],
        paint: { 'circle-radius': 18, 'circle-color': 'rgba(180,35,24,0.10)', 'circle-stroke-color': cssVar('--color-danger', '#b42318'), 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'vehicle-icons',
        type: 'symbol',
        source: VEHICLES,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['concat', STATUS_IMAGE_PREFIX, ['get', 'status']],
          'icon-rotate': ['case', ['all', ['==', ['get', 'status'], 'MOVING'], ['==', ['get', 'hasHeading'], true]], ['get', 'heading'], 0],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': ['case', ['==', ['get', 'stale'], true], 0.65, 1] },
      });
      map.addLayer({
        id: 'vehicle-sim-badge',
        type: 'symbol',
        source: VEHICLES,
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'simulated'], true]],
        layout: { 'icon-image': SIM_BADGE_IMAGE, 'icon-offset': [10, -10], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 0.8 },
      });

      // The selected vehicle: its own source, on top of the clusters, so it is always visible and never counted in a cluster.
      map.addLayer({
        id: 'selected-halo',
        type: 'circle',
        source: SELECTED,
        paint: { 'circle-radius': 24, 'circle-color': 'rgba(29,78,216,0.14)', 'circle-stroke-color': cssVar('--color-brand', '#1d4ed8'), 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'selected-alert-ring',
        type: 'circle',
        source: SELECTED,
        filter: ['==', ['get', 'alert'], true],
        paint: { 'circle-radius': 18, 'circle-color': 'rgba(180,35,24,0.10)', 'circle-stroke-color': cssVar('--color-danger', '#b42318'), 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'selected-icon',
        type: 'symbol',
        source: SELECTED,
        layout: {
          'icon-image': ['concat', STATUS_IMAGE_PREFIX, ['get', 'status']],
          'icon-rotate': ['case', ['all', ['==', ['get', 'status'], 'MOVING'], ['==', ['get', 'hasHeading'], true]], ['get', 'heading'], 0],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-size': 1.15,
        },
      });
      map.addLayer({
        id: 'selected-sim-badge',
        type: 'symbol',
        source: SELECTED,
        filter: ['==', ['get', 'simulated'], true],
        layout: { 'icon-image': SIM_BADGE_IMAGE, 'icon-offset': [12, -12], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': 0.9 },
      });

      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['selected-icon', 'vehicle-icons', 'clusters'] });
        const cluster = hits.find((h) => h.properties?.['cluster_id'] !== undefined);
        const vehicle = hits.find((h) => h.properties?.['id'] !== undefined && h.properties?.['cluster_id'] === undefined);
        if (vehicle) return latest.current.onSelect(String(vehicle.properties?.['id']));
        if (cluster) {
          const source = map.getSource(VEHICLES) as GeoJSONSource;
          const [lon, lat] = (cluster.geometry as unknown as { coordinates: [number, number] }).coordinates;
          void source.getClusterExpansionZoom(Number(cluster.properties?.['cluster_id'])).then((zoom) => map.easeTo({ center: [lon, lat], zoom: zoom + 0.5, duration: 500 }));
          return;
        }
        latest.current.onSelect(null);
      });
      map.on('mousemove', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['selected-icon', 'vehicle-icons', 'clusters'] });
        map.getCanvas().style.cursor = hits.length > 0 ? 'pointer' : '';
        const cluster = hits.find((h) => h.properties?.['cluster_id'] !== undefined);
        if (cluster) {
          const [lon, lat] = (cluster.geometry as unknown as { coordinates: [number, number] }).coordinates;
          popup.setLngLat([lon, lat]).setText(describeCluster(cluster.properties as Record<string, number>)).addTo(map);
        } else popup.remove();
      });
      map.on('dragstart', () => latest.current.onUserMoved());
      map.on('wheel', () => latest.current.onUserMoved());
      map.on('sourcedata', (e) => {
        if (e.sourceId === VEHICLES && e.isSourceLoaded) scheduleLabels();
      });
      map.on('moveend', scheduleLabels);
      map.on('idle', scheduleLabels);

      setReady(true);
    });

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);

    return () => {
      resize.disconnect();
      if (labelTimer) clearTimeout(labelTimer);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = null;
      for (const m of clusterLabels.values()) m.remove();
      popup.remove();
      map.remove();
      mapRef.current = null;
      didInitialFit.current = false;
      setReady(false);
    };
  }, [tilesKey]);

  // ---------------------------------------------------------------- vehicles: at most one setData per animation frame
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      (mapRef.current?.getSource(VEHICLES) as GeoJSONSource | undefined)?.setData(latest.current.features as never);
    });
  }, [ready, props.features]);

  // First time vehicles with positions are known, frame them (unless the user already moved the map).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || didInitialFit.current || !props.bounds) return;
    didInitialFit.current = true;
    map.fitBounds(props.bounds, { padding: 70, maxZoom: 15, duration: 0 });
  }, [ready, props.bounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || props.fitRequest === 0 || !latest.current.bounds) return;
    map.fitBounds(latest.current.bounds, { padding: 70, maxZoom: 15, duration: 600 });
  }, [ready, props.fitRequest]);

  // ---------------------------------------------------------------- selection halo, trail, follow
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource(SELECTED) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: props.selectedFeature ? [props.selectedFeature] : [] } as never);
  }, [ready, props.selectedFeature]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource(TRAIL) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: props.trail.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: props.trail.map((p) => [...p]) } }] : [],
    });
  }, [ready, props.trail]);

  useEffect(() => {
    const map = mapRef.current;
    const center = props.selectedFeature?.geometry.coordinates;
    if (!ready || !map || !props.follow || !center) return;
    const nowMs = Date.now();
    if (nowMs - lastFollow.current < 800) return;
    lastFollow.current = nowMs;
    map.easeTo({ center, duration: 700, essential: true });
  }, [ready, props.follow, props.selectedFeature]);

  // Selecting a vehicle brings it into view if it is off screen.
  useEffect(() => {
    const map = mapRef.current;
    const pos = latest.current.selectedFeature?.geometry.coordinates;
    if (!ready || !map || !props.selectedId || !pos) return;
    if (!map.getBounds().contains(pos)) map.easeTo({ center: pos, duration: 500 });
  }, [ready, props.selectedId]);

  if (failure) {
    return (
      <div className="grid h-full place-items-center bg-surface-2 p-6 text-center" role="alert">
        <div>
          <p className="text-sm font-medium">The map could not be started</p>
          <p className="mt-1 max-w-sm text-[13px] text-text-muted">Your browser may not support WebGL or it is turned off. The vehicle list still works.</p>
        </div>
      </div>
    );
  }
  return <div ref={containerRef} className="h-full w-full" role="application" aria-label="Map of vehicle positions. The vehicle list gives keyboard access to every vehicle." />;
}
