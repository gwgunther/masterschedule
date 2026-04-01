# Master Schedule Solver — Project Overview

Generates an optimal daily class schedule for South JH (7th–8th grade, 26-27 school year).
Assigns teachers to courses to periods. Student enrollment is a pre-determined input.

---

## Data Summary (26-27)

| Dimension         | Count  | Source File                              |
|-------------------|--------|------------------------------------------|
| Teachers          | 43     | `data/teachers.csv`                      |
| Courses           | 106    | `data/courses.csv`                       |
| Periods/day       | 7      |                                          |
| Qualifications    | 166    | `data/teacher_qualifications.csv`        |
| Section locks     | 5      | `data/teacher_section_locks.csv`         |
| Forced slots      | 52     | `data/course_constraints.csv`            |
| Co-teach pairs    | 12     | `data/coteaching_combinations.csv`       |
| Semester pairs    | 6      | `data/semester_pairs.csv`                |

---

## Architecture

```
Frontend (React/TypeScript, Vite, Tailwind)
    ↓ REST API (/api)
Backend (FastAPI, Python)
    ↓
Solver (PuLP MILP) / Validator / Data I/O
    ↓
CSV Files (data/projects/{project_id}/*.csv)
```

**Run:** `cd backend && uvicorn main:app --reload` + `cd frontend && npm run dev`

---

## Data Sources (raw)

| File | Purpose |
|------|---------|
| `data/raw/CourseTally.csv` | 26-27 course tally (99 courses, authoritative enrollment + section counts) |
| `data/raw/Copy of 26-27...Blank Matrix.xlsx` | Teacher roster, pre-filled assignments, department tabs |
| `data/raw/Copy of 25-26...Grid.xlsx` | Last year's completed schedule (reference for qualifications) |

---

## Processed Input Files

| # | File                           | Description                                    |
|---|--------------------------------|------------------------------------------------|
| 1 | `courses.csv`                  | 106 courses (99 from tally + 7 non-instructional) |
| 2 | `teachers.csv`                 | 43 teachers with departments & max sections    |
| 3 | `teacher_qualifications.csv`   | 166 teacher-to-course credentials              |
| 4 | `teacher_section_locks.csv`    | 5 forced section counts                        |
| 5 | `course_constraints.csv`       | 52 forced teacher+course+period assignments    |
| 6 | `coteaching_combinations.csv`  | 12 SPED co-teaching pairings                   |
| 7 | `semester_pairs.csv`           | 6 semester-paired electives                    |

See `data/DATA_SCHEMAS.md` for column-level schemas.

---

## Directory Structure

```
MasterScheduleSolver/
├── PROJECT_OVERVIEW.md
├── CONSTRAINTS.md
├── backend/
│   ├── main.py                      ← FastAPI server
│   ├── solver.py                    ← PuLP MILP solver
│   ├── validator.py                 ← Pre/post-solve validation
│   ├── data_io.py                   ← CSV read/write
│   ├── projects.py                  ← Multi-project management
│   └── requirements.txt
├── frontend/
│   └── src/                         ← React app (Schedule + Data pages)
├── data/
│   ├── DATA_SCHEMAS.md              ← Column-level schemas
│   ├── courses.csv                  ← 106 courses
│   ├── teachers.csv                 ← 43 teachers
│   ├── teacher_qualifications.csv   ← 166 credentials
│   ├── teacher_section_locks.csv    ← 5 locks
│   ├── course_constraints.csv       ← 52 forced slots
│   ├── coteaching_combinations.csv  ← 12 co-teach pairs
│   ├── semester_pairs.csv           ← 6 semester pairs
│   ├── raw/                         ← Source Excel + CSV files
│   ├── archive_25_26/               ← Previous year data (archived)
│   └── projects/                    ← Per-project data directories
└── OLD/                             ← Previous implementation (reference)
```

---

## Known Gaps

1. **9 courses with no qualified teacher** — SDC multi-subject (xx601F), Adaptive PE, Aide/Office/Library
2. **3 unknown assignments** — T_BUITRON P6, T_NGUYEN P6, T_WETROSKY final course
3. **REWARDS** — Placeholder non-instructional course for T_WETROSKY P6
4. **Cross-department teachers** — T_CHRISTENSEN (Math 2 sections + Social Science), T_JANI (Social Science + PE 1 section)
