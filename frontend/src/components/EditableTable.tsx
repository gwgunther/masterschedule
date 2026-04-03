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
  /** Column to visually group rows by (adds separator between groups) */
  groupByColumn?: string;
  /** Export callback for CSV download */
  onExport?: () => void;
  /** Columns that can be sorted by clicking the header */
  sortableColumns?: string[];
  /** Columns that should flex to fill remaining space */
  flexColumns?: string[];
}

function getNum(row: Record<string, unknown>, col: string): number {
  const v = row[col];
  if (v == null || v === "") return 0;
  return Number(v) || 0;
}

export default function EditableTable({
  table, columns, columnRefs = {}, computedColumns = [],
  searchable = false, refColumns = [], narrowColumns = [],
  columnLabels = {}, groupByColumn, onExport, sortableColumns = [], flexColumns = [],
}: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [lockMap, setLockMap] = useState<Map<string, { course_id: string; num_sections: number }[]>>(new Map());
  // course_id → { display, code } for department labels
  const [courseDeptMap, setCourseDeptMap] = useState<Map<string, { display: string; code: string }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const computedSet = new Set(computedColumns);
  const narrowSet = new Set(narrowColumns);
  const refSet = new Set(refColumns);
  const flexSet = new Set(flexColumns);
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
      if (table === "teachers") {
        const [lockRows, courseRows, deptRows] = await Promise.all([
          fetchTable("teacher_section_locks"),
          fetchTable("courses"),
          fetchTable("departments"),
        ]);
        const lm = new Map<string, { course_id: string; num_sections: number }[]>();
        for (const r of lockRows as { teacher_id: string; course_id: string; num_sections: string }[]) {
          if (!lm.has(r.teacher_id)) lm.set(r.teacher_id, []);
          lm.get(r.teacher_id)!.push({ course_id: r.course_id, num_sections: Number(r.num_sections) || 0 });
        }
        setLockMap(lm);
        // Build course→department map
        const cdMap = new Map<string, { display: string; code: string }>();
        const deptDisplayMap = new Map<string, string>();
        for (const d of deptRows as { department_code: string; display_name: string }[]) {
          deptDisplayMap.set(d.department_code, d.display_name);
        }
        for (const c of courseRows as { course_id: string; department?: string }[]) {
          if (c.department) cdMap.set(c.course_id, { display: deptDisplayMap.get(c.department) || c.department, code: c.department });
        }
        setCourseDeptMap(cdMap);
        // Compute max_sections and department from section quotas
        for (const row of data) {
          const tid = String(row.teacher_id ?? "");
          const locks = lm.get(tid) ?? [];
          row.max_sections = locks.reduce((sum, l) => sum + l.num_sections, 0);
          // Store as JSON array of {display, code} for tag rendering
          const deptSet = new Map<string, string>();
          for (const l of locks) {
            const d = cdMap.get(l.course_id);
            if (d && !deptSet.has(d.code)) deptSet.set(d.code, d.display);
          }
          row._deptTags = JSON.stringify([...deptSet.entries()].map(([code, display]) => ({ code, display })));
        }
      }
      // Load course→department map for tables with course ref columns
      if (table !== "teachers" && refSet.has("course_id")) {
        const [courseRows, deptRows] = await Promise.all([
          fetchTable("courses"),
          fetchTable("departments"),
        ]);
        const deptDisplayMap = new Map<string, string>();
        for (const d of deptRows as { department_code: string; display_name: string }[]) {
          deptDisplayMap.set(d.department_code, d.display_name);
        }
        const cdMap = new Map<string, { display: string; code: string }>();
        for (const c of courseRows as { course_id: string; department?: string }[]) {
          if (c.department) cdMap.set(c.course_id, { display: deptDisplayMap.get(c.department) || c.department, code: c.department });
        }
        setCourseDeptMap(cdMap);
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
    // Read-only computed columns (not "status" which has its own rich render below)
    if (computedSet.has(col) && col !== "status" && col !== "assigned_to" && col !== "source" && !(col === "department" && table === "teachers")) {
      const val = row[col];
      const display = val != null && val !== "" ? String(val) : "—";
      return <span style={{ color: "#888", fontSize: 12, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>{display}</span>;
    }

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

    // Assigned-to column — read-only tags from section quotas
    if (col === "assigned_to") {
      const key = String(table === "teachers" ? row.teacher_id : row.course_id ?? "");
      const locks = lockMap.get(key) ?? [];
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "2px 0" }}>
          {locks.map(({ course_id, num_sections }) => (
            <span key={course_id} style={{
              fontSize: 10, fontFamily: "'Helvetica Neue', Arial, sans-serif",
              background: "#f0eee8", color: "#555", borderRadius: 4,
              padding: "1px 6px", whiteSpace: "nowrap",
            }}>
              {course_id}
              <span style={{ color: "#999", marginLeft: 2 }}>({num_sections})</span>
            </span>
          ))}
        </div>
      );
    }

    // Teacher department column — read-only colored tags
    if (col === "department" && table === "teachers") {
      const tagsJson = row._deptTags as string | undefined;
      if (!tagsJson) return null;
      const tags = JSON.parse(tagsJson) as { code: string; display: string }[];
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "2px 0" }}>
          {tags.map(d => (
            <span key={d.code} className={`dept-tag dept-tag-${d.code}`} style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10 }}>
              {d.display}
            </span>
          ))}
        </div>
      );
    }

    // Source column — read-only badge (only highlight grid-locked rows)
    if (col === "source") {
      const val = row[col] != null ? String(row[col]) : "";
      if (val === "grid") {
        return (
          <span style={{
            fontSize: 9, fontFamily: "'Helvetica Neue', Arial, sans-serif", fontWeight: 600,
            letterSpacing: "0.04em", textTransform: "uppercase",
            background: "#eff6ff", color: "#1d4ed8",
            borderRadius: 3, padding: "1px 5px", whiteSpace: "nowrap",
          }}>grid</span>
        );
      }
      return null;
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
        const deptInfo = col === "course_id" ? courseDeptMap.get(currentVal) : undefined;
        return (
          <div className="ref-select-wrap">
            <div className="ref-select-display">
              {selectedOpt ? (
                <>
                  <span className="ref-select-name">{selectedOpt.label}</span>
                  <span className="id-pill">{currentVal}</span>
                  {deptInfo && <span className={`dept-tag dept-tag-${deptInfo.code}`} style={{ marginLeft: 2 }}>{deptInfo.display}</span>}
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
          className="conflict-rule-select"
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
    if (flexSet.has(col)) {
      const base: React.CSSProperties = { width: `${Math.floor(100 / flexColumns.length)}%`, whiteSpace: "nowrap" };
      if (col === "notes") base.background = "#f9f8f5";
      return base;
    }
    if (col === "notes") return { background: "#f9f8f5", width: "100%" };
    if (refSet.has(col)) return { whiteSpace: "nowrap" };
    // Allow narrow/computed column headers to wrap so they don't drive column width
    if (narrowSet.has(col) || computedSet.has(col)) return { whiteSpace: "normal", textAlign: "center", maxWidth: 64 };
    return { whiteSpace: "nowrap" };
  }

  function tdStyle(col: string): React.CSSProperties {
    if (flexSet.has(col)) return col === "notes" ? { background: "#f9f8f5", verticalAlign: "top" } : {};
    if (col === "notes") return { background: "#f9f8f5", verticalAlign: "top" };
    if (refSet.has(col)) return { whiteSpace: "nowrap" };
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
                {columns.map(col => {
                  const sortable = sortableColumns.includes(col);
                  return (
                    <th
                      key={col}
                      style={{
                        ...thStyle(col),
                        cursor: sortable ? "pointer" : undefined,
                        userSelect: sortable ? "none" : undefined,
                      }}
                      onClick={sortable ? () => {
                        if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
                        else { setSortCol(col); setSortDir("asc"); }
                      } : undefined}
                    >
                      {columnLabels[col] || col.replace(/_/g, " ")}
                      {sortable && (sortCol === col
                        ? (sortDir === "asc" ? " ↑" : " ↓")
                        : <span style={{ color: "#ccc", marginLeft: 3 }}>⇅</span>
                      )}
                    </th>
                  );
                })}
                {!columns.includes("notes") && flexColumns.length === 0 && <th style={{ width: "100%" }} />}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {(() => {
                const filtered = rows
                  .map((row, rIdx) => ({ row, rIdx }))
                  .filter(({ row }) => {
                    if (!search.trim()) return true;
                    const q = search.toLowerCase();
                    // Match raw values (IDs, numbers, text)
                    if (Object.values(row).some(v => String(v ?? "").toLowerCase().includes(q))) return true;
                    // Also match resolved display labels (e.g. "Health/Comp Sci" for course ID HE9898)
                    return columns.some(col => {
                      const val = String(row[col] ?? "");
                      const opts = columnRefs[col];
                      if (!opts) return false;
                      const opt = opts.find(o => o.value === val);
                      return opt ? opt.label.toLowerCase().includes(q) : false;
                    });
                  })
                  .sort((a, b) => {
                    // User-selected sort column takes priority
                    if (sortCol) {
                      const va = String(a.row[sortCol] ?? "").toLowerCase();
                      const vb = String(b.row[sortCol] ?? "").toLowerCase();
                      // Resolve display labels for ref columns
                      const opts = columnRefs[sortCol];
                      const la = opts ? (opts.find(o => o.value === va)?.label ?? va).toLowerCase() : va;
                      const lb = opts ? (opts.find(o => o.value === vb)?.label ?? vb).toLowerCase() : vb;
                      const cmp = la.localeCompare(lb);
                      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
                    }
                    if (!groupByColumn) return 0;
                    const ga = String(a.row[groupByColumn] ?? "").toLowerCase();
                    const gb = String(b.row[groupByColumn] ?? "").toLowerCase();
                    return ga < gb ? -1 : ga > gb ? 1 : 0;
                  });
                let lastGroupVal: string | null = null;
                return filtered.map(({ row, rIdx }, displayIdx) => {
                  const elements: React.ReactNode[] = [];
                  if (groupByColumn) {
                    const groupVal = String(row[groupByColumn] ?? "");
                    if (displayIdx > 0 && groupVal !== lastGroupVal) {
                      elements.push(
                        <tr key={`sep-${rIdx}`} className="group-separator">
                          <td colSpan={columns.length + 1} />
                        </tr>
                      );
                    }
                    lastGroupVal = groupVal;
                  }
                  const isGridFixed = String(row["source"] ?? "") === "grid";
                  elements.push(
                    <tr key={rIdx} style={isGridFixed ? { background: "#eef4ff" } : undefined}>
                      {columns.map(col => (
                        <td key={col} style={tdStyle(col)}>
                          {renderCell(row, rIdx, col)}
                        </td>
                      ))}
                      {!columns.includes("notes") && flexColumns.length === 0 && <td />}
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
                  );
                  return elements;
                });
              })()}
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
