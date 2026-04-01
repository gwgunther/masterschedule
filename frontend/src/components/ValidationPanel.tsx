import { useState, useEffect } from "react";
import { fetchValidation } from "../api";
import type { ValidationResult } from "../api";

interface Props {
  fullPage?: boolean;
}

export default function ValidationPanel({ fullPage = false }: Props) {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try { setResult(await fetchValidation()); }
    finally { setLoading(false); }
  }

  // Auto-run when in full page mode
  useEffect(() => {
    if (fullPage && !result) run();
  }, [fullPage]);

  const allIssues = result ? [...result.data_issues, ...result.schedule_issues] : [];
  const errors   = allIssues.filter(i => i.level === "error");
  const warnings = allIssues.filter(i => i.level === "warning");

  return (
    <div className="validation-fullpage">
      <div className="validation-header">
        <span className="diagnostics-title">Validation</span>

        {result && errors.length > 0 && (
          <span className="validation-chip chip-error">{errors.length} error{errors.length !== 1 ? "s" : ""}</span>
        )}
        {result && warnings.length > 0 && (
          <span className="validation-chip chip-warning">{warnings.length} warning{warnings.length !== 1 ? "s" : ""}</span>
        )}
        {result && errors.length === 0 && warnings.length === 0 && (
          <span className="validation-chip chip-ok">All clear</span>
        )}

        <div style={{ flex: 1 }} />

        <button
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: "4px 10px" }}
          onClick={run}
          disabled={loading}
        >
          {loading ? "Checking…" : "Run Checks"}
        </button>
      </div>

      {!result && !loading && (
        <div style={{ padding: "40px", textAlign: "center", color: "#aaa", fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 12 }}>
          Click "Run Checks" to validate data and schedule
        </div>
      )}

      {loading && (
        <div style={{ padding: "40px", textAlign: "center", color: "#aaa", fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 12 }}>
          Checking…
        </div>
      )}

      {result && allIssues.length > 0 && (
        <div className="validation-issues-full">
          {errors.map((iss, i) => (
            <div key={`e${i}`} className="validation-issue">
              <span className="issue-tag tag-error">Error</span>
              <span>{iss.message}</span>
            </div>
          ))}
          {warnings.map((iss, i) => (
            <div key={`w${i}`} className="validation-issue">
              <span className="issue-tag tag-warning">Warning</span>
              <span>{iss.message}</span>
            </div>
          ))}
        </div>
      )}

      {result && allIssues.length === 0 && (
        <div style={{ padding: "40px", textAlign: "center", fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 13, color: "#166534" }}>
          No issues found — data and schedule look good.
        </div>
      )}
    </div>
  );
}
