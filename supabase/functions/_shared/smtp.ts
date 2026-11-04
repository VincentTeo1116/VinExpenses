// A small, strict SMTP client for sending ONE message over an encrypted connection (implicit TLS, port 465).
//
// Why 465 and not 587: Supabase Edge Functions block outgoing ports 25 and 587. Port 465 is open, and it is also the
// safer mode because the connection is encrypted from the very first byte (no plain-text "upgrade" step that could be
// stripped by an attacker). Certificates are verified by the runtime; there is no option to turn that off.
//
// Safety rules enforced here:
//   - every address, header value and credential is checked for CR / LF / NUL BEFORE anything is written, so nobody can
//     smuggle in extra recipients, headers or SMTP commands ("header / command injection");
//   - the message body is base64-encoded, so body text can never be mistaken for SMTP syntax;
//   - the password is only ever written inside the AUTH command and never appears in errors or logs;
//   - the server's replies are size-limited and every step has a timeout.

export interface Conn {
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  close(): void;
}
export type Connector = (host: string, port: number) => Promise<Conn>;

export interface SmtpAccount {
  host: string;
  port: number;
  user: string; // the Gmail address
  pass: string; // a Google "App Password"
}

export interface SmtpMessage {
  fromAddress: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers; only the names in ALLOWED_EXTRA_HEADERS are accepted. */
  headers?: Record<string, string>;
  now?: Date;
}

export class SmtpError extends Error {
  stage: SmtpStage;
  code: number;
  constructor(stage: SmtpStage, code: number, message: string) {
    super(message);
    this.name = "SmtpError";
    this.stage = stage;
    this.code = code;
  }
  /** 4xx replies and network trouble are worth retrying later; 5xx replies are not. */
  get retryable(): boolean {
    if (this.stage === "build") return false;
    return this.code === 0 || (this.code >= 400 && this.code < 500);
  }
}
export type SmtpStage = "connect" | "greeting" | "hello" | "auth" | "sender" | "recipient" | "data" | "send" | "build";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
/** Mutable only so the tests can shorten them. */
export const SMTP_TIMEOUTS = { stepMs: 15_000, totalMs: 40_000 };
const MAX_REPLY_BYTES = 16 * 1024;
const MAX_MESSAGE_BYTES = 400_000;
export const ALLOWED_EXTRA_HEADERS = new Set(["list-unsubscribe", "list-unsubscribe-post", "auto-submitted"]);

// ---------------------------------------------------------------- encoding helpers

export function hasLineBreak(value: string): boolean {
  return /[\r\n\u0000\u2028\u2029]/.test(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** base64, wrapped at 76 characters per line as MIME requires. */
export function wrapBase64(text: string): string {
  return (bytesToBase64(ENCODER.encode(text)).match(/.{1,76}/g) ?? []).join("\r\n");
}

/** RFC 2047 encoded-word(s) for header text that is not plain ASCII (so "Rental – June" survives). */
export function encodeHeaderText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value) && !value.includes("=?")) return value;
  const words: string[] = [];
  let chunk = "";
  for (const char of value) {
    if (ENCODER.encode(chunk + char).length > 42) { words.push(chunk); chunk = ""; }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${bytesToBase64(ENCODER.encode(word))}?=`).join("\r\n ");
}

/** "Name" part of a From header: encoded if needed, never able to contain a quote or angle bracket. */
function displayName(name: string): string {
  const clean = name.replace(/["<>\\]/g, "").trim();
  const encoded = encodeHeaderText(clean);
  return /^[A-Za-z0-9 .,&'()-]*$/.test(encoded) && encoded ? `"${encoded}"` : encoded;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Builds the complete message (headers + multipart body) with CRLF line ends. Throws SmtpError("build") if unsafe. */
export function buildMime(message: SmtpMessage): string {
  const fail = (why: string) => new SmtpError("build", 0, why);
  for (const [label, value] of [["from", message.fromAddress], ["to", message.to], ["name", message.fromName], ["subject", message.subject]] as const) {
    if (typeof value !== "string" || hasLineBreak(value)) throw fail(`The ${label} contains a line break.`);
  }
  if (/[<>\s,;"]/.test(message.fromAddress) || /[<>\s,;"]/.test(message.to)) throw fail("An address contains forbidden characters.");

  const boundary = `=_vx_${randomHex(16)}`;
  const domain = message.fromAddress.split("@")[1] ?? "localhost";
  const lines: string[] = [
    `Date: ${(message.now ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `From: ${displayName(message.fromName)} <${message.fromAddress}>`,
    `To: <${message.to}>`,
    `Subject: ${encodeHeaderText(message.subject)}`,
    `Message-ID: <${randomHex(16)}@${domain}>`,
    "MIME-Version: 1.0",
  ];
  for (const [name, value] of Object.entries(message.headers ?? {})) {
    if (!ALLOWED_EXTRA_HEADERS.has(name.toLowerCase())) throw fail(`Header not allowed: ${name}`);
    if (!/^[A-Za-z-]+$/.test(name) || typeof value !== "string" || hasLineBreak(value) || value.length > 900) throw fail(`Bad header value: ${name}`);
    lines.push(`${name}: ${value}`);
  }
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, "");
  for (const [type, body] of [["text/plain", message.text], ["text/html", message.html]] as const) {
    lines.push(`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrapBase64(body));
  }
  lines.push(`--${boundary}--`, "");
  const mime = lines.join("\r\n");
  if (mime.length > MAX_MESSAGE_BYTES) throw fail("The message is too large.");
  return mime;
}

/** Doubles a leading "." on any line, so the body can never end the DATA section early. */
export function dotStuff(mime: string): string {
  return mime.replace(/(^|\r\n)\./g, "$1..");
}

// ---------------------------------------------------------------- the conversation

class Session {
  private buffer = "";
  private deadline = Date.now() + SMTP_TIMEOUTS.totalMs;
  private conn: Conn;
  constructor(conn: Conn) {
    this.conn = conn;
  }

  private async withTimeout<T>(work: Promise<T>, stage: SmtpStage): Promise<T> {
    const left = Math.min(SMTP_TIMEOUTS.stepMs, this.deadline - Date.now());
    if (left <= 0) throw new SmtpError(stage, 0, "The mail server took too long.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SmtpError(stage, 0, "The mail server took too long.")), left); }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Reads one complete (possibly multi-line) reply and returns its code and text. */
  async reply(stage: SmtpStage): Promise<{ code: number; text: string }> {
    const collected: string[] = [];
    for (;;) {
      let newline = this.buffer.indexOf("\r\n");
      while (newline === -1) {
        if (this.buffer.length > MAX_REPLY_BYTES) throw new SmtpError(stage, 0, "The mail server sent an oversized reply.");
        const chunk = await this.withTimeout(this.conn.read(), stage);
        if (chunk === null) throw new SmtpError(stage, 0, "The mail server closed the connection.");
        this.buffer += DECODER.decode(chunk, { stream: true });
        newline = this.buffer.indexOf("\r\n");
      }
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 2);
      const match = line.match(/^(\d{3})([ -])(.*)$/s);
      if (!match) throw new SmtpError(stage, 0, "The mail server sent something that is not SMTP.");
      collected.push(match[3]);
      if (collected.join("").length > MAX_REPLY_BYTES) throw new SmtpError(stage, 0, "The mail server sent an oversized reply.");
      if (match[2] === " ") return { code: Number(match[1]), text: collected.join(" ") };
    }
  }

  async send(line: string, stage: SmtpStage): Promise<void> {
    await this.withTimeout(this.conn.write(ENCODER.encode(line)), stage);
  }

  async expect(stage: SmtpStage, okCodes: number[]): Promise<{ code: number; text: string }> {
    const reply = await this.reply(stage);
    if (!okCodes.includes(reply.code)) {
      // Only the numeric code is kept in the error; the server's wording is not passed on to callers.
      throw new SmtpError(stage, reply.code, `The mail server answered ${reply.code} during ${stage}.`);
    }
    return reply;
  }
}

export async function sendSmtp(account: SmtpAccount, message: SmtpMessage, connect: Connector): Promise<void> {
  if (account.port !== 465) throw new SmtpError("connect", 0, "Only port 465 (encrypted from the start) is allowed.");
  if (!/^[a-z0-9.-]{3,253}$/i.test(account.host)) throw new SmtpError("connect", 0, "Invalid mail server name.");
  for (const value of [account.user, account.pass]) {
    if (hasLineBreak(value) || !value) throw new SmtpError("auth", 0, "The mail account details contain forbidden characters.");
  }
  const mime = dotStuff(buildMime(message)); // build first: nothing is sent if the message is unsafe

  let conn: Conn;
  try {
    conn = await connect(account.host, account.port);
  } catch (_error) {
    throw new SmtpError("connect", 0, "Could not open an encrypted connection to the mail server.");
  }
  const session = new Session(conn);
  try {
    await session.expect("greeting", [220]);
    await session.send("EHLO vinexpenses\r\n", "hello");
    await session.expect("hello", [250]);
    const credentials = bytesToBase64(ENCODER.encode(`\u0000${account.user}\u0000${account.pass}`));
    await session.send(`AUTH PLAIN ${credentials}\r\n`, "auth");
    await session.expect("auth", [235]);
    await session.send(`MAIL FROM:<${message.fromAddress}>\r\n`, "sender");
    await session.expect("sender", [250]);
    await session.send(`RCPT TO:<${message.to}>\r\n`, "recipient");
    await session.expect("recipient", [250, 251]);
    await session.send("DATA\r\n", "data");
    await session.expect("data", [354]);
    await session.send(`${mime}.\r\n`, "send"); // the message already ends with CRLF
    await session.expect("send", [250]);
    try { await session.send("QUIT\r\n", "send"); } catch (_ignored) { /* already delivered */ }
  } finally {
    conn.close();
  }
}

// ---------------------------------------------------------------- the real connection (Deno)

export const denoConnector: Connector = async (host, port) => {
  // deno-lint-ignore no-explicit-any
  const deno = (globalThis as any).Deno;
  if (!deno?.connectTls) throw new Error("TLS connections are not available in this runtime.");
  const socket = await deno.connectTls({ hostname: host, port }); // certificate + hostname are verified by default
  return {
    async read() {
      const buffer = new Uint8Array(4096);
      const count = await socket.read(buffer);
      return count === null ? null : buffer.subarray(0, count);
    },
    async write(data: Uint8Array) {
      let offset = 0;
      while (offset < data.length) offset += await socket.write(data.subarray(offset));
    },
    close() {
      try { socket.close(); } catch (_ignored) { /* already closed */ }
    },
  };
};
