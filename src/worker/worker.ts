// smaltlp's worker script (dist/worker/worker.js): serves solves to startWorker() on the page.
import { serve } from './runtime.ts';
import type { Port } from './protocol.ts';

serve(globalThis as unknown as Port);
