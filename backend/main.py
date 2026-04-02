"""FastAPI backend for Master Schedule Solver."""

import threading
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

import data_io
import project_manager
import validator
from solver import run_solver

app = FastAPI(title="Master Schedule Solver API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Active context helpers ───────────────────────────────────────────────────

def _ctx():
    """Return current active context, raising 400 if not set."""
    ctx = project_manager.load_context()
    if not ctx.get("project") or not ctx.get("scenario"):
        raise HTTPException(status_code=400, detail="No active project/scenario. Set one via PUT /api/context.")
    return ctx


def _db_path():
    return project_manager.project_db_path(_ctx()["project"])


def _scenario_id():
    return _ctx()["scenario"]


def _runs_dir():
    ctx = _ctx()
    return project_manager.project_runs_dir(ctx["project"], ctx["scenario"])


# ── Solver state (in-memory, single-user local app) ───────────────────────────
_solver_state: dict[str, Any] = {
    "status": "idle",
    "message": "",
    "solve_time": None,
    "error": None,
    "run_id": None,
    "phase": None,
    "phase_message": None,
    "diagnostics": None,
    "has_best_attempt": False,
}
_solver_lock = threading.Lock()


# ── Context endpoints ────────────────────────────────────────────────────────

@app.get("/api/context")
def get_context():
    ctx = project_manager.load_context()
    result = {"project": ctx.get("project"), "scenario": ctx.get("scenario")}
    # Enrich with display names
    if result["project"]:
        proj = project_manager.get_project(result["project"])
        result["project_name"] = proj["name"] if proj else None
    if result["project"] and result["scenario"]:
        sc = project_manager.get_scenario(result["project"], result["scenario"])
        result["scenario_name"] = sc["name"] if sc else None
    return result


class ContextRequest(BaseModel):
    project: str
    scenario: str


@app.put("/api/context")
def set_context(body: ContextRequest):
    # Validate project + scenario exist
    proj = project_manager.get_project(body.project)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Project '{body.project}' not found")
    sc = project_manager.get_scenario(body.project, body.scenario)
    if not sc:
        raise HTTPException(status_code=404, detail=f"Scenario '{body.scenario}' not found")
    project_manager.save_context(body.project, body.scenario)
    # Reset solver state on context switch
    with _solver_lock:
        _solver_state.update({
            "status": "idle", "message": "", "solve_time": None, "error": None,
            "run_id": None, "phase": None, "phase_message": None,
            "diagnostics": None, "has_best_attempt": False,
        })
    return get_context()


# ── Project endpoints ────────────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    return {"projects": project_manager.list_projects()}


@app.get("/api/projects/{slug}")
def get_project(slug: str):
    proj = project_manager.get_project(slug)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
    return proj


class ProjectRequest(BaseModel):
    name: str
    description: str = ""


@app.post("/api/projects")
def create_project(body: ProjectRequest):
    proj = project_manager.create_project(body.name, body.description)
    return proj


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


@app.put("/api/projects/{slug}")
def update_project(slug: str, body: ProjectUpdateRequest):
    try:
        return project_manager.update_project(slug, body.name, body.description)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/projects/{slug}/settings")
def get_project_settings(slug: str):
    return project_manager.get_settings(slug)


@app.put("/api/projects/{slug}/settings")
def update_project_settings(slug: str, body: dict):
    return project_manager.update_settings(slug, body)


@app.delete("/api/projects/{slug}")
def delete_project(slug: str):
    try:
        project_manager.delete_project(slug)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Scenario endpoints ───────────────────────────────────────────────────────

@app.get("/api/projects/{slug}/scenarios")
def list_scenarios(slug: str):
    return {"scenarios": project_manager.list_scenarios(slug)}


class ScenarioRequest(BaseModel):
    name: str
    clone_from: str | None = None
    description: str = ""


@app.post("/api/projects/{slug}/scenarios")
def create_scenario(slug: str, body: ScenarioRequest):
    return project_manager.create_scenario(slug, body.name, body.clone_from, body.description)


class ScenarioUpdateRequest(BaseModel):
    name: str


@app.put("/api/projects/{slug}/scenarios/{sc}")
def rename_scenario(slug: str, sc: str, body: ScenarioUpdateRequest):
    result = project_manager.rename_scenario(slug, sc, body.name)
    if not result:
        raise HTTPException(status_code=404, detail=f"Scenario '{sc}' not found")
    return result


@app.delete("/api/projects/{slug}/scenarios/{sc}")
def delete_scenario(slug: str, sc: str):
    try:
        project_manager.delete_scenario(slug, sc)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── CSV import endpoint ──────────────────────────────────────────────────────

@app.post("/api/projects/{slug}/scenarios/{sc}/import/{table}")
async def import_csv(slug: str, sc: str, table: str, file: UploadFile = File(...)):
    content = (await file.read()).decode("utf-8")
    try:
        project_manager.import_scenario_csv(slug, sc, table, content)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Data endpoints (read/write — scoped to active context) ──────────────────

@app.get("/api/data/{table}")
def get_table(table: str):
    try:
        return data_io.read_table(_db_path(), table, _scenario_id())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class SaveRequest(BaseModel):
    rows: list[dict]


@app.put("/api/data/{table}")
def save_table(table: str, body: SaveRequest):
    try:
        data_io.write_table(_db_path(), table, _scenario_id(), body.rows)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Export endpoints ──────────────────────────────────────────────────────────

@app.get("/api/export/{table}")
def export_table(table: str):
    try:
        csv_str = data_io.export_table_csv(_db_path(), table, _scenario_id())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{table}.csv"'},
    )


@app.get("/api/export")
def export_all():
    from datetime import date
    zip_bytes = data_io.export_all_zip(_db_path(), _scenario_id(), _runs_dir())
    filename = f"master_schedule_{date.today().isoformat()}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Runs endpoints ────────────────────────────────────────────────────────────

@app.get("/api/runs")
def list_runs():
    return {"runs": data_io.list_runs(_runs_dir())}


@app.get("/api/runs/{run_id}/schedule")
def get_run_schedule(run_id: str):
    result = data_io.read_schedule(_runs_dir(), run_id)
    if result is None:
        return {"exists": False, "sections": []}
    return {"exists": True, "sections": result}


@app.delete("/api/runs/{run_id}")
def delete_run(run_id: str):
    try:
        data_io.delete_run(_runs_dir(), run_id)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ── Schedule endpoint (latest run) ───────────────────────────────────────────

@app.get("/api/schedule")
def get_schedule():
    result = data_io.read_schedule(_runs_dir())
    if result is None:
        return {"exists": False, "sections": []}
    return {"exists": True, "sections": result}


# ── Validation endpoint ──────────────────────────────────────────────────────

@app.get("/api/validate")
def validate():
    data_issues = validator.validate_data(_db_path(), _scenario_id())
    schedule_issues = validator.validate_schedule(_db_path(), _scenario_id(), _runs_dir())
    return {
        "data_issues": data_issues,
        "schedule_issues": schedule_issues,
        "error_count": sum(1 for i in data_issues + schedule_issues if i["level"] == "error"),
        "warning_count": sum(1 for i in data_issues + schedule_issues if i["level"] == "warning"),
    }


# ── Solver endpoints ─────────────────────────────────────────────────────────

@app.post("/api/solver/run")
def start_solver():
    with _solver_lock:
        if _solver_state["status"] == "running":
            return {"status": "running", "message": "Solver already running"}
        _solver_state.update({
            "status": "running",
            "message": "Starting...",
            "solve_time": None,
            "error": None,
            "run_id": None,
            "phase": "starting",
            "phase_message": "Starting...",
            "diagnostics": None,
            "has_best_attempt": False,
        })

    # Capture context at start time (in case user switches mid-solve)
    db_path = _db_path()
    scenario_id = _scenario_id()
    runs_dir = _runs_dir()

    def _progress(phase: str, message: str):
        with _solver_lock:
            _solver_state["phase"] = phase
            _solver_state["phase_message"] = message

    def _run():
        result = run_solver(db_path=db_path, scenario_id=scenario_id, runs_dir=runs_dir, progress_cb=_progress)
        with _solver_lock:
            if result["status"] == "optimal":
                _solver_state.update({
                    "status": "done",
                    "message": result["message"],
                    "solve_time": result["solve_time"],
                    "run_id": result.get("run_id"),
                    "error": None,
                    "phase": "done",
                    "phase_message": result["message"],
                    "diagnostics": None,
                    "has_best_attempt": False,
                })
            elif result["status"] == "infeasible":
                _solver_state.update({
                    "status": "infeasible",
                    "message": result["message"],
                    "solve_time": result["solve_time"],
                    "run_id": result.get("run_id"),
                    "error": result["message"],
                    "phase": "done",
                    "phase_message": result["message"],
                    "diagnostics": result.get("diagnostics"),
                    "has_best_attempt": result.get("sections") is not None and len(result.get("sections", [])) > 0,
                })
            else:
                _solver_state.update({
                    "status": "error",
                    "message": result["message"],
                    "solve_time": result["solve_time"],
                    "run_id": result.get("run_id"),
                    "error": result["message"],
                    "phase": "done",
                    "phase_message": result["message"],
                    "diagnostics": None,
                    "has_best_attempt": False,
                })

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "running", "message": "Solver started"}


@app.get("/api/solver/status")
def solver_status():
    with _solver_lock:
        return dict(_solver_state)


@app.post("/api/solver/reset")
def reset_solver():
    with _solver_lock:
        _solver_state.update({
            "status": "idle",
            "message": "",
            "solve_time": None,
            "error": None,
            "run_id": None,
            "phase": None,
            "phase_message": None,
            "diagnostics": None,
            "has_best_attempt": False,
        })
    return {"ok": True}
