---
description: 'How fast smaltlp solves linear programs, timed beside HiGHS on the same problems and the same machine, with the method.'
---

# Benchmarks

How long smaltlp takes to solve linear programs, timed beside HiGHS: the same problems, read from the same MPS files,
on the same machine. ADR 0039 sets no speed goal yet ("Still to decide", item 1); this page says where smaltlp stands,
so one can be set. No speed claim about smaltlp stands without a benchmark here that anyone can rerun.

## Method

- **Problems:** three sizes, 50 × 75, 150 × 225 and 300 × 450 (rows × columns), made by a seeded generator
  (`bench/data.mjs`) and written as MPS files that both solvers read. Each is feasible and bounded: every row `a·x ≤ b`
  with `b` at least `a·x₀` for a point `x₀` inside the boxes, every variable between 0 and 10, costs of both signs,
  about 10% of the matrix non-zero. These are our own problems, small and well scaled: easier than Netlib's, which
  come later.
- **smaltlp:** the built package (`dist/`), in Node, `linprogSync` on the problem read with `readMps`: one thread, its
  dual simplex with a sparse LU, after its presolve. These problems have no empty or singleton rows and no fixed
  variables, so the presolve removes nothing from them: this benchmark doesn't measure it.
- **HiGHS:** highspy, the version pinned in `compare/requirements.txt`, in two settings: its defaults (presolve, its
  choice of solver), and the work smaltlp does: the serial dual simplex (`simplex_strategy` 1) without presolve. The
  solver is cleared before every run, so no basis carries over.
- **Timing:** the median of 7 runs (3 for the largest), after a warm-up run, in one process; the solve alone, not the
  reading of the file.
- **Rerun:** `npm run bench` (smaltlp), `npm run bench:python` (HiGHS; needs `compare/requirements.txt`), then
  `npm run bench:report`, which writes the table below from `bench/results/` and fails if an objective disagrees.

`smaltlp ÷ …` is how many times longer smaltlp takes than HiGHS in that setting: below 1 is faster.

## Results

<!-- bench:results -->

| Problem | Rows × columns | smaltlp, ms | HiGHS, defaults, ms | HiGHS, serial dual simplex, no presolve, ms | smaltlp ÷ HiGHS, defaults | smaltlp ÷ HiGHS, serial dual simplex, no presolve | Iterations: smaltlp | Iterations: HiGHS, defaults | Iterations: HiGHS, serial dual simplex, no presolve |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| lp-50x75 | 50 × 75 | 2.06 | 0.57 | 0.22 | 3.6× | 9.2× | 23 | 29 | 28 |
| lp-150x225 | 150 × 225 | 8.02 | 2.57 | 1.27 | 3.1× | 6.3× | 55 | 73 | 73 |
| lp-300x450 | 300 × 450 | 21.8 | 5.90 | 2.51 | 3.7× | 8.7× | 93 | 77 | 77 |

Run 2026-11-18: smaltlp 0.14.0 on Node 22.23.5; HiGHS 1.16.0 (highspy) on Python 3.13.18. CPU: Intel(R) Xeon(R) Processor @ 2.10GHz. Every objective agrees within 1e-7, relative.

<!-- /bench:results -->

## What it shows

Both solvers take a similar number of iterations (the table's last columns), so the difference is in what each
iteration costs.

- **The sparse LU** (2026-11-18) replaced a dense one, whose solves cost O(m²) per iteration and whose
  refactorizations cost O(m³). On the same problems and the same VM, the dense LU's run (the first version of this
  page, in git) took 1.84, 11.8 and 111 ms. The gain grows with the rows, as the dense LU's cost did; the smallest
  problem is no faster.
- **The smallest problem's time is mostly warm-up.** Each time is the median after a single warm-up run, and a solve
  of the 50-row problem takes well under a millisecond once the JavaScript engine has compiled it. The method stays as
  it is, so runs compare.
- **One machine, one run of each:** the cloud VM these ran on varies between runs, so read the ratios, not the last
  digit.
