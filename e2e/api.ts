import type { APIRequestContext } from '@playwright/test';

export const BACKEND = 'http://127.0.0.1:54321';
export const GOOD = 'Str0ng!Passw0rd';
export const NEW_GOOD = 'N3w!Passw0rd#xy';

let counter = 0;
/** A fresh address for each test, so tests that run at the same time never share a lockout or a code count. */
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now().toString(36)}${(counter += 1)}${Math.floor(Math.random() * 1e4)}@example.com`;

export async function seed(request: APIRequestContext, input: { email: string; password?: string; name?: string; confirmed?: boolean; factor?: boolean; google?: boolean; disabled?: boolean }) {
  const response = await request.post(`${BACKEND}/__test/seed`, { data: input });
  return (await response.json()) as { id: string; email: string };
}

export async function mailFor(request: APIRequestContext, email: string) {
  return (await (await request.get(`${BACKEND}/__test/mail?email=${encodeURIComponent(email)}`)).json()) as { kind: string; code: string }[];
}
