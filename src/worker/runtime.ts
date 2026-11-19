/**
 * The worker side of `@smaltworks/smaltlp/worker`: answers solve requests on a port. The package's worker script
 * (`dist/worker/worker.js`) calls serve(self); call it yourself to serve smaltlp from a worker of your own.
 * @module
 */
import { SmaltlpError } from '../core/errors.ts';
import { mpsToProblem } from '../io/index.ts';
import { linprogSync } from '../lp/linprog.ts';
import { milpSync } from '../mip/milp.ts';
import type { Port, Request, Response, Result } from './protocol.ts';

/** Answers smaltlp requests that arrive on `port`, one at a time, in order. */
export function serve(port: Port): void {
  port.addEventListener('message', (event) => {
    const req = event.data as Request;
    if (!req || typeof req !== 'object' || typeof req.id !== 'number') return;
    let response: Response;
    try {
      response = { id: req.id, ok: true, result: handle(req) };
    } catch (e) {
      const err = e as Error;
      response = { id: req.id, ok: false, error: { ...(e instanceof SmaltlpError ? { code: e.code } : {}), message: err?.message ?? String(e) } };
    }
    port.postMessage(response);
  });
  port.start?.();
}

function handle(req: Request): Result {
  switch (req.op) {
    case 'linprog':
      return { kind: 'linprog', result: linprogSync(req.c, req.options) };
    case 'milp':
      return { kind: 'milp', result: milpSync(req.c, req.options) };
    case 'solve': {
      // The model as problemToModel made it: one constraint per row, in order, so the answers map back by place.
      const prob = mpsToProblem(req.model);
      const stats = prob.solveSync(req.options);
      const vars = prob.variables();
      const cons = prob.constraints();
      return {
        kind: 'solve',
        solved: { stats, varValue: vars.map((v) => v.varValue), dj: vars.map((v) => v.dj), pi: cons.map((c) => c.pi), slack: cons.map((c) => c.slack) },
      };
    }
    default:
      throw new SmaltlpError('LP_PARAM', `unknown operation ${String((req as { op: unknown }).op)}`);
  }
}
