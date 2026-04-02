"""Project + scenario management — file/DB operations for the project hierarchy.

Layout:
  data/projects/{slug}/
    project.json       — {name, description, created}
    schedule.db        — all scenarios' data
    runs/{scenario}/   — solver run directories
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path

import data_io

PROJECTS_DIR = Path(__file__).parent.parent / "data" / "projects"
CONTEXT_PATH = Path(__file__).parent.parent / "data" / "active_context.json"


# ── Slugify ───────────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """Convert a display name to a filesystem-safe slug."""
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s or "project"


def _unique_slug(name: str, existing: set[str]) -> str:
    base = _slugify(name)
    slug = base
    i = 2
    while slug in existing:
        slug = f"{base}-{i}"
        i += 1
    return slug


# ── Path helpers ──────────────────────────────────────────────────────────────

def project_dir(slug: str) -> Path:
    return PROJECTS_DIR / slug


def project_db_path(slug: str) -> Path:
    return PROJECTS_DIR / slug / "schedule.db"


def project_runs_dir(slug: str, scenario_slug: str) -> Path:
    return PROJECTS_DIR / slug / "runs" / scenario_slug


# ── Active context ────────────────────────────────────────────────────────────

def load_context() -> dict:
    """Load {project, scenario} from disk. Returns empty dict values if missing."""
    if CONTEXT_PATH.exists():
        return json.loads(CONTEXT_PATH.read_text())
    return {"project": None, "scenario": None}


def save_context(project: str | None, scenario: str | None) -> dict:
    ctx = {"project": project, "scenario": scenario}
    CONTEXT_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONTEXT_PATH.write_text(json.dumps(ctx, indent=2))
    return ctx


# ── Project CRUD ──────────────────────────────────────────────────────────────

def list_projects() -> list[dict]:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    projects = []
    for d in sorted(PROJECTS_DIR.iterdir()):
        if not d.is_dir():
            continue
        meta_path = d / "project.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())
        meta["slug"] = d.name
        projects.append(meta)
    return sorted(projects, key=lambda p: p.get("created", ""))


def get_project(slug: str) -> dict | None:
    meta_path = project_dir(slug) / "project.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text())
    meta["slug"] = slug
    return meta


def create_project(name: str, description: str = "") -> dict:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    existing = {d.name for d in PROJECTS_DIR.iterdir() if d.is_dir()}
    slug = _unique_slug(name, existing)
    pdir = project_dir(slug)
    pdir.mkdir(parents=True, exist_ok=True)

    now = datetime.now().isoformat()
    meta = {"name": name, "description": description, "created": now}
    (pdir / "project.json").write_text(json.dumps(meta, indent=2))

    # Initialize DB + create default "baseline" scenario
    db = project_db_path(slug)
    data_io.init_db(db)
    data_io.create_scenario(db, "baseline", "Baseline", "Default scenario")

    meta["slug"] = slug
    return meta


def update_project(slug: str, name: str | None = None, description: str | None = None) -> dict:
    meta_path = project_dir(slug) / "project.json"
    meta = json.loads(meta_path.read_text())
    if name is not None:
        meta["name"] = name
    if description is not None:
        meta["description"] = description
    meta_path.write_text(json.dumps(meta, indent=2))
    meta["slug"] = slug
    return meta


def delete_project(slug: str) -> None:
    pdir = project_dir(slug)
    if not pdir.is_dir():
        raise ValueError(f"Project '{slug}' not found")
    shutil.rmtree(pdir)
    # Clear context if this was the active project
    ctx = load_context()
    if ctx.get("project") == slug:
        save_context(None, None)


# ── Scenario CRUD (delegates to data_io) ─────────────────────────────────────

def list_scenarios(project_slug: str) -> list[dict]:
    return data_io.list_scenarios(project_db_path(project_slug))


def get_scenario(project_slug: str, scenario_slug: str) -> dict | None:
    return data_io.get_scenario(project_db_path(project_slug), scenario_slug)


def create_scenario(project_slug: str, name: str, clone_from: str | None = None, description: str = "") -> dict:
    db = project_db_path(project_slug)
    existing = {s["slug"] for s in data_io.list_scenarios(db)}
    slug = _unique_slug(name, existing)

    if clone_from:
        return data_io.clone_scenario(db, clone_from, slug, name, description)
    else:
        return data_io.create_scenario(db, slug, name, description)


def delete_scenario(project_slug: str, scenario_slug: str) -> None:
    db = project_db_path(project_slug)
    runs_dir = project_runs_dir(project_slug, scenario_slug)
    data_io.delete_scenario(db, scenario_slug, runs_dir)
    # Clear context if this was the active scenario
    ctx = load_context()
    if ctx.get("project") == project_slug and ctx.get("scenario") == scenario_slug:
        # Switch to first remaining scenario
        remaining = data_io.list_scenarios(db)
        if remaining:
            save_context(project_slug, remaining[0]["slug"])


def rename_scenario(project_slug: str, scenario_slug: str, new_name: str) -> dict:
    return data_io.rename_scenario(project_db_path(project_slug), scenario_slug, new_name)


def import_scenario_csv(project_slug: str, scenario_slug: str, table: str, csv_content: str) -> None:
    """Import CSV content into a scenario's table."""
    import csv as csv_mod
    import io
    reader = csv_mod.DictReader(io.StringIO(csv_content))
    rows = list(reader)
    db = project_db_path(project_slug)
    data_io.write_table(db, table, scenario_slug, rows)
