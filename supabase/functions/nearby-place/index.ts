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
      headers: { Accept: "application/json", "User-Agent": "VinExpenses/1.0" },
    });
    if (!response.ok) return jsonResponse({ error: "Nearby place lookup is temporarily unavailable." }, 502);

    const result = await response.json();
    const address = result.address || {};
    const placeName = result.name || address.amenity || address.shop || address.restaurant || address.cafe || address.leisure || address.building || result.display_name?.split(",")[0] || "";
    if (!placeName) return jsonResponse({ error: "No mapped place found nearby. Enter the merchant manually." }, 404);
    return jsonResponse({ name: String(placeName).slice(0, 80) });
  } catch (_error) {
    return jsonResponse({ error: "Nearby place lookup failed. Please enter the merchant manually." }, 500);
  }
});
