/**
 * Mixed-integer linear programs: `milp()`, scipy.optimize.milp's interface over smaltlp's branch-and-bound.
 * @module
 */
export { milp, milpSync, type Bounds, type LinearConstraint, type MilpOptions, type MilpResult } from './milp.ts';
