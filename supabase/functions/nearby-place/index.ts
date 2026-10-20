const DEFAULT_REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Use POST for nearby place lookup." }, 405);

  try {
    const body = await request.json();
    const lat = Number(body.latitude);
    const lon = Number(body.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return jsonResponse({ error: "The location coordinates are invalid." }, 400);
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
      // Public Nominatim often blocks shared cloud addresses (403). Fall back to the Overpass API,
      // which lists named shops and amenities around the point.
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
