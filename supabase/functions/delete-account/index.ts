import { json, preflight, requireUser } from "../_shared/guard.ts";

Deno.serve(async (request: Request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);

  const identity = await requireUser(request);
  if (identity instanceof Response) return identity;

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !serviceKey) return json(request, { error: "Server is not configured." }, 503);

  try {
    const deletion = await fetch(`${projectUrl}/auth/v1/admin/users/${encodeURIComponent(identity.userId)}`, {
      method: "DELETE",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    });
    if (!deletion.ok) {
      console.error("Supabase Auth account deletion failed:", deletion.status, await deletion.text());
      return json(request, { error: "Could not delete your account. Please try again." }, 502);
    }
    return json(request, { deleted: true });
  } catch (error) {
    console.error("Account deletion request failed:", error);
    return json(request, { error: "Could not reach the account service. Please try again." }, 503);
  }
});
