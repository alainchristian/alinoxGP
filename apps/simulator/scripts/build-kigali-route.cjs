// Builds the simulator's street-following route for central Kigali from OpenStreetMap data.
//
//   1. Download the drivable streets once (see the query in docs/SIMULATOR.md §12):
//        curl -A "<descriptive agent>" --data-urlencode 'data=[out:json][timeout:90];way["highway"~"^(primary|secondary|tertiary|residential|unclassified|trunk|primary_link|secondary_link)$"](-1.962,30.048,-1.936,30.080);out geom;' https://overpass-api.de/api/interpreter > osm-kigali.json
//   2. node apps/simulator/scripts/build-kigali-route.cjs osm-kigali.json > apps/simulator/src/kigali-streets-loop.ts
//
// The route is a closed circuit that visits a few landmarks and follows REAL streets between them (shortest path on the
// street graph, one-way streets respected), so simulated vehicles drive where vehicles can actually drive.
// Data: © OpenStreetMap contributors, licensed under the Open Database License (ODbL) — https://www.openstreetmap.org/copyright
// Not derived from any commercial directions API.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a plain Node script (CommonJS), run by hand
const fs = require('node:fs');

const file = process.argv[2];
if (!file) throw new Error('usage: build-kigali-route.cjs <overpass-json>');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

// Waypoints [lon, lat] around central Kigali, in driving order (the circuit is closed back to the first one).
const WAYPOINTS = [
  [30.0619, -1.9441],
  [30.0665, -1.9423],
  [30.0741, -1.9482],
  [30.0679, -1.9561],
  [30.0631, -1.9548],
  [30.0592, -1.9464],
];

const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

// ---- directed graph (one-way streets and roundabouts respected)
const coord = new Map(); // node id -> [lon, lat]
const adj = new Map(); // node id -> [{ to, w }]
const addEdge = (a, b) => {
  if (!adj.has(a)) adj.set(a, []);
  adj.get(a).push({ to: b, w: dist(coord.get(a), coord.get(b)) });
};
for (const way of data.elements) {
  if (way.type !== 'way' || !way.nodes || !way.geometry || way.nodes.length !== way.geometry.length) continue;
  way.nodes.forEach((id, i) => coord.set(id, [way.geometry[i].lon, way.geometry[i].lat]));
  const tags = way.tags || {};
  const reverse = tags.oneway === '-1';
  const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.junction === 'roundabout' || reverse;
  for (let i = 0; i + 1 < way.nodes.length; i++) {
    const a = way.nodes[i];
    const b = way.nodes[i + 1];
    if (!oneway) {
      addEdge(a, b);
      addEdge(b, a);
    } else if (reverse) addEdge(b, a);
    else addEdge(a, b);
  }
}

// ---- keep the largest strongly connected component, so every leg between two kept nodes has a path
function stronglyConnectedLargest() {
  const ids = [...adj.keys()];
  const radj = new Map();
  for (const [a, es] of adj) for (const { to } of es) (radj.get(to) ?? radj.set(to, []).get(to)).push(a);
  const seen = new Set();
  const order = [];
  for (const start of ids) {
    if (seen.has(start)) continue;
    const stack = [[start, 0]];
    seen.add(start);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const es = adj.get(top[0]) ?? [];
      if (top[1] < es.length) {
        const next = es[top[1]++].to;
        if (!seen.has(next)) {
          seen.add(next);
          stack.push([next, 0]);
        }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  }
  const comp = new Map();
  let best = [];
  for (const start of order.reverse()) {
    if (comp.has(start)) continue;
    const members = [];
    const stack = [start];
    comp.set(start, start);
    while (stack.length) {
      const n = stack.pop();
      members.push(n);
      for (const p of radj.get(n) ?? []) {
        if (comp.has(p)) continue;
        comp.set(p, start);
        stack.push(p);
      }
    }
    if (members.length > best.length) best = members;
  }
  return new Set(best);
}
const keep = stronglyConnectedLargest();

const nearest = (target) => {
  let bestId = null;
  let bestD = Infinity;
  for (const id of keep) {
    const d = dist(coord.get(id), target);
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  return { id: bestId, offMetres: bestD };
};

// ---- Dijkstra restricted to the kept component
function shortestPath(from, to) {
  const best = new Map([[from, 0]]);
  const prev = new Map();
  const heap = [[0, from]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, n] = pop();
    if (d > (best.get(n) ?? Infinity)) continue;
    if (n === to) break;
    for (const { to: m, w } of adj.get(n) ?? []) {
      if (!keep.has(m)) continue;
      const nd = d + w;
      if (nd < (best.get(m) ?? Infinity)) {
        best.set(m, nd);
        prev.set(m, n);
        push([nd, m]);
      }
    }
  }
  if (!best.has(to)) throw new Error('no path between two waypoints');
  const path = [];
  for (let n = to; n !== undefined; n = prev.get(n)) path.push(n);
  return path.reverse();
}

const snapped = WAYPOINTS.map(nearest);
const nodes = [];
const legs = [];
for (let i = 0; i < snapped.length; i++) {
  const leg = shortestPath(snapped[i].id, snapped[(i + 1) % snapped.length].id);
  legs.push(leg.length);
  nodes.push(...(nodes.length ? leg.slice(1) : leg));
}
// close the loop without repeating the first point
if (nodes[nodes.length - 1] === nodes[0]) nodes.pop();

const points = nodes.map((id) => coord.get(id)).map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))]);
const deduped = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
let length = 0;
for (let i = 0; i < deduped.length; i++) length += dist(deduped[i], deduped[(i + 1) % deduped.length]);

process.stderr.write(
  `graph nodes ${coord.size}, strongly connected ${keep.size}; waypoints snapped (m): ${snapped.map((s) => Math.round(s.offMetres)).join(', ')}; legs (nodes): ${legs.join(', ')}; points ${deduped.length}; loop length ${Math.round(length)} m\n`,
);

process.stdout.write(`/**
 * A closed circuit through central Kigali that FOLLOWS REAL STREETS (one-way streets respected), [longitude, latitude].
 * Generated by scripts/build-kigali-route.cjs from OpenStreetMap data — do not edit by hand; regenerate.
 * Data: © OpenStreetMap contributors, licensed under the Open Database License (ODbL): https://www.openstreetmap.org/copyright
 * Loop length: ${Math.round(length)} m.
 */
import type { LonLat } from './motion';

export const KIGALI_STREETS_LOOP: readonly LonLat[] = [
${deduped.map((p) => `  [${p[0]}, ${p[1]}],`).join('\n')}
];
`);
