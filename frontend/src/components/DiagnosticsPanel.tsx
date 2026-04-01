import { useState } from "react";
import type { DiagnosticGroup } from "../api";

interface Props {
  diagnostics: DiagnosticGroup[];
  hasBestAttempt: boolean;
  onShowBestAttempt?: () => void;
}

export default function DiagnosticsPanel({ diagnostics, hasBestAttempt, onShowBestAttempt }: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const groupsWithViolations = diagnostics.filter(d => d.violation_count > 0);
  const groupsOk = diagnostics.filter(d => d.violation_count === 0);
  const totalViolations = groupsWithViolations.reduce((sum, d) => sum + d.violation_count, 0);
  const totalSlack = groupsWithViolations.reduce((sum, d) => sum + d.total_slack, 0);
  const maxSlack = Math.max(...groupsWithViolations.map(d => d.total_slack), 1);

  return (
    <div className="diagnostics-panel">
      <div className="diagnostics-header">
        <div className="diagnostics-title-row">
          <span className="diagnostics-title">Constraint Analysis</span>
          <span className="diagnostics-summary">
            {totalViolations} violation{totalViolations !== 1 ? "s" : ""} across {groupsWithViolations.length} group{groupsWithViolations.length !== 1 ? "s" : ""}
          </span>
        </div>
        {hasBestAttempt && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 10px" }} onClick={onShowBestAttempt}>
            Show Best Attempt
          </button>
        )}
      </div>

      <div className="diagnostics-groups">
        {groupsWithViolations.map((group, idx) => {
          const isExpanded = expandedGroups.has(group.group);
          const pct = Math.round((group.total_slack / totalSlack) * 100);
          const barWidth = Math.round((group.total_slack / maxSlack) * 100);

          return (
            <div key={group.group} className="diagnostics-group">
              <button
                className="diagnostics-group-toggle"
                onClick={() => setExpandedGroups(prev => {
                  const next = new Set(prev);
                  isExpanded ? next.delete(group.group) : next.add(group.group);
                  return next;
                })}
              >
                <span className="diagnostics-rank">#{idx + 1}</span>
                <span className="diagnostics-severity-dot severity-error" />
                <span className="diagnostics-group-label">
                  {group.label}
                  {group.source_table && group.source_table !== group.label && (
                    <span style={{ fontWeight: 400, color: "#aaa", fontSize: 10, marginLeft: 6 }}>
                      → {group.source_table}
                    </span>
                  )}
                </span>
                <span className="diagnostics-impact-bar-wrap">
                  <span className="diagnostics-impact-bar" style={{ width: `${barWidth}%` }} />
                </span>
                <span className="diagnostics-impact-pct">{pct}%</span>
                <span className="diagnostics-group-count">{group.violation_count}</span>
                <span className="diagnostics-chevron">{isExpanded ? "\u25B4" : "\u25BE"}</span>
              </button>

              {isExpanded && (
                <div className="diagnostics-violations">
                  {group.violations.map((v, i) => (
                    <div key={i} className="diagnostics-violation">
                      <div className="diagnostics-violation-msg">{v.message}</div>
                      {v.context && (
                        <div className="diagnostics-violation-context">{v.context}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {groupsOk.length > 0 && (
          <div className="diagnostics-ok-groups">
            {groupsOk.map(group => (
              <div key={group.group} className="diagnostics-group-ok">
                <span className="diagnostics-severity-dot severity-ok" />
                <span className="diagnostics-group-label">
                  {group.label}
                  {group.source_table && group.source_table !== group.label && (
                    <span style={{ fontWeight: 400, color: "#bbb", fontSize: 10, marginLeft: 6 }}>→ {group.source_table}</span>
                  )}
                </span>
                <span className="diagnostics-group-ok-text">OK</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
