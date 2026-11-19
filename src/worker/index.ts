/**
 * Solves in a Web Worker, so a long solve doesn't freeze the page (smaltworks ADR 0039, section 9; the pattern of
 * smaltml's worker). The worker runs the same solvers and sends the results back; `solve()` writes a model's answers
 * onto your problem, as `prob.solve()` does. Code already off the page's main thread (a notebook kernel, Node) can
 * call the solvers directly instead.
 * @module
 */
import { fail } from '../core/errors.ts';
import { problemToModel } from '../io/index.ts';
import type { LinprogOptions, LinprogResult } from '../lp/linprog.ts';
import type { MilpOptions, MilpResult } from '../mip/milp.ts';
import type { LpProblem, LpSolveStats, SolveOptions } from '../model/index.ts';
import { toError, type Port, type Request, type Response, type Result } from './protocol.ts';

export type { Port } from './protocol.ts';
export { serve } from './runtime.ts';

/** A request without its id: Omit, taken over each kind of request. */
type Body = DistributiveOmit<Request, 'id'>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** smaltlp in a worker: the same solves, run off the calling thread. */
export interface LpWorker {
  /** {@link linprog}, in the worker. */
  linprog(c: ArrayLike<number>, options?: LinprogOptions): Promise<LinprogResult>;
  /** {@link milp}, in the worker. */
  milp(c: ArrayLike<number>, options?: MilpOptions): Promise<MilpResult>;
  /**
   * Solves `prob` in the worker, then sets its variables' `varValue` and `dj` and its constraints' `pi` and `slack`,
   * as `prob.solve()` does, and resolves to the stats.
   */
  solve(prob: LpProblem, options?: SolveOptions): Promise<LpSolveStats>;
  /** Stops the worker (or closes the port), and fails the requests still waiting. */
  terminate(): void;
}

/** Talks to smaltlp served on `port`: a Worker running smaltlp's worker script, or a port that serve() answers. */
export function connect(port: Port & { terminate?(): void; close?(): void }): LpWorker {
  let next = 1;
  const waiting = new Map<number, { resolve(r: Result): void; reject(e: Error): void }>();
  port.addEventListener('message', (event) => {
    const res = event.data as Response;
    const w = waiting.get(res?.id);
    if (!w) return;
    waiting.delete(res.id);
    if (res.ok) w.resolve(res.result);
    else w.reject(toError(res.error));
  });
  port.start?.();
  const call = (req: Body): Promise<Result> => {
    const id = next++;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      try {
        port.postMessage({ ...req, id });
      } catch (e) {
        waiting.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  };
  const checkOptions = (options: unknown) => {
    if (options !== null && typeof options !== 'object') fail('LP_PARAM', 'options must be an object');
  };
  return {
    async linprog(c, options = {}) {
      checkOptions(options);
      const r = await call({ op: 'linprog', c: Array.from(c), options });
      return r.kind === 'linprog' ? r.result : fail('LP_FORMAT', 'the worker sent no linprog result back');
    },
    async milp(c, options = {}) {
      checkOptions(options);
      const r = await call({ op: 'milp', c: Array.from(c), options });
      return r.kind === 'milp' ? r.result : fail('LP_FORMAT', 'the worker sent no milp result back');
    },
    async solve(prob, options = {}) {
      checkOptions(options);
      const r = await call({ op: 'solve', model: problemToModel(prob), options });
      if (r.kind !== 'solve') fail('LP_FORMAT', 'the worker sent no solve back');
      const { solved } = r;
      prob.variables().forEach((v, j) => {
        v.varValue = solved.varValue[j] ?? null;
        v.dj = solved.dj[j] ?? null;
      });
      prob.constraints().forEach((con, i) => {
        con.pi = solved.pi[i] ?? null;
        con.slack = solved.slack[i] ?? null;
      });
      return solved.stats;
    },
    terminate() {
      if (port.terminate) port.terminate();
      else port.close?.();
      for (const w of waiting.values()) w.reject(new Error('the smaltlp worker was stopped'));
      waiting.clear();
    },
  };
}

/**
 * Starts smaltlp's worker script and connects to it. `url` defaults to `worker.js` beside this module, where the
 * package builds it; pass your bundler's URL for it (`new URL('@smaltworks/smaltlp/worker-script', import.meta.url)`)
 * when it moves files.
 */
export function startWorker(url: string | URL = new URL('./worker.js', import.meta.url)): LpWorker {
  const W = (globalThis as { Worker?: new (url: string | URL, options: object) => Port & { terminate(): void } }).Worker;
  if (typeof W !== 'function') fail('LP_UNSUPPORTED', "Web Workers aren't available here: call the solvers directly, or serve() on a port of your own");
  return connect(new W(url, { type: 'module', name: 'smaltlp' }));
}
