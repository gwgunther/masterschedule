# Master Schedule Solver — Constraints & Rules

The solver assigns **teachers to courses to periods**. Student enrollment numbers
and elective assignments are pre-determined inputs — the solver does NOT assign
individual students to sections.

---

## School Structure

- **School:** Junior high (middle school)
- **Grade levels:** 7th and 8th
- **Periods per day:** 7
- **Teachers:** 47
- **Courses:** 83 (including co-taught variants and non-instructional)
- **Departments:** 11 (CTE, ELD, English, Math, PE, Health, SPED, Science, Social Science, VAPA, World Language)
- **Tracks/Programs:** Honors (H), DLI (Dual Language Immersion), SDC (Special Day Class), EA (Enrichment Academy)
- **Approximate enrollment:** ~1,142 students
- **Schedule type:** Single repeating daily schedule (no A/B rotation)
- **Lunch:** One lunch for the whole school (fixed break between periods, not a period slot)

**Core subjects (required for all students, 7th and 8th grade):**
Math, English, Science, History, PE

**Elective structure:**
- Some electives are **year-long** (one course, same period all year)
- Some electives are **semester-paired** (two courses share one period slot, students rotate)

---

## Hard Constraints (must never be violated)

### 1. One Course Per Teacher Per Period
A teacher can teach at most one course in any given period.

### 2. Conference Period
Every teacher gets exactly one conference/prep period per day.
Modeled as `C_CONFERENCE` assigned to one of the 7 period slots.
Some are locked to specific periods (see constraint #6).

### 3. Teacher Qualifications
A teacher may only be assigned courses they are qualified to teach
(per `teacher_qualifications.csv`). Conference is implicitly available to all.

### 4. Teacher Section Limits
Each teacher must teach exactly their `max_sections` number of teaching sections.
- Most teachers: 6 sections + 1 conference = 7 periods
- SPED teachers: 3–5 sections + 1 conference (remaining periods = co-teach or duty)
- `T_FULLMER`: 0 primary sections (co-teach only); `max_sections=0` means their entire
  load is co-teaching. Validators must NOT count co-teaching sections against `max_sections`
  for teachers with `max_sections=0`.
- `T_HOKUF`: 2 sections (part-time)

### 5. Minimum Sections Per Course
Each course must have at least `min_sections` sections (pre-calculated):
`min_sections = ceil(total_enrollment / max_students_per_section)`.

### 6. Forced Assignments (Locked Slots)
Specific teacher + course + period combinations locked via `course_constraints.csv`:
- 13 conference period locks
- 2 APE locks (T_HOKUF periods 3+4)
- 4 science elective locks (all in period 1)
- 1 TV Studio lock (T_LYMAN period 2)

### 7. Teacher Section Locks (Locked Counts)
Specific teachers must teach exactly N sections of a course (period not specified):

| Teacher        | Course              | Sections |
|----------------|---------------------|----------|
| T_BETHENCOURT  | C_ENGLISH_8_EA      | 3        |
| T_CHAU         | C_SCIENCE_8_H       | 3        |
| T_GHAREEBO     | C_MATH_8_H          | 2        |
| T_HUMPHREY     | C_USHISTORY_8_EA    | 3        |
| T_MILLER       | C_MATH_8            | 1        |
| T_MILLER       | C_MATH_8_H          | 2        |
| T_PADILLA      | C_MATH_7_H          | 2        |

### 8. Co-Teaching Synchronization
SPED co-teachers must be scheduled in the same period as the primary general-ed teacher.
14 pairings defined in `coteaching_combinations.csv` across English, Math, Science, and History.

### 9. Paired Course Scheduling (same period, same or linked teachers)

**Health pairings (hardcoded):**
- `C_MULTIMEDIA/HEALTH`: `T_LYMAN` + `T_HAUGE` must be in the same period
- `C_BUSINESSTECH/HEALTH`: `T_NGUYEN` + `T_HAUGE` must be in the same period

**Semester-paired electives (same period, students rotate by semester):**
- `C_ART` + `C_PHOTO` — must have sections running in the same period(s)
- Music + Tech pairing — **exact course IDs to be confirmed** (see open questions)

### 10. Non-Instructional Courses (zero enrollment)
Courses with 0 enrollment and 0 capacity are non-instructional duty assignments.
They consume teacher periods but have no students. The solver should leave these
at 0 enrollment and treat them as blocks that fill teacher time.

Includes: `C_CONFERENCE`, `C_PROGRESSMONITORING`, `C_ASBRELEASE`, `C_CVA`,
`C_MATHLAB`, `C_TITLE1`, `C_5CS`, `C_PBIS`, `C_COMMUNITYSCHOOLS`

---

## Optimization Objectives (soft constraints / goals)

### 1. Balanced Class Sizes
Minimize deviation from the average class size across all sections.

### 2. Even Track Distribution Across Periods
Spread each track's courses evenly across the 7 periods to minimize student
scheduling conflicts within a track.

**Tracks to balance:** `_7_H`, `_8_H`, `_7_DLI`, `_8_DLI`, `_7_SDC`, `_8_SDC`, `_8_EA`

---

## Resolved Questions

1. **Scope:** Teacher scheduling only. Students are NOT assigned by the solver.
2. **Room assignments:** Not needed.
3. **Schedule type:** Single daily schedule, no A/B rotation.
4. **Lunch:** One lunch for all, fixed break between periods (not a period slot).
5. **Paired courses:** Hardcoded. Health pairings + semester elective pairings.
6. **Non-instructional courses:** Left at 0 enrollment, consume teacher periods.

---

## Open Questions

1. **Music + Tech pairing:** Which exact course IDs are paired?
   Candidates for "Music": `C_BAND1`, `C_BAND3`, `C_MODERNBAND`, `C_MUSICAPPRECIATION`
   Candidates for "Tech": `C_ROBOTICS`, `C_DRAFTING`, `C_DIGITALANIMATION`,
   `C_WOODSHOP`, `C_WOODSHOP2`

2. **Art + Photo teachers:** `C_ART` is taught by `T_AYALA`, `C_PHOTO` by `T_BERRY`.
   Must these two teachers specifically be in the same period, or just any ART and
   PHOTO sections?

3. **Are there other semester-paired electives** beyond Music+Tech and Art+Photo?
   (e.g., is Drama paired with anything?)

4. **Which electives are year-long vs semester?** This affects whether the solver
   needs to pair them. Year-long electives don't need pairing constraints.
