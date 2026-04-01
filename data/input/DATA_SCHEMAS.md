# Data Schemas — 26-27

The solver assigns **teachers to courses to periods**. Enrollment numbers are
pre-determined inputs — the solver does not assign individual students.

---

## Summary

| # | File                           | Type   | Rows | Purpose                                      |
|---|--------------------------------|--------|------|----------------------------------------------|
| 1 | `courses.csv`                  | input  | 106  | Course catalog with enrollment & sections    |
| 2 | `teachers.csv`                 | input  | 43   | Teacher roster with department & max sections|
| 3 | `teacher_qualifications.csv`   | input  | 166  | Which courses each teacher may teach         |
| 4 | `teacher_section_locks.csv`    | input  | 5    | Forced teacher+course section counts         |
| 5 | `course_constraints.csv`       | input  | 52   | Fixed teacher+course+period assignments      |
| 6 | `coteaching_combinations.csv`  | input  | 12   | SPED co-teacher pairings & section counts    |
| 7 | `semester_pairs.csv`           | input  | 6    | Semester-paired electives sharing periods    |
| 8 | `sections.csv`                 | output | —    | Generated: one row per section instance      |

---

## Input Tables

### 1. `courses.csv` (106 courses)

| Column              | Type    | Description                                  |
|---------------------|---------|----------------------------------------------|
| `course_id`         | string  | District code, e.g. `MA701F`, `CE9701`       |
| `course_title`      | string  | Human-readable name                          |
| `enrollment_7th`    | integer | 7th graders enrolled                         |
| `enrollment_8th`    | integer | 8th graders enrolled                         |
| `total_enrollment`  | integer | Master total (may exceed sum due to rollups) |
| `num_sections`      | integer | Number of sections to schedule               |
| `notes`             | string  | Flags like `*must be 8`, non-instructional   |

**Course ID patterns:**
- `xxxx0` suffix — Co-Taught RSP (e.g. `EN9700`, `MA9700`)
- `xxxx1` suffix — Collab/Aide RSP (e.g. `EN9701`, `MA9701`)
- `xxxx2` suffix — PM Only / No Support RSP (e.g. `EN9702`, `MA9702`)
- `xx601F` — SDC multi-subject (e.g. `EN601F`, `MA601F`)
- `xxxx0F` — Standard gen-ed (e.g. `EN700F`, `MA800F`)
- `xxxx1F` — Honors (e.g. `EN701F`, `MA801F`)
- `xxxx2F` — Honors-SP / DLI (e.g. `MA702F`, `SS802F`)

**Non-instructional courses (0 enrollment, consume teacher time):**
`CONFERENCE`, `PROGRESSMON`, `TITLE1`, `COMSCHOOLS`, `5CS`, `ASBRELEASE`, `REWARDS`

---

### 2. `teachers.csv` (43 teachers)

| Column          | Type    | Description                                        |
|-----------------|---------|-----------------------------------------------------|
| `teacher_id`    | string  | e.g. `T_SMITH`                                      |
| `full_name`     | string  | Display name from workbook                          |
| `department`    | string  | MATH, SCIENCE, ENGLISH, SPED, CTE, VAPA, etc.      |
| `max_sections`  | integer | Teaching sections per day (excl. conference)        |

**Notes:**
- SPED teachers default to `max_sections=5`
- Cross-department teachers: `T_CHRISTENSEN` (MATH/SOCIAL SCIENCE), `T_JANI` (SOCIAL SCIENCE/PE)
- All gen-ed teachers default to `max_sections=6`

---

### 3. `teacher_qualifications.csv` (166 entries)

| Column       | Type   | Description                            |
|--------------|--------|----------------------------------------|
| `teacher_id` | string | Teacher identifier                     |
| `department` | string | Teacher's department                   |
| `course_id`  | string | Course they are credentialed to teach  |

Many-to-many. `CONFERENCE` implicitly available to all teachers.

---

### 4. `teacher_section_locks.csv` (5 entries)

Forces a teacher to teach **exactly N sections** of a course (period not specified).

| Column        | Type    | Description                            |
|---------------|---------|----------------------------------------|
| `teacher_id`  | string  | Teacher who must teach it              |
| `course_id`   | string  | Course they are locked into            |
| `num_sections`| integer | Exact number of sections               |
| `notes`       | string  | Context                                |

---

### 5. `course_constraints.csv` (52 entries)

Locks a specific teacher + course + period combination.

| Column           | Type    | Description                             |
|------------------|---------|-----------------------------------------|
| `teacher_id`     | string  | Teacher locked to this slot             |
| `course_id`      | string  | Course ID locked to this slot           |
| `course_display` | string  | Human-readable course name              |
| `period`         | integer | Period (1–7)                            |

---

### 6. `coteaching_combinations.csv` (12 entries)

SPED co-teachers must be in the same period as the gen-ed teacher's matching course.

| Column          | Type    | Description                                    |
|-----------------|---------|------------------------------------------------|
| `coteach_id`    | string  | Co-taught course ID (e.g. `EN9700`)            |
| `sped_teacher`  | string  | The SPED co-teacher                            |
| `gened_teacher` | string  | The gen-ed primary teacher                     |
| `gened_course`  | string  | The gen-ed course being co-taught              |
| `num_sections`  | integer | How many sections this pair co-teaches         |
| `notes`         | string  | Context                                        |

---

### 7. `semester_pairs.csv` (6 entries)

Semester-paired courses share the same period slot, taught by different teachers in alternating semesters.

| Column      | Type   | Description                             |
|-------------|--------|-----------------------------------------|
| `course_a`  | string | First course in pair                    |
| `course_b`  | string | Second course in pair                   |
| `teacher_a` | string | Teacher for course_a                    |
| `teacher_b` | string | Teacher for course_b                    |
| `notes`     | string | Context                                 |

---

## Output Table

### 8. `sections.csv` (generated by solver)

One row per scheduled section instance.

| Column       | Type    | Description                    |
|--------------|---------|--------------------------------|
| `section_id` | string  | e.g. `MA700F-T_PADILLA-P2`    |
| `course_id`  | string  | Course identifier              |
| `teacher_id` | string  | Assigned teacher               |
| `period`     | integer | Period (1–7)                   |

---

## Known Gaps (need user input)

1. **Unassigned courses** — 9 courses have no qualified teacher:
   - `EN601F`, `MA601F`, `SC601F`, `SS601F`, `ND601F` (SDC multi-subject)
   - `PE601F` (Adaptive PE — no PE teacher assigned)
   - `ND840F`, `ND841F`, `ND845F` (Aide/Office/Library)

2. **Unknown assignments** — `T_BUITRON` P6, `T_NGUYEN` P6, `T_WETROSKY` final course TBD

3. **REWARDS** — Course for `T_WETROSKY` P6, not in course tally. Placeholder.
