// Picks the nearest named places out of an Overpass answer. Pure (no network, no Deno), so it is tested with plain Node.

export interface Place {
  name: string;
  /** What kind of place, in plain words ("cafe", "fast food", "supermarket"). */
  kind: string;
  /** Metres from the person, rounded to 5. */
  distance: number;
}

interface Element {
  lat?: unknown;
  lon?: unknown;
  center?: { lat?: unknown; lon?: unknown };
  tags?: Record<string, unknown>;
}

const KIND_KEYS = ["amenity", "shop", "tourism", "leisure"] as const;
// control characters and angle brackets become spaces, so a place name can never carry markup
const clean = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** "fast_food" -> "fast food" */
const humanKind = (value: unknown) => clean(value, 30).replace(/_/g, " ");

export function nearestPlaces(elements: unknown, lat: number, lon: number, limit = 10): Place[] {
  if (!Array.isArray(elements)) return [];
  const found: Place[] = [];
  for (const raw of elements as Element[]) {
    const tags = raw?.tags ?? {};
    const name = clean(tags.name, 80);
    const elementLat = raw?.lat ?? raw?.center?.lat;
    const elementLon = raw?.lon ?? raw?.center?.lon;
    if (!name || typeof elementLat !== "number" || typeof elementLon !== "number") continue;
    const dy = (elementLat - lat) * 111_320;
    const dx = (elementLon - lon) * 111_320 * Math.cos((lat * Math.PI) / 180);
    const distance = Math.round(Math.hypot(dx, dy) / 5) * 5;
    const kindKey = KIND_KEYS.find((k) => typeof tags[k] === "string" && tags[k] !== "yes");
    const place: Place = { name, kind: kindKey ? humanKind(tags[kindKey]) : "", distance };
    // the same name twice (a shop mapped as a point and as a building) is one place: keep the nearer
    const index = found.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (index >= 0) {
      if ((found[index] as Place).distance > distance) found[index] = place;
      continue;
    }
    found.push(place);
  }
  return found.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name)).slice(0, Math.max(1, Math.min(20, limit)));
}

/** Joins lists from different map services: one entry per name (the nearer one), nearest first, capped. */
export function mergePlaces(lists: Place[][], limit = 10): Place[] {
  const byName = new Map<string, Place>();
  for (const place of lists.flat()) {
    const key = place.name.toLowerCase();
    const known = byName.get(key);
    // keep the entry that has a kind, or else the nearer one
    if (!known || (!known.kind && place.kind) || (!!known.kind === !!place.kind && place.distance < known.distance)) byName.set(key, place);
  }
  return [...byName.values()].sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name)).slice(0, Math.max(1, Math.min(20, limit)));
}

/**
 * Turns a Photon (komoot) reverse-geocoding answer into the same list. Used when Overpass is busy or down: Photon is a separate
 * service over the same OpenStreetMap data. Only shops, restaurants, amenities, tourism and leisure places are kept.
 * Photon puts the point at `geometry.coordinates` as [lon, lat]; the same entry-and-merge rules as Overpass apply.
 */
export function placesFromPhoton(collection: unknown, lat: number, lon: number, limit = 10): Place[] {
  const features = (collection as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const elements: Element[] = [];
  for (const raw of features as { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }[]) {
    const properties = raw?.properties ?? {};
    const key = properties.osm_key;
    if (typeof key !== "string" || !(KIND_KEYS as readonly string[]).includes(key)) continue;
    const point = raw?.geometry?.coordinates;
    if (!Array.isArray(point)) continue;
    elements.push({ lon: point[0], lat: point[1], tags: { name: properties.name, [key]: properties.osm_value } });
  }
  return nearestPlaces(elements, lat, lon, limit);
}

/** True for a latitude and longitude that can be real. */
export const validCoordinates = (lat: unknown, lon: unknown): boolean =>
  typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
