#!/usr/bin/env python3
"""Times HiGHS (highspy) on the benchmark problems that bench/smaltlp.mjs makes (run it first): each read from the same
MPS file, the median of several runs after a warm-up, the solver cleared before each run so no basis carries over.
Two settings: HiGHS's defaults, and the work smaltlp does: the serial dual simplex (simplex_strategy 1), no presolve.
(Setting threads to 1 fails in highspy 1.16.0 once HiGHS's thread pool has started; the serial dual simplex runs on one
thread.) Writes bench/results/highs.json.

    python3 bench/reference.py
"""
import json, platform, time
from pathlib import Path
import highspy

here = Path(__file__).resolve().parent
data = here / "data"

SETTINGS = {
    "HiGHS, defaults": {},
    "HiGHS, serial dual simplex, no presolve": {"solver": "simplex", "simplex_strategy": 1, "presolve": "off"},
}

def solve(path, options):
    h = highspy.Highs()
    h.setOptionValue("output_flag", False)
    for k, v in options.items():
        h.setOptionValue(k, v)
    assert h.readModel(str(path)) == highspy.HighsStatus.kOk
    return h

def median(h, reps):
    h.clearSolver(); h.run()
    ts = []
    for _ in range(reps):
        h.clearSolver()
        t = time.perf_counter(); h.run(); ts.append((time.perf_counter() - t) * 1000)
    return sorted(ts)[len(ts) // 2]

results = {}
for s in json.loads((data / "meta.json").read_text()):
    key, m = s["key"], s["m"]
    reps = 7 if m < 200 else 3
    row = {}
    for name, options in SETTINGS.items():
        h = solve(data / f"{key}.mps", options)
        ms = median(h, reps)
        assert h.getModelStatus() == highspy.HighsModelStatus.kOptimal, (key, name)
        info = h.getInfo()
        row[name] = {"milliseconds": ms, "iterations": int(info.simplex_iteration_count), "objective": float(info.objective_function_value)}
    results[key] = row

(here / "results").mkdir(exist_ok=True)
(here / "results" / "highs.json").write_text(json.dumps({
    "library": f"HiGHS {highspy.Highs().version()} (highspy)",
    "runtime": f"Python {platform.python_version()}",
    "cpu": platform.processor() or platform.machine(),
    "date": time.strftime("%Y-%m-%d"),
    "results": results,
}, indent=1) + "\n")
print(json.dumps(results, indent=1))
