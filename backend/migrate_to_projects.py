"""One-time migration: move existing data into the project/scenario hierarchy.

Creates:
  data/projects/south-jh-2026/
    project.json
    schedule.db (with scenario_id columns + "baseline" scenario)
    runs/baseline/  (moved from data/runs/)

Archives:
  data/schedule.db → data/archive/schedule.db.bak

Run from the backend directory:
  python3 migrate_to_projects.py
"""

import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
OLD_DB = ROOT / "data" / "schedule.db"
OLD_RUNS = ROOT / "data" / "runs"
PROJECTS_DIR = ROOT / "data" / "projects"
CONTEXT_PATH = ROOT / "data" / "active_context.json"

PROJECT_SLUG = "south-jh-2026"
PROJECT_NAME = "South Junior High 2026"
SCENARIO_SLUG = "baseline"
SCENARIO_NAME = "Baseline"

DATA_TABLES = [
    "courses",
    "teachers",
    "teacher_qualifications",
    "teacher_section_locks",
    "fixed_assignments",
    "coteaching_combinations",
    "semester_pairs",
    "departments",
]


def migrate():
    project_dir = PROJECTS_DIR / PROJECT_SLUG
    new_db_path = project_dir / "schedule.db"
    new_runs = project_dir / "runs" / SCENARIO_SLUG

    if project_dir.exists():
        print(f"ERROR: {project_dir} already exists. Migration may have already run.")
        return

    # 1. Create project directory
    project_dir.mkdir(parents=True, exist_ok=True)
    print(f"Created {project_dir}")

    # 2. Write project.json
    now = datetime.now().isoformat()
    meta = {"name": PROJECT_NAME, "description": "Migrated from original data", "created": now}
    (project_dir / "project.json").write_text(json.dumps(meta, indent=2))
    print(f"Wrote project.json")

    # 3. Copy the old DB
    shutil.copy2(OLD_DB, new_db_path)
    print(f"Copied schedule.db")

    # 4. Add scenario_id columns + scenarios table
    con = sqlite3.connect(new_db_path)
    con.execute("PRAGMA journal_mode=WAL")

    # Create scenarios table
    con.execute("""
        CREATE TABLE IF NOT EXISTS "scenarios" (
            "slug" TEXT PRIMARY KEY,
            "name" TEXT,
            "description" TEXT,
            "created" TEXT
        )
    """)
    con.execute(
        'INSERT INTO "scenarios" (slug, name, description, created) VALUES (?, ?, ?, ?)',
        (SCENARIO_SLUG, SCENARIO_NAME, "Default scenario", now),
    )
    print(f"Created scenarios table with '{SCENARIO_SLUG}'")

    # Add scenario_id to each data table and set it
    for table in DATA_TABLES:
        # Check if scenario_id column already exists
        cols_info = con.execute(f'PRAGMA table_info("{table}")').fetchall()
        cols = {r[1] for r in cols_info}

        # Rebuild departments to drop old PRIMARY KEY on department_code
        if table == "departments":
            non_scenario_cols = [r[1] for r in cols_info]
            cols_str = ", ".join(f'"{c}"' for c in non_scenario_cols)
            con.execute(f'''CREATE TABLE "{table}_new" (
                "scenario_id" TEXT, {", ".join(f'"{c}" TEXT' for c in non_scenario_cols)}
            )''')
            con.execute(f'INSERT INTO "{table}_new" (scenario_id, {cols_str}) SELECT ?, {cols_str} FROM "{table}"', (SCENARIO_SLUG,))
            con.execute(f'DROP TABLE "{table}"')
            con.execute(f'ALTER TABLE "{table}_new" RENAME TO "{table}"')
        else:
            if "scenario_id" not in cols:
                con.execute(f'ALTER TABLE "{table}" ADD COLUMN "scenario_id" TEXT')
            con.execute(f'UPDATE "{table}" SET scenario_id = ?', (SCENARIO_SLUG,))

        count = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        print(f"  {table}: {count} rows → scenario_id = '{SCENARIO_SLUG}'")

    con.commit()
    con.close()

    # 5. Move runs
    if OLD_RUNS.exists() and any(OLD_RUNS.iterdir()):
        new_runs.mkdir(parents=True, exist_ok=True)
        for run_dir in OLD_RUNS.iterdir():
            if run_dir.is_dir():
                dest = new_runs / run_dir.name
                shutil.move(str(run_dir), str(dest))
                print(f"  Moved run {run_dir.name}")
        # Remove old runs directory if empty
        if not any(OLD_RUNS.iterdir()):
            OLD_RUNS.rmdir()
            print(f"Removed empty {OLD_RUNS}")
    else:
        new_runs.mkdir(parents=True, exist_ok=True)
        print("No existing runs to move")

    # 6. Write active context
    ctx = {"project": PROJECT_SLUG, "scenario": SCENARIO_SLUG}
    CONTEXT_PATH.write_text(json.dumps(ctx, indent=2))
    print(f"Set active context → {ctx}")

    # 7. Archive old DB
    archive_dir = ROOT / "data" / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    # Move DB + WAL/SHM files
    for suffix in ("", "-shm", "-wal"):
        src = Path(str(OLD_DB) + suffix)
        if src.exists():
            shutil.move(str(src), str(archive_dir / (src.name)))
    print(f"Archived old schedule.db → {archive_dir}")

    print("\nMigration complete!")
    print(f"  Project: {PROJECT_NAME} ({PROJECT_SLUG})")
    print(f"  Scenario: {SCENARIO_NAME} ({SCENARIO_SLUG})")
    print(f"  DB: {new_db_path}")


if __name__ == "__main__":
    migrate()
