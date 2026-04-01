"""One-time migration: import existing CSVs from data/input/ into data/schedule.db.

Run from the backend/ directory:
    python3 migrate_to_sqlite.py
"""

import sys
from pathlib import Path

import pandas as pd

# Allow importing data_io from the same directory
sys.path.insert(0, str(Path(__file__).parent))
import data_io

INPUT_DIR = Path(__file__).parent.parent / "data" / "input"

CSV_NAMES = {
    "courses": "courses.csv",
    "teachers": "teachers.csv",
    "teacher_qualifications": "teacher_qualifications.csv",
    "teacher_section_locks": "teacher_section_locks.csv",
    "fixed_assignments": "fixed_assignments.csv",
    "coteaching_combinations": "coteaching_combinations.csv",
    "semester_pairs": "semester_pairs.csv",
}


def migrate():
    print(f"Target DB: {data_io.DB_PATH}")
    if data_io.DB_PATH.exists():
        print("  DB already exists — will merge (existing rows replaced per table).")

    data_io.init_db()

    for table, filename in CSV_NAMES.items():
        path = INPUT_DIR / filename
        if not path.exists():
            print(f"  SKIP  {table:35s} — {path} not found")
            continue

        df = pd.read_csv(path)
        df = df.where(pd.notna(df), None)  # NaN → None
        rows = df.to_dict(orient="records")
        data_io.write_table(table, rows)
        print(f"  OK    {table:35s} — {len(rows)} rows imported")

    print("\nMigration complete.")
    print(f"DB size: {data_io.DB_PATH.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    migrate()
