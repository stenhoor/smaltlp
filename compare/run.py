"""
The compare tests' reference run (smaltworks ADR 0039, section 6): the same problems through scipy.optimize.linprog
and scipy.optimize.milp (HiGHS), PuLP (with its HiGHS solver) and HiGHS's MPS reader (highspy), written to
fixtures/compare.json. CI checks
smaltlp against that file without Python; `npm run compare` reruns this to add cases or check a new reference version.

Every case is our own: hand-written, or generated here from a fixed seed. No outside test sets are stored.
"""
import json
import os
import random
import tempfile

import highspy
import numpy as np
import pulp
import scipy
from scipy.optimize import Bounds, LinearConstraint, linprog, milp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def num(v):
    """A float for JSON: infinities as strings, -0 as 0."""
    v = float(v)
    if v == float('inf'):
        return 'Infinity'
    if v == float('-inf'):
        return '-Infinity'
    return v + 0.0


def nums(a):
    return [num(v) for v in a]


# ---------------------------------------------------------------------------------------------------------------------
# linprog cases

def linprog_case(name, c, A_ub=None, b_ub=None, A_eq=None, b_eq=None, bounds=(0, None), unique=False):
    res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=A_eq, b_eq=b_eq, bounds=bounds, method='highs')
    n = len(c)
    pairs = bounds if isinstance(bounds, list) else [bounds] * n
    out = {'status': int(res.status)}
    if res.status == 0:
        out['fun'] = num(res.fun)
        if unique:
            out['x'] = nums(res.x)
            out['ineqlin'] = nums(res.ineqlin.marginals) if A_ub is not None else []
            out['eqlin'] = nums(res.eqlin.marginals) if A_eq is not None else []
            out['lower'] = nums(res.lower.marginals)
            out['upper'] = nums(res.upper.marginals)
    return {
        'name': name,
        'unique': unique,
        'input': {
            'c': list(c),
            'AUb': A_ub, 'bUb': b_ub, 'AEq': A_eq, 'bEq': b_eq,
            'bounds': [[None if l is None else l, None if u is None else u] for l, u in pairs],
        },
        'scipy': out,
    }


def random_linprog(seed):
    """A random problem: usually feasible and bounded, sometimes infeasible or unbounded on purpose."""
    r = random.Random(seed)
    n = r.randint(2, 14)
    m1 = r.randint(0, 10)
    m2 = r.randint(0, 3)
    x0 = [r.uniform(-5, 5) for _ in range(n)]
    bounds = []
    for j in range(n):
        kind = r.random()
        lo = round(x0[j] - r.uniform(0, 5), 2)
        up = round(x0[j] + r.uniform(0, 5), 2)
        bounds.append([lo, up] if kind < 0.6 else [lo, None] if kind < 0.8 else [None, up] if kind < 0.9 else [None, None])
    entry = lambda: round(r.uniform(-10, 10), 2) if r.random() < 0.6 else 0.0
    A_ub = [[entry() for _ in range(n)] for _ in range(m1)]
    b_ub = [round(sum(a * x for a, x in zip(row, x0)) + (0 if r.random() < 0.3 else r.uniform(0, 5)), 4) for row in A_ub]
    A_eq = [[entry() for _ in range(n)] for _ in range(m2)]
    b_eq = [round(sum(a * x for a, x in zip(row, x0)), 4) for row in A_eq]
    c = [round(r.uniform(-10, 10), 2) for _ in range(n)]
    twist = r.random()
    if twist < 0.1 and m1 > 0:
        # Infeasible: a row and its negation, pulled apart.
        A_ub.append([-a for a in A_ub[0]])
        b_ub.append(-b_ub[0] - 1)
    return linprog_case(f'random {seed}', c, A_ub or None, b_ub or None, A_eq or None, b_eq or None, bounds)


def linprog_cases():
    cases = [
        linprog_case("scipy's documentation example", [-1, 4], [[-3, 1], [1, 2]], [6, 4], bounds=[(None, None), (-3, None)], unique=True),
        linprog_case('production plan', [-3, -5], [[1, 0], [0, 2], [3, 2]], [4, 12, 18], unique=True),
        linprog_case("Beale's cycling example", [-0.75, 150, -0.02, 6], [[0.25, -60, -0.04, 9], [0.5, -90, -0.02, 3], [0, 0, 1, 0]], [0, 0, 1]),
        linprog_case('equalities', [1, 2, 3], A_eq=[[1, 1, 1], [1, -1, 0]], b_eq=[1, 0], unique=True),
        linprog_case('upper bounds only', [-1, -1], bounds=[(0, 2), (0, 3)], unique=True),
        linprog_case('infeasible', [1], [[1]], [-1]),
        linprog_case('infeasible equalities', [1, 1], A_eq=[[1, 1], [1, 1]], b_eq=[1, 2]),
        linprog_case('unbounded', [-1, -1], [[1, -1]], [1]),
        linprog_case('free and unbounded below', [1], bounds=[(None, None)]),
        # Problems presolve reduces: a binding singleton row, fixed variables, a chain that removes everything.
        linprog_case('singleton row binding', [-2, -1], [[1, 0], [1, 1]], [3, 5], unique=True),
        linprog_case('fixed variable', [1, 2, -1], [[1, 1, 1], [0, 1, -1]], [10, 2], bounds=[(0, None), (1, 1), (0, 4)], unique=True),
        linprog_case('presolve chain', [1, 1, -3], [[1, 1, 2]], [20], [[2, -1, 0], [0, 4, 0]], [2, 8], bounds=[(None, None), (None, None), (-10, 10)], unique=True),
        linprog_case('singleton ranges on one column', [-1, 1], [[1, 0], [-1, 0], [2, 0], [1, 1]], [6, -1, 10, 8], unique=True),
    ]
    cases += [random_linprog(seed) for seed in range(1, 121)]
    return cases


# ---------------------------------------------------------------------------------------------------------------------
# milp cases: scipy.optimize.milp with a relative gap of 0, so its objective is the optimum, not one within 1e-4

def milp_case(name, c, integrality, lb, ub, A=None, cl=None, cu=None):
    n = len(c)
    cons = LinearConstraint(A, cl, cu) if A is not None else None
    res = milp(c, integrality=integrality, bounds=Bounds(lb, ub), constraints=cons, options={'mip_rel_gap': 0})
    out = {'status': int(res.status)}
    if res.status == 0:
        out['fun'] = num(res.fun)
    return {
        'name': name,
        'input': {
            'c': list(c), 'integrality': list(integrality),
            'lb': nums(np.broadcast_to(lb, n)), 'ub': nums(np.broadcast_to(ub, n)),
            'A': A, 'cl': None if A is None else nums(np.broadcast_to(cl, len(A))), 'cu': None if A is None else nums(np.broadcast_to(cu, len(A))),
        },
        'scipy': out,
    }


def random_milp(seed):
    """A random problem with integer and continuous columns, mostly in a box; sometimes infeasible."""
    r = random.Random(1000 + seed)
    n = r.randint(2, 12)
    m = r.randint(1, 8)
    integrality = [1 if r.random() < 0.7 else 0 for _ in range(n)]
    lb = [r.randint(-3, 1) for _ in range(n)]
    ub = [l + r.randint(1, 6) if r.random() < 0.85 else float('inf') for l in lb]
    entry = lambda: r.randint(-9, 9) if r.random() < 0.6 else 0
    A = [[entry() for _ in range(n)] for _ in range(m)]
    x0 = [r.randint(l, l + 1) for l in lb]
    act = [sum(a * x for a, x in zip(row, x0)) for row in A]
    cl = [float('-inf') if r.random() < 0.7 else a - r.randint(0, 6) for a in act]
    cu = [a + r.uniform(0, 8) if r.random() < 0.9 else float('inf') for a in act]
    # Costs that make an unbounded column pay for going up.
    c = [round(r.uniform(-10, 10), 2) if u != float('inf') else round(r.uniform(0.5, 10), 2) for u in ub]
    if r.random() < 0.1:
        # Infeasible for integers, though the relaxation may not be: 2 x_0 = 2k + 1.
        A.append([2] + [0] * (n - 1))
        cl.append(2 * x0[0] + 1)
        cu.append(2 * x0[0] + 1)
        integrality[0] = 1
    return milp_case(f'random {seed}', c, integrality, lb, ub, A, cl, cu)


def milp_cases():
    inf = float('inf')
    cases = [
        milp_case("scipy's documentation example", [0, -1], [1, 1], 0, inf, [[-1, 1], [3, 2], [2, 3]], -inf, [1, 12, 12]),
        milp_case('knapsack', [-10, -13, -18, -31, -7, -15], [1] * 6, 0, 1, [[11, 15, 20, 35, 10, 33]], -inf, [47]),
        milp_case('mixed', [-1, -1], [1, 0], 0, inf, [[1, 2], [2, 0]], -inf, [4.5, 5]),
        milp_case('assignment', [4, 2, 8, 4, 3, 7, 3, 1, 6], [1] * 9, 0, 1,
                  [[1, 1, 1, 0, 0, 0, 0, 0, 0], [0, 0, 0, 1, 1, 1, 0, 0, 0], [0, 0, 0, 0, 0, 0, 1, 1, 1],
                   [1, 0, 0, 1, 0, 0, 1, 0, 0], [0, 1, 0, 0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1]], 1, 1),
        milp_case('set cover', [3, 2, 4, 1, 2], [1] * 5, 0, 1,
                  [[1, 1, 0, 0, 0], [0, 1, 1, 0, 0], [1, 0, 0, 1, 0], [0, 0, 1, 0, 1], [0, 0, 0, 1, 1], [1, 0, 1, 0, 0]], 1, inf),
        milp_case('negative integer bounds', [1, -2], [1, 1], [-5.5, -3.2], [2.7, 4.9], [[1, 1]], -inf, [1.5]),
        milp_case('infeasible for integers', [1], [1], 0, inf, [[2]], 1, 1),
        milp_case('relaxation unbounded', [-1, 0], [1, 0], 0, inf),
        milp_case('integer-unbounded line', [-1, -1], [1, 1], 0, inf, [[1, -1]], 0, 0),
        milp_case('continuous only', [1, 2], [0, 0], 0, inf, [[1, 1]], 1.5, inf),
    ]
    cases += [random_milp(seed) for seed in range(1, 81)]
    return cases


# ---------------------------------------------------------------------------------------------------------------------
# Modelling-layer cases: a JSON spec, built in PuLP and (by the test) in smaltlp

def model_case(spec):
    prob = pulp.LpProblem(spec['name'], pulp.LpMaximize if spec['sense'] == 'maximize' else pulp.LpMinimize)
    vs = {v['name']: prob.add_variable(v['name'], v.get('lowBound'), v.get('upBound'), v.get('cat', 'Continuous')) for v in spec['variables']}
    prob += pulp.lpSum(k * vs[n] for n, k in spec['objective'].items())
    for con in spec['constraints']:
        lhs = pulp.lpSum(k * vs[n] for n, k in con['terms'].items())
        rel = {'le': lhs <= con['rhs'], 'ge': lhs >= con['rhs'], 'eq': lhs == con['rhs']}[con['sense']]
        prob += rel, con['name']
    stats = prob.solve(pulp.HiGHS(msg=0, gapRel=0))
    out = {'status': int(stats.status), 'statusStr': stats.status_str, 'hasSolution': bool(stats.has_solution)}
    if stats.status == 1:
        out['objective'] = num(pulp.value(prob.objective))
        if spec.get('unique'):
            out['varValue'] = {n: num(v.varValue) for n, v in vs.items()}
            out['dj'] = {n: num(v.dj) for n, v in vs.items()}
            out['pi'] = {c.name: num(c.pi) for c in prob.constraints()}
            out['slack'] = {c.name: num(c.slack) for c in prob.constraints()}
    return {'spec': spec, 'pulp': out}


def model_cases():
    specs = [
        {'name': 'plan', 'sense': 'maximize', 'unique': True,
         'variables': [{'name': 'x', 'lowBound': 0}, {'name': 'y', 'lowBound': 0}],
         'objective': {'x': 3, 'y': 5},
         'constraints': [{'name': 'plant1', 'terms': {'x': 1}, 'sense': 'le', 'rhs': 4},
                         {'name': 'plant2', 'terms': {'y': 2}, 'sense': 'le', 'rhs': 12},
                         {'name': 'plant3', 'terms': {'x': 3, 'y': 2}, 'sense': 'le', 'rhs': 18}]},
        {'name': 'mix', 'sense': 'minimize', 'unique': True,
         'variables': [{'name': 'a', 'lowBound': 0}, {'name': 'b', 'lowBound': 0}, {'name': 'c', 'lowBound': 0, 'upBound': 10}],
         'objective': {'a': 2, 'b': 3, 'c': 1},
         'constraints': [{'name': 'need', 'terms': {'a': 1, 'b': 1}, 'sense': 'ge', 'rhs': 4},
                         {'name': 'link', 'terms': {'b': 1, 'c': -1}, 'sense': 'eq', 'rhs': 1}]},
        {'name': 'diet', 'sense': 'minimize', 'unique': True,
         'variables': [{'name': 'bread', 'lowBound': 0, 'upBound': 10}, {'name': 'milk', 'lowBound': 0, 'upBound': 10}, {'name': 'beans', 'lowBound': 0}],
         'objective': {'bread': 2, 'milk': 3.5, 'beans': 8},
         'constraints': [{'name': 'calories', 'terms': {'bread': 65, 'milk': 110, 'beans': 245}, 'sense': 'ge', 'rhs': 2000},
                         {'name': 'protein', 'terms': {'bread': 2, 'milk': 6, 'beans': 20}, 'sense': 'ge', 'rhs': 55},
                         {'name': 'fat', 'terms': {'bread': 1, 'milk': 6, 'beans': 2}, 'sense': 'le', 'rhs': 40}]},
        {'name': 'infeasible', 'sense': 'minimize',
         'variables': [{'name': 'z', 'lowBound': 0}],
         'objective': {'z': 1},
         'constraints': [{'name': 'neg', 'terms': {'z': 1}, 'sense': 'le', 'rhs': -1}]},
        {'name': 'unbounded', 'sense': 'maximize',
         'variables': [{'name': 'w', 'lowBound': 0}],
         'objective': {'w': 1},
         'constraints': [{'name': 'pos', 'terms': {'w': 1}, 'sense': 'ge', 'rhs': 0}]},
        {'name': 'knapsack', 'sense': 'maximize',
         'variables': [{'name': f'take{i}', 'cat': 'Binary'} for i in range(6)],
         'objective': {f'take{i}': v for i, v in enumerate([10, 13, 18, 31, 7, 15])},
         'constraints': [{'name': 'capacity', 'terms': {f'take{i}': w for i, w in enumerate([11, 15, 20, 35, 10, 33])}, 'sense': 'le', 'rhs': 47}]},
        {'name': 'trucks', 'sense': 'minimize',
         'variables': [{'name': 'small', 'lowBound': 0, 'cat': 'Integer'}, {'name': 'large', 'lowBound': 0, 'cat': 'Integer'},
                       {'name': 'overtime', 'lowBound': 0, 'upBound': 8}],
         'objective': {'small': 300, 'large': 520, 'overtime': 45},
         'constraints': [{'name': 'tonnes', 'terms': {'small': 7, 'large': 13, 'overtime': 1.5}, 'sense': 'ge', 'rhs': 61},
                         {'name': 'drivers', 'terms': {'small': 1, 'large': 1}, 'sense': 'le', 'rhs': 6}]},
        {'name': 'odd', 'sense': 'minimize',
         'variables': [{'name': 'v', 'lowBound': 0, 'cat': 'Integer'}],
         'objective': {'v': 1},
         'constraints': [{'name': 'half', 'terms': {'v': 2}, 'sense': 'eq', 'rhs': 1}]},
        {'name': 'integers_unbounded', 'sense': 'maximize',
         'variables': [{'name': 'k', 'lowBound': 0, 'cat': 'Integer'}],
         'objective': {'k': 1},
         'constraints': [{'name': 'pos', 'terms': {'k': 1}, 'sense': 'ge', 'rhs': 0}]},
    ]
    return [model_case(s) for s in specs]


# ---------------------------------------------------------------------------------------------------------------------
# MPS cases: how HiGHS reads each file

MPS_FILES = {
    'conventions': """NAME CONV
ROWS
 N obj
 L r
COLUMNS
 x obj 1 r 1
 y obj 1 r 1
 MARKER 'MARKER' 'INTORG'
 n obj 1 r 1
 MARKER 'MARKER' 'INTEND'
RHS
 rhs r 10 obj 2.5
BOUNDS
 UP bnd y -3
ENDATA
""",
    'ranges': """NAME R
ROWS
 N obj
 L a
 G b
 E c
 E d
COLUMNS
 x obj 1 a 1
 x b 1 c 1
 x d 1
RHS
 rhs a 10 b 2
 rhs c 5 d 5
RANGES
 rng a 4 b 3
 rng c 2 d -2
ENDATA
""",
    'bounds': """NAME B
ROWS
 N obj
 L r
COLUMNS
 a obj 1 r 1
 b obj 1 r 1
 d obj 1 r 1
 e obj 1 r 1
 f obj 1 r 1
 g obj 1 r 1
 h obj 1 r 1
RHS
 rhs r 10
BOUNDS
 FR bnd a
 MI bnd b
 UP bnd b 5
 FX bnd e 2
 BV bnd f
 LI bnd g 1
 UI bnd g 9
 PL bnd h
ENDATA
""",
    'testprob': """NAME          TESTPROB
ROWS
 N  COST
 L  LIM1
 G  LIM2
 E  MYEQN
COLUMNS
    XONE      COST         1   LIM1         1
    XONE      LIM2         1
    YTWO      COST         2   LIM1         1
    YTWO      MYEQN       -1
    ZTHREE    COST         3   LIM2         1
    ZTHREE    MYEQN        1
RHS
    RHS1      LIM1         4   LIM2         1
    RHS1      MYEQN        7
BOUNDS
 UP BND1      XONE         4
 LO BND1      YTWO        -1
 UP BND1      YTWO         1
ENDATA
""",
    'integer defaults': """NAME INTD
ROWS
 N obj
 L r
COLUMNS
 MARKER 'MARKER' 'INTORG'
 p obj 1 r 1
 q obj 1 r 1
 s obj 1 r 1
 t obj 1 r 1
 MARKER 'MARKER' 'INTEND'
RHS
 rhs r 10
BOUNDS
 LO bnd q 2
 UP bnd s 7
 UP bnd t -2
ENDATA
""",
    'maximize': """NAME MAXI
OBJSENSE
    MAX
ROWS
 N obj
 L cap
COLUMNS
 x obj 3 cap 1
 y obj 5 cap 2
RHS
 rhs cap 12
BOUNDS
 UP bnd x 4
ENDATA
""",
}


def mps_case(name, text):
    path = os.path.join(tempfile.mkdtemp(), name + '.mps')
    with open(path, 'w') as f:
        f.write(text)
    h = highspy.Highs()
    h.setOptionValue('output_flag', False)
    assert h.readModel(path) == highspy.HighsStatus.kOk, name
    lp = h.getLp()
    out = {
        'sense': 'maximize' if lp.sense_ == highspy.ObjSense.kMaximize else 'minimize',
        'offset': num(lp.offset_),
        'c': nums(lp.col_cost_),
        'colLo': nums(lp.col_lower_),
        'colUp': nums(lp.col_upper_),
        'rowLo': nums(lp.row_lower_),
        'rowUp': nums(lp.row_upper_),
        'integer': [int(v) for v in lp.integrality_] if len(lp.integrality_) else [0] * lp.num_col_,
    }
    h.setOptionValue('mip_rel_gap', 0)
    h.run()
    if h.getModelStatus() == highspy.HighsModelStatus.kOptimal:
        out['objective'] = num(h.getInfo().objective_function_value)
    return {'name': name, 'text': text, 'highs': out}


def main():
    fixtures = {
        'reference': {'highspy': highspy.__version__ if hasattr(highspy, '__version__') else '1.16.0',
                      'scipy': scipy.__version__, 'pulp': pulp.__version__, 'numpy': np.__version__},
        'linprog': linprog_cases(),
        'milp': milp_cases(),
        'model': model_cases(),
        'mps': [mps_case(n, t) for n, t in MPS_FILES.items()],
    }
    path = os.path.join(ROOT, 'fixtures', 'compare.json')
    with open(path, 'w') as f:
        json.dump(fixtures, f, indent=1)
        f.write('\n')
    counts = {k: len(v) for k, v in fixtures.items() if isinstance(v, list)}
    print(f'wrote {os.path.relpath(path, ROOT)}: {counts}')


if __name__ == '__main__':
    main()
