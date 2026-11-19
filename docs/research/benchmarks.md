---
description: 'How fast smaltlp solves linear programs, timed beside HiGHS on the same problems and the same machine, and what warm starts save in branch-and-bound, with the method.'
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
| lp-50x75 | 50 × 75 | 2.28 | 0.97 | 0.23 | 2.4× | 10.0× | 23 | 29 | 28 |
| lp-150x225 | 150 × 225 | 5.48 | 3.90 | 2.05 | 1.4× | 2.7× | 55 | 73 | 73 |
| lp-300x450 | 300 × 450 | 14.9 | 6.71 | 2.71 | 2.2× | 5.5× | 93 | 77 | 77 |

Run 2026-11-19: smaltlp 0.14.0 on Node 22.23.5; HiGHS 1.16.0 (highspy) on Python 3.13.18. CPU: Intel(R) Xeon(R) Processor @ 2.10GHz. Every objective agrees within 1e-7, relative.

<!-- /bench:results -->

## What it shows

Both solvers take a similar number of iterations (the table's last columns), so the difference is in what each
iteration costs.

- **The sparse LU** (2026-11-18) replaced a dense one, whose solves cost O(m²) per iteration and whose
  refactorizations cost O(m³). On the same problems and the same VM, the dense LU's run (the first version of this
  page, in git) took 1.84, 11.8 and 111 ms. The gain grows with the rows, as the dense LU's cost did; the smallest
  problem is no faster.
- **The pivot row by rows, and a ratio test without a sort** (2026-11-19). Each iteration's pivot row ρᵀ[A −I] is
  summed over the rows where ρ isn't 0, not over every column, and the ratio test orders only the breakpoints that
  bound flips pass, where it had sorted every candidate. The iterations are the same; on the same VM, the build before
  (commit cfaa62d) took 2.35, 9.90 and 20.9 ms.
- **The smallest problem's time is mostly warm-up.** Each time is the median after a single warm-up run, and a solve
  of the 50-row problem takes well under a millisecond once the JavaScript engine has compiled it. The method stays as
  it is, so runs compare.
- **One machine, one run of each:** the cloud VM these ran on varies between runs, so read the ratios, not the last
  digit.

## Branch-and-bound: warm starts

How much starting each node from its parent's basis and factorization saves, against solving each node from the
start, in smaltlp alone. There is no HiGHS column here yet: HiGHS's MIP solver has cutting planes, heuristics and its own presolve, so a
time beside it would measure those, not this.

- **Problems,** from seeded generators (`bench/problems.mjs`):
  - multi-dimensional knapsacks: m rows of whole weights from 1 to 30, each row's capacity half its total, and n
    binary items worth 1 to 40;
  - capacitated facility location: F facilities to open or not (binary), with fixed costs and capacities, and
    continuous shipments to K customers, each of whose demands is met, at a cost per unit by distance. Rows × columns
    are K + F by F + F·K.
- **Both ways:** the same branch-and-bound, to a gap of 0, so both prove the same optimum. *Warm* starts every node
  below the root from its parent's optimal basis and a copy of its factorization; *cold* solves every node from the
  start, with presolve, as smaltlp did before warm starts.
- **Timing:** the median of 3 runs after a warm-up, in one process, on one thread.
- **Rerun:** `npm run bench:warm` (after `npm run build`), which writes the table below. `SMALTLP_DIST=path/to/dist
  node bench/warm.mjs` times another build, such as an older commit's, and prints its results.

<!-- bench:warm -->

| Problem | Rows × columns | Nodes | Iterations: warm | Iterations: cold | Warm, ms | Cold, ms | Warm ÷ cold, time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| knapsack-10x30 | 10 × 30 | 306 | 831 | 1981 | 22.2 | 48.9 | 0.45 |
| knapsack-15x50 | 15 × 50 | 548 / 550 | 2411 | 5998 | 43.4 | 213 | 0.20 |
| knapsack-20x60 | 20 × 60 | 1404 | 5463 | 14733 | 157 | 611 | 0.26 |
| knapsack-30x80 | 30 × 80 | 229 | 948 | 2690 | 33.5 | 132 | 0.25 |
| facility-10x30 | 40 × 310 | 70 | 584 | 4452 | 12.5 | 79.5 | 0.16 |
| facility-15x50 | 65 × 765 | 45 | 535 | 4202 | 13.5 | 110 | 0.12 |
| facility-20x60 | 80 × 1220 | 228 | 3191 | 27955 | 103 | 976 | 0.11 |

Run 2026-11-19: smaltlp 0.14.0 on Node 22.23.5. CPU: Intel(R) Xeon(R) Processor @ 2.10GHz. Both prove the same optimum.

<!-- /bench:warm -->

- **The same search, far fewer iterations.** Both ways visit the same nodes, give or take one or two where rounding
  differs; warm starts take 35% to 42% of the iterations on the knapsacks and 11% to 13% on facility location.
- **Each node, cheaper** (2026-11-19). A child starts from a copy of its parent's factorization rather than factoring
  its basis again, and computes its values from that factorization and its updates rather than factoring once more at
  the end; A's rows are built once for the whole search, not at every node. With the pivot row and ratio test above,
  the warm times, which were these at commit cfaa62d on the same VM, fell to between 0.36 and 0.92 of them:

  | Problem | Warm, ms, at cfaa62d | Warm, ms, now |
  | --- | ---: | ---: |
  | knapsack-10x30 | 24.1 | 22.2 |
  | knapsack-15x50 | 91.1 | 43.4 |
  | knapsack-20x60 | 280 | 157 |
  | knapsack-30x80 | 62.1 | 33.5 |
  | facility-10x30 | 22.9 | 12.5 |
  | facility-15x50 | 34.7 | 13.5 |
  | facility-20x60 | 283 | 103 |
