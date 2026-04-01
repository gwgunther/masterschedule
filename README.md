# Master Schedule Solver

A web app that generates an optimal daily class schedule for a junior high school (7th–8th grade). It assigns teachers to courses and periods using a MILP (mathematical optimization) solver. Student enrollment totals are pre-determined inputs — the solver does **not** assign individual students.

---

## Quick Start

Two terminals required:

```bash
# Terminal 1 — Backend (Python API + solver)
cd MasterScheduleSolver/backend
python3 -m uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend (React UI)
cd MasterScheduleSolver/frontend
npm run dev
```

Then open **http://localhost:5173** in your browser.

---

## How to Use the App

### Schedule Tab (default)
1. Make sure your data CSVs are filled in (see below)
2. Click **Run Solver** — the solver runs in the background (typically 30–120 seconds)
3. The status chip shows: `Idle → Solving… → Done`
4. The **Schedule Grid** appears: rows = teachers (grouped by department), columns = Period 1–7
5. Click any teacher row to open the **Inspector sidebar** showing their full load, course per period, and student counts
6. Click **Run Checks** in the Validation bar to verify constraints are satisfied

### Data Tab
- 7 sidebar tabs, one per input table
- Click any cell to edit inline
- **Add Row** / **Delete Row** buttons for adding or removing entries
- **Save** writes changes back to the CSV file on disk
- **Reload** refreshes from disk (discards unsaved edits)

---

## Input Data Files

All files live in the `data/` folder. Replace the placeholder data with your real school data before running the solver.

---

### 1. `data/courses.csv` — Course Catalog

One row per course offered.

| Column | Type | Description |
|--------|------|-------------|
| `course_id` | string | Unique ID, e.g. `C_MATH_7_H` |
| `enrollment_7th` | integer | Number of 7th graders enrolled |
| `enrollment_8th` | integer | Number of 8th graders enrolled |
| `total_enrollment` | integer | Sum of 7th + 8th enrollment |
| `max_students_per_section` | integer | Max class size cap |
| `min_sections` | integer | Minimum sections required (= `ceil(total / max)`) |

**Course ID naming conventions:**
- `C_` prefix on all course IDs
- `_7` / `_8` suffix for grade-specific courses
- `_H` = Honors, `_DLI` = Dual Language Immersion, `_SDC` = Special Day Class, `_EA` = Enrichment Academy
- `_COTAUGHT` = SPED co-taught variant (use 0 enrollment; count in coteaching table instead)
- No grade suffix = mixed-grade or elective (e.g. `C_ART`, `C_PE_7`)

**Non-instructional courses** (consume teacher time, no students):
Set both enrollment columns and `max_students_per_section` to 0. Required entry:

```
C_CONFERENCE,0,0,0,0,0
```

Other common non-instructional examples: `C_PROGRESSMONITORING`, `C_MATHLAB`, `C_PBIS`, `C_TITLE1`

**Example rows:**
```
course_id,enrollment_7th,enrollment_8th,total_enrollment,max_students_per_section,min_sections
C_MATH_7,380,0,380,40,10
C_MATH_7_H,120,0,120,32,4
C_ENGLISH_8,0,374,374,40,10
C_ART,0,0,85,30,3
C_CONFERENCE,0,0,0,0,0
```

---

### 2. `data/teachers.csv` — Teacher Roster

One row per teacher.

| Column | Type | Description |
|--------|------|-------------|
| `teacher_id` | string | Unique ID, e.g. `T_SMITH` |
| `department` | string | Department name (see list below) |
| `teacher_max_sections` | integer | Number of teaching sections per day (not counting conference) |

**Departments used:** `MATH`, `SCIENCE`, `ENGLISH`, `SOCIAL SCIENCE`, `PE`, `SPED`, `CTE`, `VAPA`, `HEALTH`, `WORLD LANGUAGE`, `ELD`

**Special cases:**
- Most teachers: `teacher_max_sections = 6` (6 teaching + 1 conference = 7 periods)
- SPED co-teach-only teachers: `teacher_max_sections = 0` (their load comes entirely from co-teaching assignments)
- Part-time teachers: set to the actual number of sections they teach (e.g. `2`)

**Example rows:**
```
teacher_id,department,teacher_max_sections
T_SMITH,CTE,6
T_JONES,MATH,6
T_PARRA,SPED,4
T_FULLMER,SPED,0
T_HOKUF,PE,2
```

---

### 3. `data/teacher_qualifications.csv` — Course Credentials

Which courses each teacher is credentialed to teach. Many-to-many: one row per teacher–course pair.

| Column | Type | Description |
|--------|------|-------------|
| `teacher_id` | string | Must match a row in `teachers.csv` |
| `department` | string | Teacher's department |
| `course_id` | string | Must match a row in `courses.csv` |

**Notes:**
- `C_CONFERENCE` is implicitly available to all teachers — do not add it here
- SPED teachers must list their co-taught course IDs (e.g. `C_MATH_7_COTAUGHT`) here to be eligible
- A teacher can only be assigned a course if it appears in this table

**Example rows:**
```
teacher_id,department,course_id
T_JONES,MATH,C_MATH_7
T_JONES,MATH,C_MATH_7_H
T_SMITH,CTE,C_WOODSHOP
T_PARRA,SPED,C_MATH_7_COTAUGHT
```

---

### 4. `data/teacher_section_locks.csv` — Fixed Section Counts

Forces a specific teacher to teach **exactly N sections** of a course (period not specified — the solver picks the periods).

| Column | Type | Description |
|--------|------|-------------|
| `teacher_id` | string | Must match `teachers.csv` |
| `course_id` | string | Must match `courses.csv` |
| `num_sections` | integer | Exact number of sections this teacher must teach |

Use this when a specific teacher owns a course track. Leave this table empty if no section counts are fixed.

**Example rows:**
```
teacher_id,course_id,num_sections
T_JONES,C_MATH_7_H,3
T_SMITH,C_WOODSHOP,2
```

---

### 5. `data/course_constraints.csv` — Fixed Period Assignments

Locks a specific teacher + course + period combination. The solver must include this exact assignment.

| Column | Type | Description |
|--------|------|-------------|
| `course_id` | string | Must match `courses.csv` |
| `teacher_id` | string | Must match `teachers.csv` |
| `period` | integer | Period number (1–7) |

**Common uses:**
- Lock a teacher's conference period: `C_CONFERENCE, T_SMITH, 4`
- Lock a specialty class to a specific period (e.g. TV Studio always period 2)
- Lock part-time teacher sections to specific periods

**Example rows:**
```
course_id,teacher_id,period
C_CONFERENCE,T_JONES,3
C_CONFERENCE,T_SMITH,5
C_TVSTUDIO,T_LYMAN,2
C_APE,T_HOKUF,3
C_APE,T_HOKUF,4
```

---

### 6. `data/coteaching_combinations.csv` — SPED Co-Teaching

Defines SPED co-teaching pairs. The co-teacher must be scheduled in the **same period** as the primary teacher.

| Column | Type | Description |
|--------|------|-------------|
| `course_id` | string | The co-taught course (e.g. `C_MATH_7_COTAUGHT`) |
| `teacher_id` | string | The SPED co-teacher |
| `primary_course_id` | string | The main gen-ed course (e.g. `C_MATH_7`) |
| `primary_teacher_id` | string | The primary gen-ed teacher |
| `number_of_sections` | integer | How many sections this pair co-teaches together |

**Notes:**
- The co-taught course (`_COTAUGHT`) should exist in `courses.csv` with 0 enrollment
- The co-teacher must have the co-taught course listed in `teacher_qualifications.csv`
- Multiple SPED teachers can co-teach the same primary course (each gets their own row)

**Example rows:**
```
course_id,teacher_id,primary_course_id,primary_teacher_id,number_of_sections
C_MATH_7_COTAUGHT,T_PARRA,C_MATH_7,T_JONES,2
C_ENGLISH_8_COTAUGHT,T_BOUSCARY,C_ENGLISH_8,T_SMITH,1
```

---

### 7. `data/semester_pairs.csv` — Semester-Paired Electives

Elective courses that **share the same period slot** — students rotate between them each semester.

| Column | Type | Description |
|--------|------|-------------|
| `course_a` | string | First course in the pair |
| `course_b` | string | Second course in the pair |
| `teacher_a` | string | Teacher of course_a |
| `teacher_b` | string | Teacher of course_b |

**Notes:**
- The solver forces both teachers to be assigned to their respective courses in the same period
- Courses **not** listed here are treated as year-long (no pairing constraint)
- Both courses and teachers must exist in their respective tables

**Example rows:**
```
course_a,course_b,teacher_a,teacher_b
C_ART,C_PHOTO,T_AYALA,T_BERRY
C_ROBOTICS,C_WOODSHOP,T_BIDWELL,T_SMITH
C_MINECRAFT,C_MUSICAPPRECIATION,T_COLLAR,T_FONSECA
```

---

## Output

### `data/sections.csv` — Generated Schedule

Produced by the solver. One row per scheduled section.

| Column | Description |
|--------|-------------|
| `section_id` | e.g. `C_MATH_7-T_JONES-P2` |
| `course_id` | Course identifier |
| `teacher_id` | Assigned teacher |
| `period` | Period (1–7) |

---

## Constraints the Solver Enforces

| # | Constraint |
|---|------------|
| 1 | Each teacher teaches at most one course per period |
| 2 | Each teacher gets exactly one `C_CONFERENCE` period |
| 3 | Teachers only teach courses they are qualified for |
| 4 | Each teacher teaches exactly their `teacher_max_sections` sections |
| 5 | Each course gets at least `min_sections` sections |
| 6 | All entries in `course_constraints.csv` are locked in |
| 7 | All entries in `teacher_section_locks.csv` are honored exactly |
| 8 | Co-teaching pairs are always in the same period |
| 9 | Semester-paired electives always share the same period |

**Optimization goals (soft):**
- Minimize deviation from average class size across all sections
- Distribute track courses (Honors, DLI, SDC, EA) evenly across periods

---

## Tips

- **Infeasible result?** Usually means too many constraints conflict. Check `course_constraints.csv` for period conflicts, or that a teacher's `teacher_max_sections` is achievable given their qualifications and locks.
- **Run Checks** before running the solver — it catches broken foreign keys and overloaded teachers before the solve starts.
- **Placeholder data:** The current CSVs contain placeholder data. Replace with your real school data each year. The structure (column names) must stay the same.
- **Adding a new course:** Add it to `courses.csv`, then add at least one teacher qualification row in `teacher_qualifications.csv`, otherwise the solver cannot assign it.
