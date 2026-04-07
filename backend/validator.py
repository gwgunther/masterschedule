"""Pre- and post-solve data validation — updated for 26-27 schemas."""

from pathlib import Path

import data_io


# Non-instructional course IDs
NON_INSTRUCTIONAL = {
    "CONFERENCE", "PROGRESSMON", "TITLE1", "COMSCHOOLS",
    "5CS", "ASBRELEASE", "REWARDS",
}


def _t(teacher_id: str, teacher_map: dict) -> str:
    """Format teacher as 'Full Name (ID)'."""
    t = teacher_map.get(teacher_id)
    name = t.get("full_name") if t else None
    return f"{name} ({teacher_id})" if name else teacher_id


def _c(course_id: str, course_map: dict) -> str:
    """Format course as 'Title (ID)'."""
    c = course_map.get(course_id)
    title = c.get("course_title") if c else None
    return f"{title} ({course_id})" if title else course_id


def validate_data(db_path: Path, scenario_id: str) -> list[dict]:
    """Returns list of {level, message} dicts. level = 'error' | 'warning'."""
    issues = []
    data = data_io.read_all(db_path, scenario_id)

    teachers = {r["teacher_id"] for r in data["teachers"]}
    courses = {r["course_id"] for r in data["courses"]}
    course_map = {r["course_id"]: r for r in data["courses"]}
    teacher_map = {r["teacher_id"]: r for r in data["teachers"]}

    # teacher_qualifications: valid FKs
    qual_teachers = set()
    qual_courses_per_teacher: dict[str, set] = {}
    for r in data["teacher_qualifications"]:
        if r["teacher_id"] not in teachers:
            issues.append({"level": "error", "message": f"teacher_qualifications: unknown teacher '{r['teacher_id']}'"})
        if r["course_id"] not in courses:
            issues.append({"level": "warning", "message": f"teacher_qualifications: unknown course {_c(r['course_id'], course_map)} for {_t(r['teacher_id'], teacher_map)}"})
        qual_teachers.add(r["teacher_id"])
        qual_courses_per_teacher.setdefault(r["teacher_id"], set()).add(r["course_id"])

    # teachers with no qualifications
    for t in teachers:
        if t not in qual_teachers:
            issues.append({"level": "warning", "message": f"Teacher {_t(t, teacher_map)} has no course qualifications"})

    # Courses with no qualified teacher (excluding non-instructional)
    all_qualified_courses = set()
    for cset in qual_courses_per_teacher.values():
        all_qualified_courses.update(cset)
    for c in courses:
        if c not in NON_INSTRUCTIONAL and c != "CONFERENCE" and c not in all_qualified_courses:
            enr = course_map.get(c, {})
            num_sec = int(enr.get("num_sections", 0) or 0)
            if num_sec > 0:
                issues.append({"level": "error", "message": f"Course {_c(c, course_map)} has {num_sec} sections but no qualified teacher"})
            else:
                issues.append({"level": "warning", "message": f"Course {_c(c, course_map)} has no qualified teacher (0 sections)"})

    # teacher_section_locks: valid FKs
    for r in data["teacher_section_locks"]:
        if r["teacher_id"] not in teachers:
            issues.append({"level": "error", "message": f"teacher_section_locks: unknown teacher '{r['teacher_id']}'"})
        if r["course_id"] not in courses:
            issues.append({"level": "error", "message": f"teacher_section_locks: unknown course '{r['course_id']}'"})

    # fixed_assignments: valid FKs, period 1-7
    for r in data["fixed_assignments"]:
        if r["teacher_id"] not in teachers:
            issues.append({"level": "error", "message": f"fixed_assignments: unknown teacher '{r['teacher_id']}'"})
        if r["course_id"] not in courses:
            issues.append({"level": "error", "message": f"fixed_assignments: unknown course '{r['course_id']}'"})
        period = int(r.get("period", 0) or 0)
        if not (1 <= period <= 7):
            issues.append({"level": "error", "message": f"fixed_assignments: period out of range for {_t(r['teacher_id'], teacher_map)} / {_c(r['course_id'], course_map)}"})

    # coteaching_combinations: valid FKs
    for r in data["coteaching_combinations"]:
        for key in ("swd_teacher", "gened_teacher"):
            val = r.get(key, "")
            if val and val not in teachers:
                issues.append({"level": "error", "message": f"coteaching_combinations: unknown teacher '{val}'"})
        for key in ("swd_course_code", "gened_course_code"):
            val = r.get(key, "")
            if val and val not in courses:
                issues.append({"level": "error", "message": f"coteaching_combinations: unknown course '{val}'"})

    # semester_pairs: valid FKs
    for r in data["semester_pairs"]:
        for key in ("teacher_a", "teacher_b"):
            val = r.get(key, "")
            if val and val not in teachers:
                issues.append({"level": "error", "message": f"semester_pairs: unknown teacher '{val}'"})
        val = r.get("course_id", "")
        if val and val not in courses:
            issues.append({"level": "error", "message": f"semester_pairs: unknown course '{val}'"})

    # Section budget check
    from collections import defaultdict
    total_sections_needed = sum(int(c.get("num_sections", 0) or 0) for c in data["courses"] if c["course_id"] not in NON_INSTRUCTIONAL)
    quota_sums: dict[str, int] = defaultdict(int)
    for r in data["teacher_section_locks"]:
        if r["course_id"] not in NON_INSTRUCTIONAL and r["course_id"] != "CONFERENCE":
            quota_sums[r["teacher_id"]] += int(r.get("num_sections", 0) or 0)
    total_capacity = sum(quota_sums.values())
    if total_capacity > 0 and total_sections_needed > total_capacity:
        issues.append({
            "level": "warning",
            "message": f"Total sections needed ({total_sections_needed}) may exceed teacher section quotas ({total_capacity} total)"
        })

    return issues


def validate_schedule(db_path: Path, scenario_id: str, runs_dir: Path) -> list[dict]:
    """Post-solve validation against the generated sections.csv."""
    issues = []
    sections = data_io.read_schedule(runs_dir)
    if sections is None:
        return [{"level": "warning", "message": "No schedule generated yet"}]

    data = data_io.read_all(db_path, scenario_id)
    teacher_map = {r["teacher_id"]: r for r in data["teachers"]}

    from collections import defaultdict
    teacher_periods = defaultdict(list)
    teacher_sections = defaultdict(list)

    for s in sections:
        t_id = s["teacher_id"]
        teacher_periods[t_id].append(s["period"])
        teacher_sections[t_id].append(s)

    # Check one course per teacher per period
    for t_id, ps in teacher_periods.items():
        if len(ps) != len(set(ps)):
            issues.append({"level": "error", "message": f"Teacher {_t(t_id, teacher_map)} has multiple courses in same period"})

    # Check section counts vs section quotas
    from collections import defaultdict as _dd
    quota_sums: dict[str, int] = _dd(int)
    for r in data["teacher_section_locks"]:
        if r["course_id"] not in NON_INSTRUCTIONAL and r["course_id"] != "CONFERENCE":
            quota_sums[r["teacher_id"]] += int(r.get("num_sections", 0) or 0)
    for t_id, secs in teacher_sections.items():
        expected = quota_sums.get(t_id, 0)
        if expected == 0:
            continue
        non_conf = [s for s in secs if s["course_id"] != "CONFERENCE" and s["course_id"] not in NON_INSTRUCTIONAL]
        if len(non_conf) != expected:
            issues.append({
                "level": "warning",
                "message": f"Teacher {_t(t_id, teacher_map)} has {len(non_conf)} teaching sections (expected {expected} per section quotas)"
            })

    return issues
