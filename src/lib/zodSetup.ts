// SEC-01: the page policy forbids eval. Zod can try to compile its checks with `new Function` for speed (and fall back when it is
// refused); that attempt shows up as a policy violation. Switching the compiler off keeps the console clean and the policy strict.
import { z } from 'zod';

z.config({ jitless: true });
