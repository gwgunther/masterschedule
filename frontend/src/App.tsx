import { useEffect, useState, useCallback } from "react";
import DataPage from "./pages/DataPage";
import SchedulePage from "./pages/SchedulePage";
import ManagePage from "./pages/ManagePage";
import ProjectScenarioSelector from "./components/ProjectScenarioSelector";
import { SolverSidebarControls, useSolver } from "./components/SolverPanel";
import { downloadAllCsv, fetchContext, type ActiveContext, type DiagnosticGroup } from "./api";
import type { TableName } from "./api";

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

/* ── Sidebar table definitions ──────────────────────────────────── */

const SETUP_TABLES: { name: TableName; label: string }[] = [
  { name: "courses", label: "Courses" },
  { name: "teachers", label: "Teachers" },
  { name: "teacher_section_locks", label: "Section Quotas" },
  { name: "fixed_assignments", label: "Fixed Assignments" },
  { name: "coteaching_combinations", label: "Co-Teaching" },
  { name: "semester_pairs", label: "Semester Pairs" },
  { name: "course_conflicts", label: "Course Conflicts" },
];

type ScheduleTab = "schedule" | "list" | "diagnostics" | "validation";

type ActiveView =
  | { mode: "setup"; table: TableName }
  | { mode: "schedule"; tab: ScheduleTab }
  | { mode: "manage" };

export default function App() {
  const [view, setView] = useState<ActiveView>({ mode: "setup", table: "courses" });
  const [context, setContext] = useState<ActiveContext>({ project: null, scenario: null });
  const [contextKey, setContextKey] = useState(0);

  /* Solver state lifted to App so sidebar can show controls */
  const [scheduleVersion, setScheduleVersion] = useState(0);
  const [diagnostics, setDiagnostics] = useState<DiagnosticGroup[] | null>(null);
  const [hasBestAttempt, setHasBestAttempt] = useState(false);

  const handleSolverDone = useCallback(() => {
    setScheduleVersion(v => v + 1);
    setDiagnostics(null);
    setHasBestAttempt(false);
    setView({ mode: "schedule", tab: "schedule" });
  }, []);

  const handleInfeasible = useCallback((status: { diagnostics?: DiagnosticGroup[] | null; has_best_attempt?: boolean }) => {
    setDiagnostics(status.diagnostics ?? null);
    setHasBestAttempt(status.has_best_attempt ?? false);
    setView({ mode: "schedule", tab: "diagnostics" });
    if (status.has_best_attempt) {
      setScheduleVersion(v => v + 1);
    }
  }, []);

  const { status: solverStatus, run: runSolver, reset: resetSolver } = useSolver({
    onDone: handleSolverDone,
    onInfeasible: handleInfeasible,
  });

  useEffect(() => {
    fetchContext().then(setContext);
  }, []);

  const handleContextChange = (ctx: ActiveContext) => {
    setContext(ctx);
    setContextKey(k => k + 1);
  };

  const isManage = view.mode === "manage";
  const activeTable = view.mode === "setup" ? view.table : null;
  const activeScheduleTab = view.mode === "schedule" ? view.tab : null;

  const hasDiagnostics = diagnostics && diagnostics.length > 0;
  const violationCount = diagnostics?.reduce((s, d) => s + d.violation_count, 0) ?? 0;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div className="app-title">Master Schedule</div>
          <div className="header-divider" />
          <ProjectScenarioSelector context={context} onContextChange={handleContextChange} />
        </div>

        <button
          className="header-icon-btn"
          onClick={() => downloadAllCsv(context)}
          title="Export all tables as CSV (ZIP)"
        >
          <DownloadIcon />
        </button>
      </header>

      {/* ── Body: sidebar + content ────────────────────────── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Sidebar (always visible) */}
        <nav className="sidebar-nav">
            {/* SETUP section */}
            <div className="sidebar-section">
              <div className="sidebar-section-label">Setup</div>
              {SETUP_TABLES.map(t => (
                <button
                  key={t.name}
                  className={`sidebar-nav-item${activeTable === t.name ? " active" : ""}`}
                  onClick={() => setView({ mode: "setup", table: t.name })}
                >
                  {t.label}
                </button>
              ))}
              <div className="sidebar-ref-label">Reference</div>
              <button
                className={`sidebar-nav-item${activeTable === "departments" ? " active" : ""}`}
                onClick={() => setView({ mode: "setup", table: "departments" })}
              >
                Departments
              </button>
            </div>

            {/* RESULTS section */}
            <div className="sidebar-section">
              <div className="sidebar-section-label">Results</div>
              <button
                className={`sidebar-nav-item${activeScheduleTab === "schedule" ? " active" : ""}`}
                onClick={() => setView({ mode: "schedule", tab: "schedule" })}
              >
                Schedule Grid
              </button>
              <button
                className={`sidebar-nav-item${activeScheduleTab === "list" ? " active" : ""}`}
                onClick={() => setView({ mode: "schedule", tab: "list" })}
              >
                Schedule List
              </button>
              {hasDiagnostics && (
                <button
                  className={`sidebar-nav-item${activeScheduleTab === "diagnostics" ? " active" : ""}`}
                  onClick={() => setView({ mode: "schedule", tab: "diagnostics" })}
                >
                  Constraints
                  {violationCount > 0 && <span className="sidebar-badge badge-error">{violationCount}</span>}
                </button>
              )}
              <button
                className={`sidebar-nav-item${activeScheduleTab === "validation" ? " active" : ""}`}
                onClick={() => setView({ mode: "schedule", tab: "validation" })}
              >
                Validation
              </button>
              <div className="sidebar-solver-area">
                <SolverSidebarControls status={solverStatus} onRun={runSolver} onReset={resetSolver} />
              </div>
            </div>

            {/* MANAGE link */}
            <div className="sidebar-manage">
              <button
                className={`sidebar-manage-btn${isManage ? " active" : ""}`}
                onClick={() => setView({ mode: "manage" })}
              >
                <GearIcon />
                Projects & Scenarios
              </button>
            </div>
          </nav>

        {/* Content area */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {view.mode === "setup" && (
            <DataPage key={`data-${contextKey}`} activeTable={view.table} />
          )}
          {view.mode === "schedule" && (
            <SchedulePage
              key={`schedule-${contextKey}`}
              activeTab={view.tab}
              scheduleVersion={scheduleVersion}
              diagnostics={diagnostics}
              hasBestAttempt={hasBestAttempt}
            />
          )}
          {view.mode === "manage" && (
            <ManagePage context={context} onContextChange={handleContextChange} />
          )}
        </div>
      </div>
    </div>
  );
}
