"""SQLite data access layer — parameterized for project/scenario support.


All read/write functions accept db_path and scenario_id so callers
(main.py, project_manager.py) control which project + scenario is active.
Run management functions accept runs_dir for the same reason.
"""
from __future__ import annotations

import csv
import io
import json
import shutil
import sqlite3
import zipfile
from datetime import datetime
from pathlib import Path

import pandas as pd

OUTPUT_TABLE = "sections.csv"

# Ordered list of input table names (also used for CSV export filenames)
TABLES: list[str] = [
    "courses",
    "teachers",
    "teacher_qualifications",
    "teacher_section_locks",
    "fixed_assignments",
    "coteaching_combinations",
    "semester_pairs",
    "departments",
]

# Default column definitions for each table (used when creating fresh DB)
_SCHEMAS: dict[str, list[tuple[str, str]]] = {
    "scenarios": [
        ("slug", "TEXT PRIMARY KEY"),
        ("name", "TEXT"),
        ("description", "TEXT"),
        ("created", "TEXT"),
    ],
    "courses": [
        ("scenario_id", "TEXT"),
        ("course_id", "TEXT"),
        ("course_title", "TEXT"),
        ("enrollment_7th", "INTEGER"),
        ("enrollment_8th", "INTEGER"),
        ("total_enrollment", "INTEGER"),
        ("num_sections", "INTEGER"),
        ("max_class_size", "INTEGER"),
        ("notes", "TEXT"),
    ],
    "teachers": [
        ("scenario_id", "TEXT"),
        ("teacher_id", "TEXT"),
        ("full_name", "TEXT"),
        ("department", "TEXT"),
        ("max_sections", "INTEGER"),
    ],
    "teacher_qualifications": [
        ("scenario_id", "TEXT"),
        ("teacher_id", "TEXT"),
        ("department", "TEXT"),
        ("course_id", "TEXT"),
    ],
    "teacher_section_locks": [
        ("scenario_id", "TEXT"),
        ("teacher_id", "TEXT"),
        ("course_id", "TEXT"),
        ("num_sections", "INTEGER"),
        ("notes", "TEXT"),
    ],
    "fixed_assignments": [
        ("scenario_id", "TEXT"),
        ("teacher_id", "TEXT"),
        ("course_id", "TEXT"),
        ("course_display", "TEXT"),
        ("period", "INTEGER"),
    ],
    "coteaching_combinations": [
        ("scenario_id", "TEXT"),
        ("coteach_id", "TEXT"),
        ("sped_teacher", "TEXT"),
        ("gened_teacher", "TEXT"),
        ("gened_course", "TEXT"),
        ("num_sections", "INTEGER"),
        ("notes", "TEXT"),
    ],
    "semester_pairs": [
        ("scenario_id", "TEXT"),
        ("course_a", "TEXT"),
        ("course_b", "TEXT"),
        ("teacher_a", "TEXT"),
        ("teacher_b", "TEXT"),
        ("notes", "TEXT"),
    ],
    "departments": [
        ("scenario_id", "TEXT"),
        ("department_code", "TEXT"),
        ("display_name", "TEXT"),
    ],
}


# ── Connection ────────────────────────────────────────────────────────────────

def _get_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db(db_path: Path) -> None:
    """Create all tables if they don't exist. Safe to call repeatedly."""
    with _get_db(db_path) as con:
        for table, cols in _SCHEMAS.items():
            col_defs = ", ".join(f'"{c}" {t}' for c, t in cols)
            con.execute(f'CREATE TABLE IF NOT EXISTS "{table}" ({col_defs})')
        con.commit()


def _ensure_columns(con: sqlite3.Connection, table: str, row_keys: list[str]) -> None:
    """Add any columns that exist in row_keys but not yet in the table."""
    existing = {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}
    for col in row_keys:
        if col not in existing:
            con.execute(f'ALTER TABLE "{table}" ADD COLUMN "{col}" TEXT')


# ── Core read / write ─────────────────────────────────────────────────────────

def read_table(db_path: Path, table: str, scenario_id: str) -> list[dict]:
    if table not in TABLES:
        raise ValueError(f"Unknown table: {table}")
    init_db(db_path)
    with _get_db(db_path) as con:
        rows = con.execute(
            f'SELECT * FROM "{table}" WHERE scenario_id = ?', (scenario_id,)
        ).fetchall()
    # Strip scenario_id from results — callers don't need it
    return [{k: v for k, v in dict(r).items() if k != "scenario_id"} for r in rows]


def write_table(db_path: Path, table: str, scenario_id: str, rows: list[dict]) -> None:
    if table not in TABLES:
        raise ValueError(f"Unknown table: {table}")
    init_db(db_path)

    with _get_db(db_path) as con:
        # Delete existing rows for this scenario
        con.execute(f'DELETE FROM "{table}" WHERE scenario_id = ?', (scenario_id,))

        if not rows:
            con.commit()
            return

        # Normalise: drop computed columns, inject scenario_id
        clean = []
        for r in rows:
            row = {k: (None if v == "" else v) for k, v in r.items() if k != "scenario_id"}
            row["scenario_id"] = scenario_id
            clean.append(row)

        cols = list(clean[0].keys())
        _ensure_columns(con, table, cols)
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(f'"{c}"' for c in cols)
        con.executemany(
            f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders})',
            [[r.get(c) for c in cols] for r in clean],
        )
        con.commit()


def read_all(db_path: Path, scenario_id: str) -> dict:
    return {name: read_table(db_path, name, scenario_id) for name in TABLES}


# ── Scenario helpers ──────────────────────────────────────────────────────────

def list_scenarios(db_path: Path) -> list[dict]:
    init_db(db_path)
    with _get_db(db_path) as con:
        rows = con.execute('SELECT * FROM "scenarios" ORDER BY created').fetchall()
    return [dict(r) for r in rows]


def get_scenario(db_path: Path, slug: str) -> dict | None:
    init_db(db_path)
    with _get_db(db_path) as con:
        row = con.execute('SELECT * FROM "scenarios" WHERE slug = ?', (slug,)).fetchone()
    return dict(row) if row else None


def create_scenario(db_path: Path, slug: str, name: str, description: str = "") -> dict:
    init_db(db_path)
    now = datetime.now().isoformat()
    with _get_db(db_path) as con:
        con.execute(
            'INSERT INTO "scenarios" (slug, name, description, created) VALUES (?, ?, ?, ?)',
            (slug, name, description, now),
        )
        con.commit()
    return {"slug": slug, "name": name, "description": description, "created": now}


def clone_scenario(db_path: Path, source_slug: str, target_slug: str, target_name: str, description: str = "") -> dict:
    """Clone all data rows from source scenario into a new scenario."""
    scenario = create_scenario(db_path, target_slug, target_name, description)
    with _get_db(db_path) as con:
        for table in TABLES:
            # Get column names (excluding scenario_id)
            info = con.execute(f'PRAGMA table_info("{table}")').fetchall()
            all_cols = [r[1] for r in info]
            non_scenario_cols = [c for c in all_cols if c != "scenario_id"]
            cols_str = ", ".join(f'"{c}"' for c in non_scenario_cols)
            con.execute(
                f'INSERT INTO "{table}" (scenario_id, {cols_str}) '
                f'SELECT ?, {cols_str} FROM "{table}" WHERE scenario_id = ?',
                (target_slug, source_slug),
            )
        con.commit()
    return scenario


def delete_scenario(db_path: Path, slug: str, runs_dir: Path | None = None) -> None:
    """Delete a scenario and all its data. Cannot delete the last scenario."""
    with _get_db(db_path) as con:
        count = con.execute('SELECT COUNT(*) FROM "scenarios"').fetchone()[0]
        if count <= 1:
            raise ValueError("Cannot delete the last scenario")
        con.execute('DELETE FROM "scenarios" WHERE slug = ?', (slug,))
        for table in TABLES:
            con.execute(f'DELETE FROM "{table}" WHERE scenario_id = ?', (slug,))
        con.commit()
    # Clean up run directories for this scenario
    if runs_dir and runs_dir.is_dir():
        shutil.rmtree(runs_dir)


def rename_scenario(db_path: Path, slug: str, new_name: str) -> dict:
    with _get_db(db_path) as con:
        con.execute('UPDATE "scenarios" SET name = ? WHERE slug = ?', (new_name, slug))
        con.commit()
    return get_scenario(db_path, slug)


# ── Export helpers ────────────────────────────────────────────────────────────

def export_table_csv(db_path: Path, table: str, scenario_id: str) -> str:
    """Return a table as a CSV string."""
    rows = read_table(db_path, table, scenario_id)
    if not rows:
        return ""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def export_all_zip(db_path: Path, scenario_id: str, runs_dir: Path, include_output: bool = True) -> bytes:
    """Return a ZIP archive containing all input tables (and optionally the latest solver output) as CSVs."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for table in TABLES:
            csv_str = export_table_csv(db_path, table, scenario_id)
            zf.writestr(f"{table}.csv", csv_str)
        if include_output:
            latest = _latest_run_dir(runs_dir)
            if latest is not None:
                output_path = latest / OUTPUT_TABLE
                if output_path.exists():
                    zf.writestr(OUTPUT_TABLE, output_path.read_text())
    return buf.getvalue()


# ── Run management ────────────────────────────────────────────────────────────

def create_run(db_path: Path, scenario_id: str, runs_dir: Path) -> Path:
    """Create a new timestamped run directory and snapshot all inputs as CSVs for the solver."""
    runs_dir.mkdir(parents=True, exist_ok=True)
    run_id = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    run_dir = runs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    # Export SQLite → CSVs so solver (which reads CSVs) can work unchanged
    for table in TABLES:
        rows = read_table(db_path, table, scenario_id)
        if rows:
            df = pd.DataFrame(rows)
        else:
            df = pd.DataFrame()
        df.to_csv(run_dir / f"{table}.csv", index=False)

    meta = {"run_id": run_id, "created": datetime.now().isoformat(), "status": "running"}
    (run_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    return run_dir


def update_run_meta(run_dir: Path, **kwargs) -> None:
    meta_path = run_dir / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta.update(kwargs)
    meta_path.write_text(json.dumps(meta, indent=2))


def list_runs(runs_dir: Path) -> list[dict]:
    runs_dir.mkdir(parents=True, exist_ok=True)
    runs = []
    for d in sorted(runs_dir.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        meta_path = d / "meta.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"run_id": d.name}
        meta["run_id"] = d.name
        meta["has_schedule"] = (d / OUTPUT_TABLE).exists()
        runs.append(meta)
    return runs


def delete_run(runs_dir: Path, run_id: str) -> None:
    run_dir = runs_dir / run_id
    if not run_dir.is_dir():
        raise ValueError(f"Run '{run_id}' not found")
    shutil.rmtree(run_dir)


def read_schedule(runs_dir: Path, run_id: str | None = None) -> list[dict] | None:
    if run_id:
        path = runs_dir / run_id / OUTPUT_TABLE
    else:
        latest = _latest_run_dir(runs_dir)
        if latest is None:
            return None
        path = latest / OUTPUT_TABLE
    if not path.exists():
        return None
    df = pd.read_csv(path)
    return df.where(pd.notna(df), None).to_dict(orient="records")


def _latest_run_dir(runs_dir: Path) -> Path | None:
    runs_dir.mkdir(parents=True, exist_ok=True)
    dirs = sorted(
        [d for d in runs_dir.iterdir() if d.is_dir() and (d / OUTPUT_TABLE).exists()],
        reverse=True,
    )
    return dirs[0] if dirs else None
