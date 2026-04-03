"""
Migration: strip the T_ prefix from all teacher_id values across all tables.
Run once per database. Safe to re-run (no-ops if prefix already removed).
"""
import sqlite3
from pathlib import Path

DB_PATHS = [
    Path(__file__).parent.parent / "data/projects/south-jh-2026/schedule.db",
    Path(__file__).parent.parent / "data/projects/test/schedule.db",
]

# (table, column) pairs that hold teacher IDs
TEACHER_ID_COLS = [
    ("teachers",                "teacher_id"),
    ("teacher_qualifications",  "teacher_id"),
    ("teacher_section_locks",   "teacher_id"),
    ("fixed_assignments",       "teacher_id"),
    ("coteaching_combinations", "gened_teacher"),
    ("coteaching_combinations", "swd_teacher"),
    ("semester_pairs",          "teacher_a"),
    ("semester_pairs",          "teacher_b"),
]

def migrate(db_path: Path):
    if not db_path.exists():
        print(f"  Skipping (not found): {db_path}")
        return
    con = sqlite3.connect(db_path)
    try:
        with con:
            for table, col in TEACHER_ID_COLS:
                # Check table exists
                exists = con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
                ).fetchone()
                if not exists:
                    continue
                result = con.execute(
                    f'UPDATE "{table}" SET "{col}" = SUBSTR("{col}", 3) '
                    f'WHERE "{col}" LIKE "T\\_%"  ESCAPE "\\"'
                )
                if result.rowcount:
                    print(f"  {table}.{col}: updated {result.rowcount} rows")
        print(f"  Done: {db_path}")
    finally:
        con.close()

for db in DB_PATHS:
    print(f"\nMigrating {db}...")
    migrate(db)
