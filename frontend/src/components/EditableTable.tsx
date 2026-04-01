import { useState, useCallback } from "react";
import { fetchTable, saveTable } from "../api";
import type { TableName } from "../api";
import type { RefOption, ColumnRefs } from "../pages/DataPage";

function DownloadIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}

interface Props {
  table: TableName;
  columns: string[];
  columnRefs?: ColumnRefs;
  label?: string;
  computedColumns?: string[];
  searchable?: boolean;
  /** Columns using teacher/course refs — rendered with name + ID pill overlay */
  refColumns?: string[];
  /** Columns that should shrink to content width (numeric/short values) */
  narrowColumns?: string[];
  /** Override display labels for column headers */
  columnLabels?: Record<string, string>;
  /** Export callback for CSV download */
  onExport?: () => void;
}

function getNum(row: Record<string, unknown>, col: string): number {
  const v = row[col];
  if (v == null || v === "") return 0;
  return Number(v) || 0;
}

export default function EditableTable({
  table, columns, columnRefs = {}, computedColumns = [],
  searchable = false, refColumns = [], narrowColumns = [],
  columnLabels = {}, onExport,
}: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const computedSet = new Set(computedColumns);
  const narrowSet = new Set(narrowColumns);
  const refSet = new Set(refColumns);
  const savableColumns = columns.filter(c => !computedSet.has(c));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTable(table);
      if (table === "courses") {
        for (const row of data) {
          if (!row.max_class_size && row.max_class_size !== 0) {
            const enrollment = getNum(row, "total_enrollment");
            const sections = getNum(row, "num_sections");
            if (enrollment > 0 && sections > 0) {
              row.max_class_size = String(Math.ceil(enrollment / sections));
            }
          }
        }
      }
      setRows(data);
      setDirty(false);
    } catch (e: unknown) {
      showToast("err", String(e));
    } finally {
      setLoading(false);
    }
  }, [table]);

  useState(() => { load(); });

  function showToast(type: "ok" | "err", msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  function handleCellChange(rowIdx: number, col: string, value: string) {
    setRows(prev => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [col]: value };
      return next;
    });
    setDirty(true);
  }

  function addRow() {
    const empty = Object.fromEntries(savableColumns.map(c => [c, ""]));
    setRows(prev => [...prev, empty]);
    setDirty(true);
  }

  function deleteRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx));
    setDirty(true);
    setConfirmDelete(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const cleanRows = rows.map(row => {
        const clean: Record<string, unknown> = {};
        for (const col of savableColumns) clean[col] = row[col];
        return clean;
      });
      await saveTable(table, cleanRows);
      setDirty(false);
      showToast("ok", "Saved");
    } catch (e: unknown) {
      showToast("err", String(e));
    } finally {
      setSaving(false);
    }
  }

  function renderCell(row: Record<string, unknown>, rIdx: number, col: string) {
    // Computed status column
    if (col === "status") {
      const enrollment = getNum(row, "total_enrollment");
      const sections = getNum(row, "num_sections");
      const maxSize = getNum(row, "max_class_size");
      if (enrollment <= 0 || sections <= 0) {
        return <span style={{ color: "#ccc", fontSize: 11 }}>—</span>;
      }
      if (maxSize <= 0) {
        return (
          <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 10, fontWeight: 400, color: "#aaa" }}>
            {parseFloat((enrollment / sections).toFixed(2))}/section
          </span>
        );
      }
      const capacity = sections * maxSize;
      const diff = enrollment - capacity;
      const color = diff > 0 ? "#b91c1c" : diff < 0 ? "#166534" : "#aaa";
      const avgSize = parseFloat((enrollment / sections).toFixed(2));
      return (
        <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.3 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color, whiteSpace: "nowrap" }}>
            {enrollment}/{capacity}{diff !== 0 && <span style={{ fontSize: 10, fontWeight: 400 }}> ({diff > 0 ? "+" : ""}{diff})</span>}
          </span>
          <span style={{ fontSize: 10, fontWeight: 400, color: "#aaa", whiteSpace: "nowrap" }}>
            {avgSize}/section
          </span>
        </span>
      );
    }

    // Notes column — textarea that wraps
    if (col === "notes") {
      const currentVal = row[col] != null ? String(row[col]) : "";
      return (
        <textarea
          className="notes-textarea"
          value={currentVal}
          onChange={e => handleCellChange(rIdx, col, e.target.value)}
          rows={2}
        />
      );
    }

    const options = columnRefs[col];
    const currentVal = row[col] != null ? String(row[col]) : "";
    const isRefCol = refSet.has(col);
    const isNarrow = narrowSet.has(col);

    if (options && options.length > 0) {
      // Ref column (teacher/course): overlay pattern — name prominent, ID as pill
      if (isRefCol) {
        const selectedOpt = options.find(o => o.value === currentVal);
        return (
          <div className="ref-select-wrap">
            <div className="ref-select-display">
              {selectedOpt ? (
                <>
                  <span className="ref-select-name">{selectedOpt.label}</span>
                  <span className="id-pill">{currentVal}</span>
                </>
              ) : currentVal ? (
                <>
                  <span className="ref-select-name">{currentVal}</span>
                </>
              ) : (
                <span className="ref-select-empty">—</span>
              )}
              <span className="ref-select-arrow">▾</span>
            </div>
            <select
              className="ref-select-native"
              value={currentVal}
              onChange={e => handleCellChange(rIdx, col, e.target.value)}
            >
              <option value="">—</option>
              {options.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}{opt.value !== opt.label ? ` (${opt.value})` : ""}
                </option>
              ))}
            </select>
          </div>
        );
      }

      // Plain options (section counts, periods, etc.)
      return (
        <select
          className={isNarrow ? "cell-input-narrow" : "cell-input"}
          value={currentVal}
          onChange={e => handleCellChange(rIdx, col, e.target.value)}
        >
          <option value="">—</option>
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );
    }

    // Auto-size text inputs to content width (non-narrow columns)
    return (
      <input
        className={isNarrow ? "cell-input-narrow" : "cell-input"}
        value={currentVal}
        onChange={e => handleCellChange(rIdx, col, e.target.value)}
        style={!isNarrow ? { minWidth: `${Math.max(currentVal.length + 2, 8)}ch` } : undefined}
      />
    );
  }

  function thStyle(col: string): React.CSSProperties {
    if (col === "notes") return { background: "#f9f8f5", minWidth: 120 };
    // Allow narrow/computed column headers to wrap so they don't drive column width
    if (narrowSet.has(col) || computedSet.has(col)) return { whiteSpace: "normal", textAlign: "center", maxWidth: 64 };
    return {};
  }

  function tdStyle(col: string): React.CSSProperties {
    if (col === "notes") return { background: "#f9f8f5", minWidth: 120, verticalAlign: "top" };
    if (narrowSet.has(col) || computedSet.has(col)) return { whiteSpace: "nowrap" };
    return { whiteSpace: "nowrap" };
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 14 }}>
        <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 11, color: "#aaa" }}>
          {rows.length} rows
        </span>
        <div style={{ flex: 1 }} />
        {searchable && (
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              border: "1px solid #e0e0e0",
              borderRadius: 6,
              outline: "none",
              width: 180,
              fontFamily: "'Helvetica Neue', Arial, sans-serif",
              color: "#1a1a1a",
              background: search ? "#fffbe6" : "#fff",
            }}
          />
        )}
        {toast && <span className={`toast toast-${toast.type}`}>{toast.msg}</span>}
        {onExport && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px", display: "flex", alignItems: "center", gap: 4 }} onClick={onExport} title="Export as CSV">
            <DownloadIcon /> Export CSV
          </button>
        )}
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={load}>
          Reload
        </button>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={addRow}>
          + Add Row
        </button>
        <button
          className={`btn${dirty ? " btn-primary" : " btn-ghost"}`}
          style={{ fontSize: 11, padding: "5px 12px" }}
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 12 }}>
          Loading…
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col} style={thStyle(col)}>
                    {columnLabels[col] || col.replace(/_/g, " ")}
                  </th>
                ))}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {rows
                .map((row, rIdx) => ({ row, rIdx }))
                .filter(({ row }) => {
                  if (!search.trim()) return true;
                  const q = search.toLowerCase();
                  return Object.values(row).some(v => String(v ?? "").toLowerCase().includes(q));
                })
                .map(({ row, rIdx }) => (
                <tr key={rIdx}>
                  {columns.map(col => (
                    <td key={col} style={tdStyle(col)}>
                      {renderCell(row, rIdx, col)}
                    </td>
                  ))}
                  <td style={{ width: 40, padding: "0 4px", position: "relative" }}>
                    {confirmDelete === rIdx ? (
                      <div className="delete-confirm">
                        <button className="delete-confirm-yes" onClick={() => deleteRow(rIdx)}>Delete</button>
                        <button className="delete-confirm-no" onClick={() => setConfirmDelete(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="row-action-btn" onClick={() => setConfirmDelete(rIdx)} title="Row actions">
                        ⋯
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 1} style={{ textAlign: "center", padding: "32px 14px", fontStyle: "italic", color: "#aaa", fontSize: 13 }}>
                    No rows — click "+ Add Row" to begin
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
