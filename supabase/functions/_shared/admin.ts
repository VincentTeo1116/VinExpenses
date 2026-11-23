// Who is an administrator, and the record of what administrators did.

import { q, rest } from "./db.ts";

export async function isAdmin(userId: string): Promise<boolean> {
  const response = await rest(`app_admins?select=user_id&user_id=eq.${q(userId)}`);
  if (!response.ok) throw new Error(`app_admins lookup failed (${response.status}). Has supabase-schema.sql been run?`);
  return (await response.json()).length === 1;
}

/** Adds one line to the admin log. The log can't be edited afterwards. A failure to write it stops the action. */
export async function audit(adminId: string, action: string, targetUser: string | null, detail = ""): Promise<void> {
  const response = await rest("admin_audit_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ admin_id: adminId, action, target_user: targetUser, detail: detail.slice(0, 300) || null }),
  });
  if (!response.ok) throw new Error(`audit log ${response.status}`);
}
