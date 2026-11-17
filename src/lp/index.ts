/**
 * Linear programs: `linprog()`, scipy.optimize.linprog's interface over smaltlp's dual simplex.
 * @module
 */
export { linprog, linprogSync, type Bound, type Constraints, type LinprogOptions, type LinprogResult } from './linprog.ts';
export type { Status } from './simplex.ts';
