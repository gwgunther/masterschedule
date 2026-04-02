"""
Master Schedule Solver — PuLP MILP formulation.
Updated for 26-27 data schemas.
"""

import math
import time
from pathlib import Path
from collections import defaultdict
import pandas as pd
import pulp


# Non-instructional course IDs — consume teacher time, no student enrollment
NON_INSTRUCTIONAL = {
    "CONFERENCE", "PROGRESS", "PROGRESSMON", "TITLE1",
    "COMMUNITY", "COMSCHOOLS", "5CS", "ASB", "ASBRELEASE",
    "REWARDS", "DLI",
}

# Constraint group labels + source data table for diagnostics
CONSTRAINT_GROUPS = {
    "conference":     ("Conference Period",           "Teachers"),
    "min_sections":   ("Courses",                    "Courses + Qualifications"),
    "exact_sections": ("Section Quotas",              "Section Quotas"),
    "section_locks":  ("Section Quotas (per course)", "Section Quotas"),
    "forced":         ("Fixed Assignments",           "Fixed Assignments"),
    "coteach":        ("Co-Teaching",                "Co-Teaching"),
    "semester_pairs": ("Semester Pairs",             "Semester Pairs"),
}


def _load_data(data_dir: Path) -> dict:
    """Load and parse all input data from a run directory."""
    df_courses = pd.read_csv(data_dir / "courses.csv")
    df_teachers = pd.read_csv(data_dir / "teachers.csv")
    df_quals = pd.read_csv(data_dir / "teacher_qualifications.csv")
    df_locks = pd.read_csv(data_dir / "teacher_section_locks.csv")
    df_constraints = pd.read_csv(data_dir / "fixed_assignments.csv")
    df_coteach = pd.read_csv(data_dir / "coteaching_combinations.csv")
    df_pairs = pd.read_csv(data_dir / "semester_pairs.csv")

    for col in ("enrollment_7th", "enrollment_8th", "total_enrollment", "num_sections"):
        df_courses[col] = pd.to_numeric(df_courses[col], errors="coerce").fillna(0).astype(int)
    df_teachers["max_sections"] = pd.to_numeric(df_teachers["max_sections"], errors="coerce").fillna(0).astype(int)

    teachers = df_teachers["teacher_id"].tolist()
    courses = df_courses["course_id"].tolist()
    periods = list(range(1, 8))

    enrollment = df_courses.set_index("course_id").to_dict()
    teacher_max = df_teachers.set_index("teacher_id")["max_sections"].to_dict()
    non_instr = {c for c in courses if c in NON_INSTRUCTIONAL}

    qualifications: dict[str, set] = {}
    for _, row in df_quals.iterrows():
        qualifications.setdefault(row["teacher_id"], set()).add(row["course_id"])
    for t in teachers:
        qualifications.setdefault(t, set()).add("CONFERENCE")
    for _, row in df_constraints.iterrows():
        cid, tid = str(row["course_id"]), str(row["teacher_id"])
        if tid in qualifications:
            qualifications[tid].add(cid)

    section_locks: dict[tuple, int] = {}
    for _, row in df_locks.iterrows():
        section_locks[(row["teacher_id"], row["course_id"])] = int(row["num_sections"])

    forced = set()
    for _, row in df_constraints.iterrows():
        forced.add((str(row["course_id"]), str(row["teacher_id"]), int(row["period"])))

    coteach_list = []
    for _, row in df_coteach.iterrows():
        coteach_list.append({
            "swd_teacher": str(row["swd_teacher"]),
            "swd_course_code": str(row["swd_course_code"]),
            "gened_teacher": str(row["gened_teacher"]),
            "gened_course_code": str(row["gened_course_code"]),
            "num_sections": int(row["num_sections"]),
        })

    pairs: list[tuple] = []
    for _, row in df_pairs.iterrows():
        pairs.append((str(row["course_a"]), str(row["teacher_a"]),
                      str(row["course_b"]), str(row["teacher_b"])))

    track_courses = {
        "honors_7": [c for c in courses if c.startswith("EN701") or c.startswith("MA701") or c.startswith("SC701") or c.startswith("SS701")],
        "honors_8": [c for c in courses if c.startswith("EN801") or c.startswith("MA801") or c.startswith("SC801") or c.startswith("SS801")],
        "dli_7":    [c for c in courses if c.startswith("MA702") or c.startswith("SS702")],
        "dli_8":    [c for c in courses if c.startswith("MA802") or c.startswith("SS802")],
    }

    # Course name lookup (try course_title first, then course_name)
    name_col = "course_title" if "course_title" in df_courses.columns else "course_name" if "course_name" in df_courses.columns else None
    course_names = df_courses.set_index("course_id")[name_col].to_dict() if name_col else {}

    # Teacher name lookup
    teacher_names = {}
    if "full_name" in df_teachers.columns:
        teacher_names = df_teachers.set_index("teacher_id")["full_name"].to_dict()

    return {
        "teachers": teachers, "courses": courses, "periods": periods,
        "enrollment": enrollment, "teacher_max": teacher_max,
        "non_instr": non_instr, "qualifications": qualifications,
        "section_locks": section_locks, "forced": forced,
        "coteach_list": coteach_list, "pairs": pairs,
        "track_courses": track_courses, "course_names": course_names,
        "teacher_names": teacher_names,
    }


def _build_problem(data: dict, elastic: bool = False):
    """
    Build the MILP problem.
    If elastic=True, adds slack variables for constraint relaxation.
    Returns (prob, x, slacks) where slacks is a dict of {group: {label: var}} if elastic.
    """
    teachers = data["teachers"]
    courses = data["courses"]
    periods = data["periods"]
    enrollment = data["enrollment"]
    teacher_max = data["teacher_max"]
    non_instr = data["non_instr"]
    qualifications = data["qualifications"]
    section_locks = data["section_locks"]
    forced = data["forced"]
    coteach_list = data["coteach_list"]
    pairs = data["pairs"]
    track_courses = data["track_courses"]

    prob = pulp.LpProblem("MasterSchedule", pulp.LpMinimize)
    x = pulp.LpVariable.dicts(
        "x",
        ((t, c, p) for t in teachers for c in courses for p in periods),
        cat="Binary",
    )

    # Slack variables for elastic mode: {group: {label: (pos_var, neg_var or just var)}}
    slacks: dict[str, dict[str, list]] = defaultdict(dict) if elastic else {}
    PENALTY = 10000  # high penalty per unit of slack

    # ── Objective ─────────────────────────────────────────────────────
    total_enroll = sum(
        enrollment["total_enrollment"].get(c, 0)
        for c in courses if c not in non_instr
    )
    total_sections_est = sum(
        max(1, enrollment["num_sections"].get(c, 0))
        for c in courses
        if c not in non_instr and enrollment["total_enrollment"].get(c, 0) > 0
    )
    avg_class_size = total_enroll / max(1, total_sections_est)

    pos_dev = pulp.LpVariable.dicts("pos_dev", courses, lowBound=0)
    neg_dev = pulp.LpVariable.dicts("neg_dev", courses, lowBound=0)

    tracks = list(track_courses.keys())
    track_count = pulp.LpVariable.dicts(
        "track_count",
        ((tr, p) for tr in tracks for p in periods),
        lowBound=0, cat="Integer",
    )
    track_max_v = pulp.LpVariable.dicts("track_max", tracks, lowBound=0, cat="Integer")
    track_min_v = pulp.LpVariable.dicts("track_min", tracks, lowBound=0, cat="Integer")

    class_size_obj = pulp.lpSum(pos_dev[c] + neg_dev[c] for c in courses)
    distribution_obj = pulp.lpSum(track_max_v[tr] - track_min_v[tr] for tr in tracks)
    slack_penalty = pulp.LpAffineExpression()  # filled if elastic

    # ── Constraints ───────────────────────────────────────────────────

    # 1. Deviation definition (class size balance) — always hard
    for c in courses:
        enr = enrollment["total_enrollment"].get(c, 0)
        prob += (
            pulp.lpSum(x[t, c, p] * enr for t in teachers for p in periods)
            - avg_class_size == pos_dev[c] - neg_dev[c]
        ), f"dev_{c}"

    # Track count definitions — always hard
    for p in periods:
        for tr, clist in track_courses.items():
            prob += (
                track_count[tr, p] ==
                pulp.lpSum(x[t, c, p] for t in teachers for c in clist)
            ), f"track_count_{tr}_{p}"

    for tr in tracks:
        for p in periods:
            prob += track_count[tr, p] <= track_max_v[tr], f"track_max_{tr}_{p}"
            prob += track_count[tr, p] >= track_min_v[tr], f"track_min_{tr}_{p}"

    # 2. Conference: each teacher exactly one CONFERENCE period
    #    Skip teachers who have no CONFERENCE in their section_locks (e.g. teach all 7 periods)
    if "CONFERENCE" in courses:
        teachers_with_conf = {t for (t, c) in section_locks if c == "CONFERENCE"}
        for t in teachers:
            if t not in teachers_with_conf:
                continue
            if elastic:
                sp = pulp.LpVariable(f"s_conf_p_{t}", lowBound=0, cat="Integer")
                sn = pulp.LpVariable(f"s_conf_n_{t}", lowBound=0, cat="Integer")
                prob += (
                    pulp.lpSum(x[t, "CONFERENCE", p] for p in periods) + sn - sp == 1
                ), f"conf_{t}"
                slacks["conference"][t] = [sp, sn]
                slack_penalty += PENALTY * (sp + sn)
            else:
                prob += (
                    pulp.lpSum(x[t, "CONFERENCE", p] for p in periods) == 1
                ), f"conf_{t}"
        # Teachers WITHOUT conference: force zero CONFERENCE periods
        for t in teachers:
            if t not in teachers_with_conf:
                prob += (
                    pulp.lpSum(x[t, "CONFERENCE", p] for p in periods) == 0
                ), f"no_conf_{t}"

    # 3. One course per teacher per period — always hard (physical)
    for t in teachers:
        for p in periods:
            prob += (
                pulp.lpSum(x[t, c, p] for c in courses) <= 1
            ), f"one_per_period_{t}_{p}"

    # 4. Teacher qualifications — always hard
    #    CONFERENCE is skipped (all teachers auto-qualified via line above)
    #    Non-instructional courses (5CS, TITLE1, etc.) DO require qualifications
    for t in teachers:
        for c in courses:
            if c == "CONFERENCE":
                continue
            if c not in qualifications.get(t, set()):
                prob += (
                    pulp.lpSum(x[t, c, p] for p in periods) == 0
                ), f"qual_{t}_{c}"

    # 5. Minimum sections per course
    for c in courses:
        if c == "CONFERENCE" or c in non_instr:
            continue
        min_s = enrollment["num_sections"].get(c, 0)
        if min_s > 0:
            if elastic:
                s = pulp.LpVariable(f"s_minsec_{c}", lowBound=0, cat="Integer")
                prob += (
                    pulp.lpSum(x[t, c, p] for t in teachers for p in periods) + s >= min_s
                ), f"min_sections_{c}"
                slacks["min_sections"][c] = [s]
                slack_penalty += PENALTY * s
            else:
                prob += (
                    pulp.lpSum(x[t, c, p] for t in teachers for p in periods) >= min_s
                ), f"min_sections_{c}"

    # 6. Teacher section limits
    for t in teachers:
        max_s = int(teacher_max.get(t, 0))
        if max_s == 0:
            prob += (
                pulp.lpSum(x[t, c, p] for c in courses if c != "CONFERENCE" and c not in non_instr for p in periods) == 0
            ), f"no_primary_{t}"
            continue
        if elastic:
            sp = pulp.LpVariable(f"s_exsec_p_{t}", lowBound=0, cat="Integer")
            sn = pulp.LpVariable(f"s_exsec_n_{t}", lowBound=0, cat="Integer")
            prob += (
                pulp.lpSum(x[t, c, p] for c in courses if c != "CONFERENCE" for p in periods)
                + sn - sp == max_s
            ), f"exact_sections_{t}"
            slacks["exact_sections"][t] = [sp, sn]
            slack_penalty += PENALTY * (sp + sn)
        else:
            prob += (
                pulp.lpSum(x[t, c, p] for c in courses if c != "CONFERENCE" for p in periods)
                == max_s
            ), f"exact_sections_{t}"

    # 7. Forced assignments
    for c, t, p in forced:
        if t in teachers and c in courses:
            if elastic:
                s = pulp.LpVariable(f"s_forced_{c}_{t}_{p}", lowBound=0, cat="Binary")
                prob += x[t, c, p] + s >= 1, f"forced_{c}_{t}_{p}"
                slacks["forced"][f"{c}|{t}|P{p}"] = [s]
                slack_penalty += PENALTY * s
            else:
                prob += x[t, c, p] == 1, f"forced_{c}_{t}_{p}"

    # 8. Teacher section locks
    for (t, c), num in section_locks.items():
        if t in teachers and c in courses:
            if elastic:
                sp = pulp.LpVariable(f"s_lock_p_{t}_{c}", lowBound=0, cat="Integer")
                sn = pulp.LpVariable(f"s_lock_n_{t}_{c}", lowBound=0, cat="Integer")
                prob += (
                    pulp.lpSum(x[t, c, p] for p in periods) + sn - sp == num
                ), f"lock_{t}_{c}"
                slacks["section_locks"][f"{t}|{c}"] = [sp, sn]
                slack_penalty += PENALTY * (sp + sn)
            else:
                prob += (
                    pulp.lpSum(x[t, c, p] for p in periods) == num
                ), f"lock_{t}_{c}"

    # 9. Co-teaching synchronization + section counts
    for info in coteach_list:
        co_t = info["swd_teacher"]
        co_c = info["swd_course_code"]
        pri_t = info["gened_teacher"]
        pri_c = info["gened_course_code"]
        n = info["num_sections"]
        if not all(e in teachers for e in (co_t, pri_t)):
            continue
        if not all(e in courses for e in (co_c, pri_c)):
            continue
        for p in periods:
            if elastic:
                s = pulp.LpVariable(f"s_cosync_{co_c}_{co_t}_{p}", lowBound=0, cat="Binary")
                prob += (
                    x[co_t, co_c, p] <= x[pri_t, pri_c, p] + s
                ), f"coteach_sync_{co_c}_{co_t}_{p}"
                slacks["coteach"][f"sync|{co_c}|{co_t}|P{p}"] = [s]
                slack_penalty += PENALTY * s
            else:
                prob += (
                    x[co_t, co_c, p] <= x[pri_t, pri_c, p]
                ), f"coteach_sync_{co_c}_{co_t}_{p}"
        if elastic:
            sp = pulp.LpVariable(f"s_cocount_p_{co_c}_{co_t}", lowBound=0, cat="Integer")
            sn = pulp.LpVariable(f"s_cocount_n_{co_c}_{co_t}", lowBound=0, cat="Integer")
            prob += (
                pulp.lpSum(x[co_t, co_c, p] for p in periods) + sn - sp == n
            ), f"coteach_count_{co_c}_{co_t}"
            slacks["coteach"][f"count|{co_c}|{co_t}"] = [sp, sn]
            slack_penalty += PENALTY * (sp + sn)
        else:
            prob += (
                pulp.lpSum(x[co_t, co_c, p] for p in periods) == n
            ), f"coteach_count_{co_c}_{co_t}"

    # 10. Semester pairs
    for ca, ta, cb, tb in pairs:
        if not all(e in teachers for e in (ta, tb)):
            continue
        if not all(e in courses for e in (ca, cb)):
            continue
        for p in periods:
            if elastic:
                sp = pulp.LpVariable(f"s_pair_p_{ca}_{ta}_{cb}_{tb}_{p}", lowBound=0, cat="Binary")
                sn = pulp.LpVariable(f"s_pair_n_{ca}_{ta}_{cb}_{tb}_{p}", lowBound=0, cat="Binary")
                prob += (
                    x[ta, ca, p] + sn - sp == x[tb, cb, p]
                ), f"pair_{ca}_{ta}_{cb}_{tb}_{p}"
                slacks["semester_pairs"][f"{ca}|{ta}|{cb}|{tb}|P{p}"] = [sp, sn]
                slack_penalty += PENALTY * (sp + sn)
            else:
                prob += (
                    x[ta, ca, p] == x[tb, cb, p]
                ), f"pair_{ca}_{ta}_{cb}_{tb}_{p}"

    # Set objective
    prob += class_size_obj + 1000 * distribution_obj + slack_penalty

    return prob, x, slacks


def _analyze_diagnostics(slacks: dict, data: dict) -> list[dict]:
    """Analyze slack variables to produce ranked list of constraint violations."""
    course_names = data.get("course_names", {})
    teacher_names = data.get("teacher_names", {})
    enrollment = data["enrollment"]
    teacher_max = data["teacher_max"]
    section_locks = data["section_locks"]

    results = []

    for group, slack_vars in slacks.items():
        violations = []
        total_slack = 0.0

        for label, vars_list in slack_vars.items():
            slack_val = sum(pulp.value(v) or 0 for v in vars_list)
            if slack_val > 0.01:
                total_slack += slack_val
                detail = _format_violation(group, label, slack_val, data)
                violations.append(detail)

        group_info = CONSTRAINT_GROUPS.get(group, (group, None))
        results.append({
            "group": group,
            "label": group_info[0],
            "source_table": group_info[1],
            "total_slack": round(total_slack, 1),
            "violation_count": len(violations),
            "violations": sorted(violations, key=lambda v: -v["slack"]),
        })

    # Sort groups by total_slack descending (most problematic first)
    results.sort(key=lambda r: -r["total_slack"])
    return results


def _format_violation(group: str, label: str, slack_val: float, data: dict) -> dict:
    """Format a single constraint violation with root-cause context."""
    course_names = data.get("course_names", {})
    teacher_names = data.get("teacher_names", {})
    enrollment = data["enrollment"]
    teacher_max = data["teacher_max"]
    qualifications = data["qualifications"]
    section_locks = data["section_locks"]
    teachers = data["teachers"]
    forced = data["forced"]
    non_instr = data["non_instr"]

    detail = {"key": label, "slack": round(slack_val, 1), "message": "", "context": ""}

    if group == "min_sections":
        c = label
        needed = enrollment["num_sections"].get(c, 0)
        shortfall = int(slack_val)
        name = course_names.get(c, c)

        # Find qualified teachers and their capacity
        qual_teachers = [t for t in teachers if c in qualifications.get(t, set())]
        qual_names = [teacher_names.get(t, t) for t in qual_teachers]

        # Compute available capacity and locked totals for qualified teachers
        total_capacity = 0
        total_locked_this = 0
        teacher_details = []
        for t in qual_teachers:
            ms = int(teacher_max.get(t, 0))
            # Exclude CONFERENCE from locked_other since max_sections only covers non-conference
            locked_other = sum(n for (lt, lc), n in section_locks.items() if lt == t and lc != c and lc != "CONFERENCE")
            locked_this = section_locks.get((t, c), None)
            avail = max(0, ms - locked_other)
            total_capacity += avail
            if locked_this is not None:
                total_locked_this += locked_this
            t_name = teacher_names.get(t, t)
            if locked_this is not None:
                total_locked = sum(n for (lt, lc), n in section_locks.items() if lt == t and lc != "CONFERENCE")
                teacher_details.append(f"{t_name} (locked: {locked_this} for this, {total_locked}/{ms} non-conf)")
            else:
                teacher_details.append(f"{t_name} (up to {avail} free)")

        if not qual_teachers:
            detail["message"] = f"{name} — needs {needed} sections but no qualified teachers exist"
            detail["context"] = "Add teacher qualifications for this course"
        else:
            detail["message"] = f"{name} — needs {needed} sections, short by {shortfall}"
            if total_locked_this >= needed and total_capacity < total_locked_this:
                detail["context"] = (
                    f"Locked sections sum to {total_locked_this} (enough), but teachers are over-committed "
                    f"(only ~{total_capacity} periods available across all their courses). "
                    f"Qualified: {', '.join(teacher_details)}"
                )
            else:
                detail["context"] = f"Qualified: {', '.join(teacher_details)} — available capacity ~{total_capacity}"

    elif group == "exact_sections":
        t = label
        expected = int(teacher_max.get(t, 0))
        name = teacher_names.get(t, t)
        # Find what this teacher is locked into
        locked = [(c, n) for (lt, c), n in section_locks.items() if lt == t]
        locked_total = sum(n for _, n in locked)
        locked_desc = ", ".join(f"{course_names.get(c, c)} x{n}" for c, n in locked)

        detail["message"] = f"{name} — expected {expected} non-conference sections, off by {int(slack_val)}"
        if locked:
            detail["context"] = f"Locked into: {locked_desc} ({locked_total} sections) — remaining capacity: {max(0, expected - locked_total)}"
        else:
            detail["context"] = f"Not enough qualified courses to fill {expected} periods"

    elif group == "section_locks":
        parts = label.split("|")
        t, c = parts[0], parts[1]
        expected = section_locks.get((t, c), "?")
        t_name = teacher_names.get(t, t)
        c_name = course_names.get(c, c)
        ms = int(teacher_max.get(t, 0))
        other_locked = sum(n for (lt, lc), n in section_locks.items() if lt == t and lc != c)

        detail["message"] = f"{t_name} locked to teach {expected}x {c_name}, off by {int(slack_val)}"
        detail["context"] = f"Teacher has {ms} total sections, {other_locked} locked to other courses — only {max(0, ms - other_locked)} available"

    elif group == "forced":
        parts = label.split("|")
        c, t, p = parts[0], parts[1], parts[2]
        t_name = teacher_names.get(t, t)
        c_name = course_names.get(c, c)
        period_num = int(p.replace("P", ""))
        # Check what else is forced into this teacher+period
        conflicts = [(fc, ft) for fc, ft, fp in forced if ft == t and fp == period_num and fc != c]
        is_qualified = c in qualifications.get(t, set())

        detail["message"] = f"{t_name} fixed to {c_name} at {p} — cannot be satisfied"
        if not is_qualified:
            detail["context"] = f"Teacher is not qualified for {c_name}"
        elif conflicts:
            conflict_names = [course_names.get(fc, fc) for fc, _ in conflicts]
            detail["context"] = f"Conflicts with other fixed assignment: {', '.join(conflict_names)} also at {p}"
        else:
            detail["context"] = f"Teacher's other constraints prevent this period from being available"

    elif group == "conference":
        t = label
        name = teacher_names.get(t, t)
        detail["message"] = f"{name} — cannot assign conference period"
        detail["context"] = "All 7 periods are consumed by required sections"

    elif group == "coteach":
        parts = label.split("|")
        kind = parts[0]
        if kind == "sync":
            co_c, co_t = parts[1], parts[2]
            co_name = teacher_names.get(co_t, co_t)
            c_name = course_names.get(co_c, co_c)
            detail["message"] = f"{co_name} co-teaching {c_name} — period sync conflict at {parts[3]}"
            detail["context"] = "SPED and gen-ed teacher must teach same period but schedules conflict"
        else:
            co_c, co_t = parts[1], parts[2]
            co_name = teacher_names.get(co_t, co_t)
            c_name = course_names.get(co_c, co_c)
            detail["message"] = f"{co_name} co-teaching {c_name} — section count off by {int(slack_val)}"
            detail["context"] = "Cannot match required number of co-taught sections"

    elif group == "semester_pairs":
        parts = label.split("|")
        ca, ta, cb, tb = parts[0], parts[1], parts[2], parts[3]
        ta_name = teacher_names.get(ta, ta)
        tb_name = teacher_names.get(tb, tb)
        ca_name = course_names.get(ca, ca)
        cb_name = course_names.get(cb, cb)
        detail["message"] = f"{ta_name}/{ca_name} and {tb_name}/{cb_name} must share {parts[4]} — cannot sync"
        detail["context"] = "Semester-paired courses must be taught same period by their respective teachers"

    else:
        detail["message"] = f"{label}: slack={slack_val}"

    return detail


def run_solver(data_dir: Path | None = None, progress_cb=None,
               db_path: Path | None = None, scenario_id: str | None = None,
               runs_dir: Path | None = None) -> dict:
    """
    Run the MILP solver.
    If data_dir is None, creates a new run from current inputs using db_path/scenario_id/runs_dir.
    progress_cb: optional callback(phase, message) for progress updates.
    Returns: {status, sections, solve_time, message, run_id, diagnostics?}
    """
    import data_io
    if data_dir is None:
        run_dir = data_io.create_run(db_path, scenario_id, runs_dir)
        data_dir = run_dir
    else:
        run_dir = data_dir
    start = time.time()

    def _progress(phase, msg):
        if progress_cb:
            progress_cb(phase, msg)

    try:
        _progress("loading", "Loading data...")
        data = _load_data(data_dir)

        teachers = data["teachers"]
        courses = data["courses"]
        periods = data["periods"]
        enrollment = data["enrollment"]
        non_instr = data["non_instr"]

        _progress("building", f"Building model ({len(teachers)} teachers, {len(courses)} courses, 7 periods)...")
        prob, x, _ = _build_problem(data, elastic=False)

        num_vars = len(prob.variables())
        num_constraints = len(prob.constraints)
        _progress("solving", f"Solving ({num_vars:,} variables, {num_constraints:,} constraints)...")

        solver = pulp.PULP_CBC_CMD(msg=0)
        prob.solve(solver)
        solve_time = round(time.time() - start, 1)

        status_map = {
            pulp.LpStatusOptimal: "optimal",
            pulp.LpStatusInfeasible: "infeasible",
            pulp.LpStatusNotSolved: "error",
            pulp.LpStatusUndefined: "error",
        }
        status = status_map.get(prob.status, "error")

        if status == "infeasible":
            # ── Elastic relaxation for diagnostics ────────────────────────
            _progress("diagnosing", "Infeasible — running constraint analysis...")
            diag_start = time.time()
            prob_e, x_e, slacks = _build_problem(data, elastic=True)

            _progress("diagnosing", "Solving relaxed model...")
            prob_e.solve(pulp.PULP_CBC_CMD(msg=0))
            diag_time = round(time.time() - diag_start, 1)

            diagnostics = []
            best_sections = None

            if prob_e.status == pulp.LpStatusOptimal:
                diagnostics = _analyze_diagnostics(slacks, data)

                # Extract partial schedule from relaxed solution
                best_sections = []
                for t in teachers:
                    for c in courses:
                        for p in periods:
                            val = pulp.value(x_e[t, c, p])
                            if val is not None and val > 0.5:
                                best_sections.append({
                                    "section_id": f"{c}-{t}-P{p}",
                                    "course_id": c,
                                    "teacher_id": t,
                                    "period": p,
                                })
                _annotate_students(best_sections, enrollment, non_instr)

                # Write best-attempt sections to run directory
                if best_sections:
                    out_path = run_dir / "sections.csv"
                    df_out = pd.DataFrame(best_sections)
                    df_out[["section_id", "course_id", "teacher_id", "period",
                            "total_students", "students_7th", "students_8th"]].to_csv(out_path, index=False)

            total_violations = sum(d["violation_count"] for d in diagnostics)
            total_time = round(time.time() - start, 1)

            _progress("done", f"Infeasible — {total_violations} constraint violations found")

            data_io.update_run_meta(run_dir, status="infeasible", solve_time=total_time,
                                     message=f"Infeasible — {total_violations} violations across {sum(1 for d in diagnostics if d['violation_count'] > 0)} groups")

            return {
                "status": "infeasible",
                "sections": best_sections,
                "solve_time": total_time,
                "diag_time": diag_time,
                "run_id": run_dir.name,
                "message": f"Infeasible — {total_violations} constraint violations found",
                "diagnostics": diagnostics,
            }

        if status != "optimal":
            data_io.update_run_meta(run_dir, status=status, solve_time=solve_time,
                                     message=f"Solver returned: {pulp.LpStatus[prob.status]}")
            return {
                "status": status,
                "sections": None,
                "solve_time": solve_time,
                "run_id": run_dir.name,
                "message": f"Solver returned: {pulp.LpStatus[prob.status]}",
            }

        _progress("extracting", "Extracting solution...")

        # ── Extract solution ───────────────────────────────────────────────────
        sections = []
        for t in teachers:
            for c in courses:
                for p in periods:
                    val = pulp.value(x[t, c, p])
                    if val is not None and val > 0.5:
                        section_id = f"{c}-{t}-P{p}"
                        sections.append({
                            "section_id": section_id,
                            "course_id": c,
                            "teacher_id": t,
                            "period": p,
                        })

        # Add student count estimates
        _annotate_students(sections, enrollment, non_instr)

        # Write output CSV to the run directory
        out_path = run_dir / "sections.csv"
        df_out = pd.DataFrame(sections)
        df_out[["section_id", "course_id", "teacher_id", "period",
                "total_students", "students_7th", "students_8th"]].to_csv(out_path, index=False)

        solve_time = round(time.time() - start, 1)
        _progress("done", f"Solved — {len(sections)} sections assigned")

        data_io.update_run_meta(run_dir, status="optimal", solve_time=solve_time,
                                 sections_count=len(sections))

        return {
            "status": "optimal",
            "sections": sections,
            "solve_time": solve_time,
            "run_id": run_dir.name,
            "message": f"Solved in {solve_time}s — {len(sections)} sections assigned",
        }

    except Exception as exc:
        if 'run_dir' in locals():
            data_io.update_run_meta(run_dir, status="error",
                                     message=str(exc), solve_time=round(time.time() - start, 1))
        return {
            "status": "error",
            "sections": None,
            "solve_time": round(time.time() - start, 1),
            "run_id": run_dir.name if 'run_dir' in locals() else None,
            "message": str(exc),
        }


def _annotate_students(sections: list[dict], enrollment: dict, non_instr: set) -> None:
    """Add total_students, students_7th, students_8th to each section (in-place)."""
    from collections import defaultdict
    section_counts: dict[str, int] = defaultdict(int)
    for s in sections:
        if s["course_id"] not in non_instr and s["course_id"] != "CONFERENCE":
            section_counts[s["course_id"]] += 1

    for s in sections:
        c = s["course_id"]
        n = section_counts.get(c, 1) or 1
        total = enrollment["total_enrollment"].get(c, 0)
        s7 = enrollment["enrollment_7th"].get(c, 0)
        s8 = enrollment["enrollment_8th"].get(c, 0)
        s["total_students"] = round(total / n)
        s["students_7th"] = round(s7 / n)
        s["students_8th"] = round(s8 / n)
