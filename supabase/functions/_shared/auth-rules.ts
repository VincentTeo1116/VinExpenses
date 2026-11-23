// The sign-in rules that can be checked without a server: password strength, email and code formats, day and month keys.

export const LIMITS = {
  codesPerDay: 3,
  codesPerMonth: 10,
  codeMinutes: 5,
  failsPerDevice: 5,
  failsPerEmail: 20,
  blockHours: 3,
  ipSignInsPerHour: 20,
  codeChecksPerHour: 10,
  passwordMin: 10,
  passwordMax: 72, // the sign-in service ignores anything after 72 bytes
};

export interface PasswordCheck {
  ok: boolean;
  /** Each rule and whether it is met, in the order they are shown under the field. */
  rules: { key: string; label: string; met: boolean }[];
}

export function checkPassword(password: string): PasswordCheck {
  const value = String(password ?? "");
  const rules = [
    { key: "length", label: `At least ${LIMITS.passwordMin} characters`, met: value.length >= LIMITS.passwordMin && value.length <= LIMITS.passwordMax },
    { key: "upper", label: "An upper-case letter", met: /[A-Z]/.test(value) },
    { key: "lower", label: "A lower-case letter", met: /[a-z]/.test(value) },
    { key: "digit", label: "A number", met: /\d/.test(value) },
    { key: "symbol", label: "A symbol (for example ! ? # @)", met: /[^A-Za-z0-9\s]/.test(value) },
  ];
  return { ok: rules.every((rule) => rule.met), rules };
}

/** A tidy lower-case address, or "" when it is not an email address. */
export function cleanEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) ? email : "";
}

export const isCode = (value: unknown): boolean => /^\d{6}$/.test(String(value ?? "").trim());
export const isDeviceId = (value: unknown): boolean => /^[A-Za-z0-9_-]{16,64}$/.test(String(value ?? ""));

export function cleanName(value: unknown): string {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name.length >= 2 && name.length <= 40 && !/[<>]/.test(name) ? name : "";
}

const KL_MS = 8 * 3600_000;
/** The start of today and of this month in Malaysia, as UTC instants, plus when today ends. */
export function periods(now: Date): { dayStart: string; monthStart: string; dayEnd: string; hourKey: string } {
  const local = new Date(now.getTime() + KL_MS);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - KL_MS;
  const month = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - KL_MS;
  return {
    dayStart: new Date(day).toISOString(),
    dayEnd: new Date(day + 24 * 3600_000).toISOString(),
    monthStart: new Date(month).toISOString(),
    hourKey: now.toISOString().slice(0, 13),
  };
}

/** Recovery codes look like "ABCDE-FGHJK": no 0/O/1/I, so they are easy to read back. */
export function newRecoveryCode(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = random(new Uint8Array(10));
  const text = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}
export const cleanRecoveryCode = (value: unknown): string => {
  const text = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return text.length === 10 ? `${text.slice(0, 5)}-${text.slice(5)}` : "";
};

/** The "aal" claim of a sign-in token: "aal2" once an authenticator code was given. Never trusted on its own. */
export function tokenAal(token: string): string {
  try {
    const part = token.split(".")[1] ?? "";
    const text = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const aal = JSON.parse(text)?.aal;
    return typeof aal === "string" ? aal : "";
  } catch (_error) {
    return "";
  }
}
