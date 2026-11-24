import { dailyLimit, json, preflight, requireUser, takeQuota } from "../_shared/guard.ts";
import { mergePlaces, nearestPlaces, type Place, placesFromPhoton, validCoordinates } from "../_shared/nearby.ts";

const DEFAULT_REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "VinExpenses/1.0 (personal expense tracker; nearby merchant suggestion)";
const LOOKUP_MS = 6000;

// The nearest named shops, restaurants and amenities within `radius` metres (the person picks one).
// THROWS when the service could not be asked (busy, down, blocked), so "the service failed" is never mistaken for "nothing nearby".
async function overpassPlaces(lat: number, lon: number, radius: number): Promise<Place[]> {
  const endpoint = Deno.env.get("OVERPASS_URL") || "https://overpass-api.de/api/interpreter";
  // four simple key filters are much cheaper for Overpass than one regular expression over every key
  const around = `(around:${radius},${lat},${lon})`;
  const query = `[out:json][timeout:6];(${["amenity", "shop", "tourism", "leisure"].map((key) => `nwr${around}[name][${key}];`).join("")});out center 60;`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(LOOKUP_MS),
  });
  if (!response.ok) throw new Error(`overpass status ${response.status}`);
  return nearestPlaces((await response.json()).elements, lat, lon, 20);
}

// A second, separate service over the same OpenStreetMap data (Photon). Overpass is often at capacity, so both are asked at once.
async function photonPlaces(lat: number, lon: number, radius: number): Promise<Place[]> {
  const endpoint = Deno.env.get("PHOTON_URL") || "https://photon.komoot.io/reverse";
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ lat: String(lat), lon: String(lon), radius: String(radius / 1000), limit: "40", lang: "en" }).toString();
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(LOOKUP_MS) });
  if (!response.ok) throw new Error(`photon status ${response.status}`);
  return placesFromPhoton(await response.json(), lat, lon, 20);
}

// Asks both services together and joins the answers. Throws only when BOTH failed; an empty list means the map really has nothing there.
async function nearbyList(lat: number, lon: number, radius: number): Promise<Place[]> {
  const [overpass, photon] = await Promise.allSettled([overpassPlaces(lat, lon, radius), photonPlaces(lat, lon, radius)]);
  if (overpass.status === "rejected") console.error("nearby-place overpass failed", overpass.reason);
  if (photon.status === "rejected") console.error("nearby-place photon failed", photon.reason);
  if (overpass.status === "rejected" && photon.status === "rejected") throw new Error("no map service answered");
  return mergePlaces([overpass.status === "fulfilled" ? overpass.value : [], photon.status === "fulfilled" ? photon.value : []], 10);
}

// Nearest named shop / restaurant / amenity within 80 m, or "" when none (or the service is down)
async function overpassNearest(lat: number, lon: number): Promise<string> {
  const endpoint = Deno.env.get("OVERPASS_URL") || "https://overpass-api.de/api/interpreter";
  const filter = '[name][~"^(amenity|shop|tourism|leisure)$"~"."]';
  const query = `[out:json][timeout:8];(node(around:80,${lat},${lon})${filter};way(around:80,${lat},${lon})${filter};);out center 20;`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "VinExpenses/1.0 (personal expense tracker; nearby merchant suggestion)" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(9000),
    });
    if (!response.ok) {
      console.error("nearby-place overpass status", response.status);
      return "";
    }
    const data = await response.json();
    let best = "";
    let bestDistance = Infinity;
    for (const element of data.elements || []) {
      const name = element.tags?.name;
      const elementLat = element.lat ?? element.center?.lat;
      const elementLon = element.lon ?? element.center?.lon;
      if (!name || typeof elementLat !== "number" || typeof elementLon !== "number") continue;
      const dy = (elementLat - lat) * 111_320;
      const dx = (elementLon - lon) * 111_320 * Math.cos((lat * Math.PI) / 180);
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) { best = String(name); bestDistance = distance; }
    }
    return best;
  } catch (error) {
    console.error("nearby-place overpass failed", error);
    return "";
  }
}

Deno.serve(async (request: Request) => {
  const early = preflight(request);
  if (early) return early;
  const jsonResponse = (body: Record<string, unknown>, status = 200) => json(request, body, status);
  if (request.method !== "POST") return jsonResponse({ error: "Use POST for nearby place lookup." }, 405);

  // Signed-in users only, with a daily allowance, so this never becomes an open relay.
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;
  if (!(await takeQuota(`nearby:${auth.userId}`, dailyLimit("NEARBY_DAILY_LIMIT", 200)))) {
    return jsonResponse({ error: "Daily nearby-place limit reached. Enter the merchant manually." }, 429);
  }

  try {
    const body = await request.json();
    const lat = Number(body.latitude);
    const lon = Number(body.longitude);
    if (!validCoordinates(lat, lon) || typeof body.latitude === "string" || typeof body.longitude === "string") {
      return jsonResponse({ error: "The location coordinates are invalid." }, 400);
    }

    // A list of the closest places to choose from; the single-name answer further down is kept for older callers.
    if (body.list === true) {
      try {
        let places = await nearbyList(lat, lon, 150);
        if (!places.length) places = await nearbyList(lat, lon, 300);
        return jsonResponse({ places });
      } catch (_error) {
        return jsonResponse({ error: "The map services did not answer. Try again in a moment, or enter the merchant manually." }, 502);
      }
    }

    // Set PLACE_REVERSE_URL to switch to a compatible provider without changing the web app.
    const endpoint = Deno.env.get("PLACE_REVERSE_URL") || DEFAULT_REVERSE_ENDPOINT;
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      format: "jsonv2",
      lat: String(lat),
      lon: String(lon),
      zoom: "18",
      addressdetails: "1",
      namedetails: "1",
    }).toString();
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "VinExpenses/1.0 (personal expense tracker; nearby merchant suggestion)", "Accept-Language": "en" },
    });
    if (!response.ok) {
      // Nominatim often blocks cloud servers, so fall back to Overpass.
      console.error("nearby-place upstream status", response.status);
      const fallback = await overpassNearest(lat, lon);
      if (fallback) return jsonResponse({ name: fallback.slice(0, 80) });
      return jsonResponse({ error: `The map services did not answer (${response.status}). Try again later or enter the merchant manually.` }, 502);
    }

    const result = await response.json();
    const address = result.address || {};
    const placeName = result.name || address.amenity || address.shop || address.restaurant || address.cafe || address.leisure || address.building || result.display_name?.split(",")[0] || "";
    if (!placeName) return jsonResponse({ error: "No mapped place found nearby. Enter the merchant manually." }, 404);
    return jsonResponse({ name: String(placeName).slice(0, 80) });
  } catch (_error) {
    return jsonResponse({ error: "Nearby place lookup failed. Please enter the merchant manually." }, 500);
  }
});
