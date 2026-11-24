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
| lp-50x75 | 50 × 75 | 1.91 | 0.70 | 0.25 | 2.7× | 7.6× | 23 | 29 | 28 |
| lp-150x225 | 150 × 225 | 4.17 | 2.98 | 1.50 | 1.4× | 2.8× | 55 | 73 | 73 |
| lp-300x450 | 300 × 450 | 12.5 | 6.96 | 2.91 | 1.8× | 4.3× | 93 | 77 | 77 |

Run 2026-11-23: smaltlp 0.14.0 on Node 22.23.5; HiGHS 1.16.0 (highspy) on Python 3.13.18. CPU: Intel(R) Xeon(R) Processor @ 2.10GHz. Every objective agrees within 1e-7, relative.

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
| knapsack-10x30 | 10 × 30 | 208 | 1014 | 1481 | 24.0 | 50.7 | 0.47 |
| knapsack-15x50 | 15 × 50 | 418 | 2641 | 4798 | 78.1 | 141 | 0.56 |
| knapsack-20x60 | 20 × 60 | 1267 | 6421 | 13464 | 197 | 639 | 0.31 |
| knapsack-30x80 | 30 × 80 | 197 | 3160 | 4246 | 84.8 | 145 | 0.59 |
| facility-10x30 | 40 × 310 | 40 | 660 | 2070 | 9.95 | 23.5 | 0.42 |
| facility-15x50 | 65 × 765 | 33 | 843 | 2197 | 19.7 | 32.8 | 0.60 |
| facility-20x60 | 80 × 1220 | 147 | 3819 | 16057 | 96.7 | 252 | 0.38 |

Run 2026-11-24: smaltlp 0.14.0 on Node 22.23.5. CPU: Intel(R) Xeon(R) Processor @ 2.10GHz. Both prove the same optimum.

<!-- /bench:warm -->

- **The same search, far fewer iterations.** Both ways visit the same nodes; warm starts take 48% to 74% of the
  iterations on the knapsacks and 24% to 38% on facility location. With the most fractional rule (the run of
  2026-11-19, in git) they took 35% to 42% and 11% to 13%: reliability branching's strong branching solves count in
  both columns, and always start from the node's basis.
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
- **The pivot row's nonzeros only** (2026-11-19). Each iteration lists the entries of the pivot row its rows touch, and
  the ratio test and the reduced costs' update visit those alone, where they had visited all n + m variables; where
  the touched rows hold n + m entries or more, the row is dense and they visit everything, as before. Its work vectors
  are made once per solve. The search is the same, iteration for iteration (ties go to the lower column, whatever the
  order). Measured with `bench/compare.mjs` (both builds in one process, alternating; the median of 25 runs, 9 for the
  20 × 60 problems), against the build before (commit 9fc3dd5), new ÷ old: knapsacks 0.89, 0.83, 0.76 and 1.01;
  facility location 0.77, 0.91 and 0.79; the LP problems 0.92, 0.97 and 0.99, so no gain there, where the rows are
  dense.
- **Less copying around the LP** (2026-11-23). `fromTriplets`, which turns entries into a sparse matrix (`linprog`'s
  input, presolve's reduced problem), bucketed each column and sorted it with a comparator; it now buckets by row,
  then by column, so each column comes out in row order with no sort and no garbage. And presolve that removes nothing
  solves the problem as it is, without copying it. With `bench/compare.mjs` against the build before (commit c75f13c),
  new ÷ old: the LP problems 0.73, 0.78 and 0.79, with the same iterations. The integer programs take a node or a few
  iterations more or fewer, since the root's factorization now carries to its children (0.77 to 1.04).
- **The LU's working storage in typed arrays** (2026-11-23). The factorization kept the active submatrix's rows as
  `Map`s and its columns as `Set`s; it now keeps each as a typed array, with row p's entries scattered by column for
  each elimination step. It picks the same pivots in the same order, so every answer is the same to the last bit (the
  benchmark problems' `x`, `fun`, duals and node counts, checked against the build before). With `bench/compare.mjs`
  against the build before (commit 0f935c9), three runs, new ÷ old: the LP problems 0.84 to 0.87, 0.89 to 0.91 and
  0.86 to 0.87. The integer programs refactor rarely, and moved both ways between runs (0.41 to 2.36 on the same
  problem), with no change that rises above the noise.
- **The LU's pivot search by lists, and its storage reused** (2026-11-23). A solve factors two or three times (the
  first basis, every 64 changes of basis, and once more at the end), so the cost was each factorization, not how many:
  factoring lp-300x450's first basis, the identity, took 366 µs. Each step scanned every active row and column for the
  shortest; they are now kept in lists by their count of entries. And the rows and columns, which were two small typed
  arrays apiece each time, now share two pools kept between factorizations. Factoring alone, on lp-300x450's three
  bases: 366, 834 and 815 µs before; 32, 213 and 212 µs after. The new lists can break a tie between pivots another
  way: the LP problems' answers are the same to the last bit, and two knapsacks take one iteration fewer, with the same
  solutions and nodes. With `bench/compare.mjs` against the build before (commit c1a387c), three runs, new ÷ old: the
  LP problems 0.78 to 0.84, 0.85 to 0.86 and 0.74 to 0.91; the integer programs within the noise, as before.
- **Timing on a shared VM:** runs in separate processes moved by ±40% here on problems under 30 ms. Comparing two builds
  is reliable only in one process, alternating them: `node bench/compare.mjs old/dist new/dist`.

## Branch-and-bound: harder problems

The problems above solve in a few hundred nodes, each a handful of simplex iterations, so they show what a node costs
but not how well the search chooses where to go. These take thousands to tens of thousands of nodes, which is where a
branching rule, cuts or heuristics show.

- **Problems,** from the same generators (`bench/problems.mjs`, `HARD_MIPS`): knapsacks of 10 rows and 100, 150 and
  200 items, and of 20 rows and 200; facility location with 30 facilities and 80 customers, and 40 and 100.
- **The search:** branch-and-bound to a gap of 0, from one build, with each branching rule: reliability branching (the
  default, 2026-11-24) and the most fractional column, as before.
- **Timing:** one run of each, in one process, the default's first. The larger take tens of seconds, so their times move little from run to
  run; the smaller move more.
- **Rerun:** `npm run bench:hard` (about two minutes), which writes the table below. `SMALTLP_DIST=path/to/dist node
  bench/hard.mjs` times another build and prints its results.

<!-- bench:hard -->

| Problem | Rows × columns | Nodes: reliability | Nodes: most fractional | Iterations: reliability | Iterations: most fractional | Seconds: reliability | Seconds: most fractional | Reliability ÷ most fractional, time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| knapsack-10x100 | 10 × 100 | 5,018 | 5,425 | 23,717 | 22,967 | 0.9 | 0.9 | 0.91 |
| knapsack-10x150 | 10 × 150 | 9,594 | 16,035 | 46,095 | 68,058 | 2.2 | 3.7 | 0.60 |
| knapsack-20x200 | 20 × 200 | 28,447 | 41,649 | 160,823 | 226,183 | 19.0 | 37.4 | 0.51 |
| knapsack-10x200 | 10 × 200 | 36,515 | 58,583 | 199,074 | 286,130 | 27.6 | 41.1 | 0.67 |
| facility-30x80 | 110 × 2430 | 499 | 974 | 7,622 | 10,876 | 0.4 | 0.9 | 0.47 |
| facility-40x100 | 140 × 4040 | 1,763 | 3,120 | 22,800 | 37,522 | 1.3 | 2.6 | 0.51 |

Run 2026-11-24: smaltlp 0.14.0 on Node 22.23.5. CPU: Intel(R) Xeon(R) Processor @ 2.10GHz. One run of each. Both prove the same optimum.

<!-- /bench:hard -->

- **Reliability branching** (2026-11-24) chooses the column to branch on by its pseudocosts (Achterberg, Koch and
  Martin, 2005): the bound's gain per unit, down and up, averaged over the children solved so far; a column with fewer
  than four on a side has its two children solved there and then (strong branching), and they are kept. It needs fewer
  nodes on every problem here and above. On these it takes 0.47 to 0.91 of the most fractional rule's time. On the
  smaller problems above, which solve in a few hundred nodes, the extra solves cost more than the nodes they save: with
  both rules in one process, alternating, two runs, reliability ÷ most fractional was 1.39 and 1.50, 1.20 and 1.23,
  1.03 and 1.14, 2.76 and 3.05 on the knapsacks, and 1.08 and 1.13, 1.64 and 1.67, 1.02 and 1.03 on facility location,
  at most about 70 ms more (knapsack-30x80).
