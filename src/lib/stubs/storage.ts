// Stand-in for @supabase/storage-js in the PRODUCTION BUILD ONLY (see slimSupabasePlugin in vite.config.mts).
// supabase-js creates a file-storage client for every project whether it is used or not. VinExpenses stores no files in Supabase
// (receipts are read and then dropped), so the real library, about 25 KB of code, is left out of the first download.
// If code ever tries to use it, it fails loudly. A test (src/test/slim-supabase.test.ts) compares this with what supabase-js calls.
export class StorageApiError extends Error {
  override name = 'StorageApiError';
}

export class StorageClient {
  constructor() {
    // supabase-js passes the address, headers, fetch and options; none are needed
  }
  from(): never {
    throw new Error('File storage is not included in this build of VinExpenses.');
  }
}
