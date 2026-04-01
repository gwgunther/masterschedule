import type { SolverStatus } from "../api";
import { useState, useEffect, useRef } from "react";
import { startSolver, fetchSolverStatus, resetSolver } from "../api";

const IDLE_STATUS: SolverStatus = {
  status: "idle", message: "", solve_time: null, error: null,
  run_id: null, phase: null, phase_message: null,
  diagnostics: null, has_best_attempt: false,
};

interface UseSolverOptions {
  onDone?: () => void;
  onInfeasible?: (status: SolverStatus) => void;
}

export function useSolver({ onDone, onInfeasible }: UseSolverOptions) {
  const [status, setStatus] = useState<SolverStatus>(IDLE_STATUS);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function refreshStatus() {
    try {
      const s = await fetchSolverStatus();
      setStatus(s);
      if (s.status === "done" || s.status === "error" || s.status === "infeasible") {
        stopPoll();
        if (s.status === "done") onDone?.();
        if (s.status === "infeasible") onInfeasible?.(s);
      }
    } catch {
      stopPoll();
    }
  }

  useEffect(() => {
    fetchSolverStatus().then(s => {
      setStatus(s);
      if (s.status === "done") onDone?.();
      if (s.status === "infeasible") onInfeasible?.(s);
    }).catch(() => {});
    return stopPoll;
  }, []);

  async function run() {
    try {
      await startSolver();
      setStatus({ ...IDLE_STATUS, status: "running", message: "Starting...", phase: "starting", phase_message: "Starting..." });
      pollRef.current = setInterval(refreshStatus, 1000);
    } catch (e: unknown) {
      setStatus(prev => ({ ...prev, status: "error", message: String(e) }));
    }
  }

  async function reset() {
    stopPoll();
    await resetSolver();
    setStatus(IDLE_STATUS);
  }

  return { status, run, reset };
}

// ── Inline solver controls rendered inside the tab bar ───────────────────────
interface SolverControlsProps {
  status: SolverStatus;
  onRun: () => void;
  onReset: () => void;
}

export function SolverControls({ status, onRun, onReset }: SolverControlsProps) {
  const isRunning = status.status === "running";
  const isDone = status.status === "done" || status.status === "error" || status.status === "infeasible";

  return (
    <div className="solver-controls">
      {/* Status line */}
      <div className="solver-status-line">
        <SolverStatusText status={status} />
        {status.solve_time != null && (
          <span className="solver-time">{status.solve_time}s</span>
        )}
      </div>

      {/* Buttons */}
      <div className="solver-buttons">
        {isDone && (
          <button onClick={onReset} className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 10px" }}>
            Reset
          </button>
        )}
        <button
          className={`btn${isRunning ? "" : " btn-primary"}`}
          style={{ fontSize: 11, padding: "4px 14px", display: "flex", alignItems: "center", gap: 5 }}
          onClick={onRun}
          disabled={isRunning}
        >
          {isRunning ? <><SpinIcon /> Solving…</> : "Run Solver"}
        </button>
      </div>
    </div>
  );
}

function SolverStatusText({ status }: { status: SolverStatus }) {
  if (status.status === "idle") return <span className="solver-status idle">Ready</span>;
  if (status.status === "running") return <span className="solver-phase">{status.phase_message || "Running..."}</span>;
  if (status.status === "done") return <span className="solver-status done">{status.message}</span>;
  if (status.status === "infeasible") return <span className="solver-status error">{status.message}</span>;
  return <span className="solver-status error">{status.message}</span>;
}

// ── Compact sidebar solver controls ───────────────────────────────────────────
export function SolverSidebarControls({ status, onRun, onReset }: SolverControlsProps) {
  const isRunning = status.status === "running";
  const isDone = status.status === "done" || status.status === "error" || status.status === "infeasible";

  return (
    <div className="solver-sidebar">
      <button
        className={`solver-sidebar-btn${isRunning ? " running" : ""}`}
        onClick={onRun}
        disabled={isRunning}
      >
        {isRunning ? <><SpinIcon /> Solving…</> : "Run Solver"}
      </button>
      <div className="solver-sidebar-status">
        <SolverStatusText status={status} />
        {status.solve_time != null && (
          <span className="solver-time">{status.solve_time}s</span>
        )}
        {isDone && (
          <button onClick={onReset} className="solver-sidebar-reset">Reset</button>
        )}
      </div>
    </div>
  );
}

function SpinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
