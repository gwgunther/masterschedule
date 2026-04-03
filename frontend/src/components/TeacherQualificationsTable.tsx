import { useState, useCallback, useEffect, useRef } from "react";
import { fetchTable, saveTable } from "../api";

interface Teacher {
  teacher_id: string;
  full_name: string;
  department: string;
  [key: string]: unknown;
}

interface Course {
  course_id: string;
  course_title: string;
}

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
  courseOptions: { value: string; label: string }[];
  deptOptions: { value: string; label: string }[];
  onExport?: () => void;
}

/** Parse comma-separated department string → Set */
function parseDepts(raw: string): Set<string> {
  return new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
}
/** Serialize Set → comma-separated string */
function serializeDepts(s: Set<string>): string {
  return [...s].sort().join(", ");
}

export default function TeacherQualificationsTable({ courseOptions, deptOptions, onExport }: Props) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [qualMap, setQualMap] = useState<Map<string, Set<string>>>(new Map());
  const [assignedMap, setAssignedMap] = useState<Map<string, string[]>>(new Map()); // teacher_id → course_ids
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [search, setSearch] = useState("");
  const [addingQualFor, setAddingQualFor] = useState<string | null>(null);
  const [addingDeptFor, setAddingDeptFor] = useState<string | null>(null);
  const [addSearch, setAddSearch] = useState("");
  const [deptSearch, setDeptSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const deptRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teacherRows, qualRows, courseRows, lockRows] = await Promise.all([
        fetchTable("teachers"),
        fetchTable("teacher_qualifications"),
        fetchTable("courses"),
        fetchTable("teacher_section_locks"),
      ]);
      setTeachers(teacherRows as Teacher[]);
      setCourses(courseRows as Course[]);

      const qmap = new Map<string, Set<string>>();
      for (const t of teacherRows as Teacher[]) qmap.set(t.teacher_id, new Set());
      for (const q of qualRows as { teacher_id: string; course_id: string }[]) {
        if (!qmap.has(q.teacher_id)) qmap.set(q.teacher_id, new Set());
        qmap.get(q.teacher_id)!.add(q.course_id);
      }
      setQualMap(qmap);

      // Assigned to: group locks by teacher, collect unique course_ids (exclude CONFERENCE)
      const amap = new Map<string, string[]>();
      for (const r of lockRows as { teacher_id: string; course_id: string; num_sections?: number }[]) {
        if (r.course_id === "CONFERENCE") continue;
        const tid = r.teacher_id;
        if (!amap.has(tid)) amap.set(tid, []);
        amap.get(tid)!.push(r.course_id);
      }
      setAssignedMap(amap);

      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddingQualFor(null); setAddSearch("");
      }
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) {
        setAddingDeptFor(null); setDeptSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function showToast(type: "ok" | "err", msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  function handleCellChange(teacherId: string, col: string, value: string) {
    setTeachers(prev => prev.map(t => t.teacher_id === teacherId ? { ...t, [col]: value } : t));
    setDirty(true);
  }

  function addDept(teacherId: string, deptValue: string) {
    setTeachers(prev => prev.map(t => {
      if (t.teacher_id !== teacherId) return t;
      const depts = parseDepts(String(t.department ?? ""));
      depts.add(deptValue);
      return { ...t, department: serializeDepts(depts) };
    }));
    setDirty(true);
    setDeptSearch("");
  }

  function removeDept(teacherId: string, deptValue: string) {
    setTeachers(prev => prev.map(t => {
      if (t.teacher_id !== teacherId) return t;
      const depts = parseDepts(String(t.department ?? ""));
      depts.delete(deptValue);
      return { ...t, department: serializeDepts(depts) };
    }));
    setDirty(true);
  }

  function addTeacher() {
    const empty: Teacher = { teacher_id: "", full_name: "", department: "" };
    setTeachers(prev => [...prev, empty]);
    setDirty(true);
  }

  function deleteTeacher(teacherId: string) {
    setTeachers(prev => prev.filter(t => t.teacher_id !== teacherId));
    setQualMap(prev => { const next = new Map(prev); next.delete(teacherId); return next; });
    setDirty(true);
    setConfirmDelete(null);
  }

  function addQual(teacherId: string, courseId: string) {
    setQualMap(prev => {
      const next = new Map(prev);
      const s = new Set(next.get(teacherId) ?? []);
      s.add(courseId);
      next.set(teacherId, s);
      return next;
    });
    setDirty(true);
    setAddSearch("");
  }

  function removeQual(teacherId: string, courseId: string) {
    setQualMap(prev => {
      const next = new Map(prev);
      const s = new Set(next.get(teacherId) ?? []);
      s.delete(courseId);
      next.set(teacherId, s);
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveTable("teachers", teachers);
      const qualRows: { teacher_id: string; course_id: string }[] = [];
      for (const [tid, courseSet] of qualMap.entries()) {
        for (const cid of courseSet) qualRows.push({ teacher_id: tid, course_id: cid });
      }
      await saveTable("teacher_qualifications", qualRows);
      setDirty(false);
      showToast("ok", "Saved");
    } catch (e: unknown) {
      showToast("err", String(e));
    } finally {
      setSaving(false);
    }
  }

  const courseMap = new Map(courses.map(c => [c.course_id, c.course_title]));
  const deptMap = new Map(deptOptions.map(d => [d.value, d.label]));

  const filteredTeachers = teachers.filter(t => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const quals = [...(qualMap.get(t.teacher_id) ?? [])].join(" ").toLowerCase();
    return (
      t.teacher_id.toLowerCase().includes(q) ||
      (t.full_name ?? "").toLowerCase().includes(q) ||
      (t.department ?? "").toLowerCase().includes(q) ||
      quals.includes(q)
    );
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexShrink: 0 }}>
        <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 11, color: "#aaa" }}>
          {teachers.length} teachers
        </span>
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Search teachers or courses…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            fontSize: 11, padding: "4px 10px",
            border: "1px solid #e0e0e0", borderRadius: 6,
            outline: "none", width: 220,
            fontFamily: "'Helvetica Neue', Arial, sans-serif", color: "#1a1a1a",
            background: search ? "#fffbe6" : "#fff",
          }}
        />
        {toast && <span className={`toast toast-${toast.type}`}>{toast.msg}</span>}
        {onExport && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px", display: "flex", alignItems: "center", gap: 4 }} onClick={onExport} title="Export as CSV">
            <DownloadIcon /> Export CSV
          </button>
        )}
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={load}>Reload</button>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={addTeacher}>+ Add Teacher</button>
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
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 12 }}>Loading…</div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="data-table" style={{ tableLayout: "auto", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ whiteSpace: "nowrap", minWidth: 150 }}>teacher id</th>
                <th style={{ whiteSpace: "nowrap", minWidth: 150 }}>full name</th>
                <th style={{ whiteSpace: "nowrap", minWidth: 160 }}>department(s)</th>
                <th>qualified courses</th>
                <th style={{ minWidth: 200 }}>assigned to <span style={{ fontWeight: 400, color: "#bbb", fontSize: 10 }}>(from section quotas)</span></th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {filteredTeachers.map(teacher => {
                const quals = [...(qualMap.get(teacher.teacher_id) ?? [])].sort();
                const depts = parseDepts(String(teacher.department ?? ""));
                const assigned = assignedMap.get(teacher.teacher_id) ?? [];
                const isAddingQual = addingQualFor === teacher.teacher_id;
                const isAddingDept = addingDeptFor === teacher.teacher_id;

                const availableQuals = courseOptions.filter(c =>
                  !quals.includes(c.value) &&
                  (!addSearch.trim() || c.label.toLowerCase().includes(addSearch.toLowerCase()))
                );
                const availableDepts = deptOptions.filter(d =>
                  !depts.has(d.value) &&
                  (!deptSearch.trim() || d.label.toLowerCase().includes(deptSearch.toLowerCase()))
                );

                return (
                  <tr key={teacher.teacher_id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <input className="cell-input" value={teacher.teacher_id}
                        onChange={e => handleCellChange(teacher.teacher_id, "teacher_id", e.target.value)} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <input className="cell-input" value={teacher.full_name ?? ""}
                        onChange={e => handleCellChange(teacher.teacher_id, "full_name", e.target.value)} />
                    </td>

                    {/* Department(s) — multi-select tag UI */}
                    <td style={{ position: "relative" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", padding: "2px 0" }}>
                        {[...depts].sort().map(dv => (
                          <span key={dv} className="qual-tag" title={deptMap.get(dv) ?? dv}>
                            <span className="qual-tag-label">{deptMap.get(dv) ?? dv}</span>
                            <button className="qual-tag-remove" onClick={() => removeDept(teacher.teacher_id, dv)} title="Remove">×</button>
                          </span>
                        ))}
                        <div ref={isAddingDept ? deptRef : undefined} style={{ position: "relative" }}>
                          <button
                            className="qual-add-btn"
                            onClick={() => { setAddingDeptFor(isAddingDept ? null : teacher.teacher_id); setDeptSearch(""); setAddingQualFor(null); }}
                          >+ Add</button>
                          {isAddingDept && (
                            <div className="qual-dropdown">
                              <input
                                autoFocus
                                className="qual-search"
                                placeholder="Search departments…"
                                value={deptSearch}
                                onChange={e => setDeptSearch(e.target.value)}
                              />
                              <div className="qual-dropdown-list">
                                {availableDepts.length === 0 ? (
                                  <div className="qual-dropdown-empty">No more departments</div>
                                ) : (
                                  availableDepts.map(d => (
                                    <button key={d.value} className="qual-dropdown-item" onClick={() => addDept(teacher.teacher_id, d.value)}>
                                      <span className="qual-dropdown-title">{d.label}</span>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Qualifications column */}
                    <td style={{ position: "relative" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", padding: "2px 0" }}>
                        {quals.map(cid => (
                          <span key={cid} className="qual-tag" title={courseMap.get(cid) ?? cid}>
                            <span className="qual-tag-label">{courseMap.get(cid) ?? cid}</span>
                            <button className="qual-tag-remove" onClick={() => removeQual(teacher.teacher_id, cid)} title="Remove">×</button>
                          </span>
                        ))}
                        <div ref={isAddingQual ? addRef : undefined} style={{ position: "relative" }}>
                          <button
                            className="qual-add-btn"
                            onClick={() => { setAddingQualFor(isAddingQual ? null : teacher.teacher_id); setAddSearch(""); setAddingDeptFor(null); }}
                          >+ Add</button>
                          {isAddingQual && (
                            <div className="qual-dropdown">
                              <input
                                autoFocus
                                className="qual-search"
                                placeholder="Search courses…"
                                value={addSearch}
                                onChange={e => setAddSearch(e.target.value)}
                              />
                              <div className="qual-dropdown-list">
                                {availableQuals.length === 0 ? (
                                  <div className="qual-dropdown-empty">No matches</div>
                                ) : (
                                  availableQuals.slice(0, 50).map(c => (
                                    <button key={c.value} className="qual-dropdown-item" onClick={() => addQual(teacher.teacher_id, c.value)}>
                                      <span className="qual-dropdown-id">{c.value}</span>
                                      <span className="qual-dropdown-title">{courseMap.get(c.value) ?? ""}</span>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Assigned to — read-only from section quotas */}
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "2px 0" }}>
                        {assigned.length === 0
                          ? <span style={{ color: "#ccc", fontSize: 11 }}>—</span>
                          : assigned.map(cid => (
                            <span key={cid} className="qual-tag qual-tag-assigned" title={courseMap.get(cid) ?? cid}>
                              <span className="qual-tag-label">{courseMap.get(cid) ?? cid}</span>
                            </span>
                          ))
                        }
                      </div>
                    </td>

                    {/* Delete action */}
                    <td style={{ width: 40, padding: "0 4px", position: "relative" }}>
                      {confirmDelete === teacher.teacher_id ? (
                        <div className="delete-confirm">
                          <button className="delete-confirm-yes" onClick={() => deleteTeacher(teacher.teacher_id)}>Delete</button>
                          <button className="delete-confirm-no" onClick={() => setConfirmDelete(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="row-action-btn" onClick={() => setConfirmDelete(teacher.teacher_id)} title="Row actions">⋯</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
