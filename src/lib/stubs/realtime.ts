// Stand-in for @supabase/realtime-js in the PRODUCTION BUILD ONLY (see slimSupabasePlugin in vite.config.mts).
// supabase-js creates a realtime client for every project whether it is used or not, which put about 60 KB of code
// (the realtime client and its socket library) into every first download. VinExpenses never uses realtime channels, so the
// real library is left out. If code ever tries to, it fails loudly instead of silently doing nothing.
// A test (src/test/slim-supabase.test.ts) compares this class with what the installed supabase-js actually calls.
const missing = (): never => {
  throw new Error('Realtime is not included in this build of VinExpenses.');
};

export class RealtimeClient {
  // supabase-js passes an address and options; neither is needed
  constructor() {
    // nothing to set up
  }
  /** Called by supabase-js whenever the sign-in token changes. There is no connection to give it to. */
  setAuth(): void {
    // no connection
  }
  channel(): never {
    return missing();
  }
  getChannels(): never[] {
    return [];
  }
  removeChannel(): Promise<string> {
    return Promise.resolve('ok');
  }
  removeAllChannels(): Promise<string[]> {
    return Promise.resolve([]);
  }
}
