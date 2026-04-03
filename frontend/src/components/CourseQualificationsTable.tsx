import { useState, useCallback, useEffect, useRef } from "react";
import { fetchTable, saveTable } from "../api";

interface Course {
  course_id: string;
  course_title: string;
  enrollment_7th: string;
  enrollment_8th: string;
  total_enrollment: string;
  num_sections: string;
  max_class_size: string;
  notes: string;
  [key: string]: unknown;
}

interface Teacher {
  teacher_id: string;
  full_name: string;
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
  teacherOptions: { value: string; label: string }[];
  onExport?: () => void;
}

export default function CourseQualificationsTable({ teacherOptions, onExport }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  // courseId → Set<teacherId>
  const [qualMap, setQualMap] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [search, setSearch] = useState("");
  const [addingFor, setAddingFor] = useState<string | null>(null); // course_id
  const [addSearch, setAddSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const addRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [courseRows, teacherRows, qualRows] = await Promise.all([
        fetchTable("courses"),
        fetchTable("teachers"),
        fetchTable("teacher_qualifications"),
      ]);
      setCourses(courseRows as Course[]);
      setTeachers(teacherRows as Teacher[]);

      // Build courseId → Set<teacherId>
      const map = new Map<string, Set<string>>();
      for (const c of courseRows as Course[]) map.set(c.course_id, new Set());
      for (const q of qualRows as { teacher_id: string; course_id: string }[]) {
        if (!map.has(q.course_id)) map.set(q.course_id, new Set());
        map.get(q.course_id)!.add(q.teacher_id);
      }
      setQualMap(map);
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddingFor(null);
        setAddSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function showToast(type: "ok" | "err", msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  function handleCellChange(idx: number, col: string, value: string) {
    setCourses(prev => {
      const next = [...prev];
      const oldId = next[idx].course_id;
      next[idx] = { ...next[idx], [col]: value };
      // If course_id changed, migrate the qualMap key
      if (col === "course_id" && oldId !== value) {
        setQualMap(qm => {
          const nextQm = new Map(qm);
          const existing = nextQm.get(oldId) ?? new Set();
          nextQm.delete(oldId);
          nextQm.set(value, existing);
          return nextQm;
        });
      }
      return next;
    });
    setDirty(true);
  }

  function addCourse() {
    const empty: Course = {
      course_id: "", course_title: "", enrollment_7th: "", enrollment_8th: "",
      total_enrollment: "", num_sections: "", max_class_size: "", notes: "",
    };
    setCourses(prev => [...prev, empty]);
    setDirty(true);
  }

  function deleteCourse(idx: number) {
    setCourses(prev => {
      const courseId = prev[idx].course_id;
      setQualMap(qm => { const next = new Map(qm); next.delete(courseId); return next; });
      return prev.filter((_, i) => i !== idx);
    });
    setDirty(true);
    setConfirmDelete(null);
  }

  function addQual(courseId: string, teacherId: string) {
    setQualMap(prev => {
      const next = new Map(prev);
      const s = new Set(next.get(courseId) ?? []);
      s.add(teacherId);
      next.set(courseId, s);
      return next;
    });
    setDirty(true);
    setAddSearch("");
  }

  function removeQual(courseId: string, teacherId: string) {
    setQualMap(prev => {
      const next = new Map(prev);
      const s = new Set(next.get(courseId) ?? []);
      s.delete(teacherId);
      next.set(courseId, s);
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveTable("courses", courses);
      // Reconstruct full qualifications from map (all courses × teachers)
      const qualRows: { teacher_id: string; course_id: string }[] = [];
      for (const [cid, teacherSet] of qualMap.entries()) {
        for (const tid of teacherSet) {
          qualRows.push({ teacher_id: tid, course_id: cid });
        }
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

  const teacherMap = new Map(teachers.map(t => [t.teacher_id, t.full_name]));

  function renderStatus(course: Course) {
    const enrollment = Number(course.total_enrollment) || 0;
    const sections = Number(course.num_sections) || 0;
    const maxSize = Number(course.max_class_size) || 0;
    if (enrollment <= 0 || sections <= 0) {
      return <span style={{ color: "#ccc", fontSize: 11 }}>—</span>;
    }
    if (maxSize <= 0) {
      return (
        <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 10, color: "#aaa" }}>
          {parseFloat((enrollment / sections).toFixed(1))}/section
        </span>
      );
    }
    const capacity = sections * maxSize;
    const diff = enrollment - capacity;
    const color = diff > 0 ? "#b91c1c" : diff < 0 ? "#166534" : "#aaa";
    const avgSize = parseFloat((enrollment / sections).toFixed(1));
    return (
      <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.3, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 500, color, whiteSpace: "nowrap" }}>
          {enrollment}/{capacity}{diff !== 0 && <span style={{ fontSize: 10, fontWeight: 400 }}> ({diff > 0 ? "+" : ""}{diff})</span>}
        </span>
        <span style={{ fontSize: 10, fontWeight: 400, color: "#aaa", whiteSpace: "nowrap" }}>
          {avgSize}/section
        </span>
      </span>
    );
  }

  const filteredCourses = courses
    .map((course, originalIdx) => ({ course, originalIdx }))
    .filter(({ course }) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const quals = [...(qualMap.get(course.course_id) ?? [])].map(tid => teacherMap.get(tid) ?? tid).join(" ").toLowerCase();
      return (
        course.course_id.toLowerCase().includes(q) ||
        (course.course_title ?? "").toLowerCase().includes(q) ||
        quals.includes(q)
      );
    });

  const SECTION_OPTIONS = Array.from({ length: 20 }, (_, i) => String(i + 1));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexShrink: 0 }}>
        <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 11, color: "#aaa" }}>
          {courses.length} courses
        </span>
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Search courses or teachers…"
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
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={addCourse}>+ Add Course</button>
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
                <th style={{ minWidth: 100 }}>course id</th>
                <th style={{ minWidth: 160 }}>title</th>
                <th style={{ minWidth: 56, textAlign: "center" }}>enr 7</th>
                <th style={{ minWidth: 56, textAlign: "center" }}>enr 8</th>
                <th style={{ minWidth: 56, textAlign: "center" }}>total</th>
                <th style={{ minWidth: 56, textAlign: "center" }}>sections</th>
                <th style={{ minWidth: 56, textAlign: "center" }}>max size</th>
                <th style={{ minWidth: 80, textAlign: "center" }}>status</th>
                <th>qualified teachers</th>
                <th style={{ minWidth: 120 }}>notes</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {filteredCourses.map(({ course, originalIdx }) => {
                const quals = [...(qualMap.get(course.course_id) ?? [])].sort();
                const isAddingHere = addingFor === String(originalIdx);

                const available = teacherOptions.filter(t =>
                  !quals.includes(t.value) &&
                  (!addSearch.trim() || t.label.toLowerCase().includes(addSearch.toLowerCase()) || t.value.toLowerCase().includes(addSearch.toLowerCase()))
                );

                return (
                  <tr key={originalIdx}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <input className="cell-input" value={course.course_id}
                        onChange={e => handleCellChange(originalIdx, "course_id", e.target.value)} />
                    </td>
                    <td>
                      <input className="cell-input" value={course.course_title ?? ""}
                        onChange={e => handleCellChange(originalIdx, "course_title", e.target.value)} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input className="cell-input-narrow" value={course.enrollment_7th ?? ""}
                        onChange={e => handleCellChange(originalIdx, "enrollment_7th", e.target.value)} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input className="cell-input-narrow" value={course.enrollment_8th ?? ""}
                        onChange={e => handleCellChange(originalIdx, "enrollment_8th", e.target.value)} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input className="cell-input-narrow" value={course.total_enrollment ?? ""}
                        onChange={e => handleCellChange(originalIdx, "total_enrollment", e.target.value)} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <select className="cell-input-narrow" value={course.num_sections ?? ""}
                        onChange={e => handleCellChange(originalIdx, "num_sections", e.target.value)}>
                        <option value="">—</option>
                        {SECTION_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input className="cell-input-narrow" value={course.max_class_size ?? ""}
                        onChange={e => handleCellChange(originalIdx, "max_class_size", e.target.value)} />
                    </td>

                    {/* Status (computed) */}
                    <td style={{ textAlign: "center" }}>
                      {renderStatus(course)}
                    </td>

                    {/* Qualified teachers column */}
                    <td style={{ position: "relative" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", padding: "2px 0" }}>
                        {quals.map(tid => (
                          <span key={tid} className="qual-tag" title={tid}>
                            <span className="qual-tag-label">{teacherMap.get(tid) ?? tid}</span>
                            <button
                              className="qual-tag-remove"
                              onClick={() => removeQual(course.course_id, tid)}
                              title="Remove"
                            >×</button>
                          </span>
                        ))}

                        <div ref={isAddingHere ? addRef : undefined} style={{ position: "relative" }}>
                          <button
                            className="qual-add-btn"
                            onClick={() => { setAddingFor(isAddingHere ? null : String(originalIdx)); setAddSearch(""); }}
                          >
                            + Add
                          </button>
                          {isAddingHere && (
                            <div className="qual-dropdown">
                              <input
                                autoFocus
                                className="qual-search"
                                placeholder="Search teachers…"
                                value={addSearch}
                                onChange={e => setAddSearch(e.target.value)}
                              />
                              <div className="qual-dropdown-list">
                                {available.length === 0 ? (
                                  <div className="qual-dropdown-empty">No matches</div>
                                ) : (
                                  available.slice(0, 50).map(t => (
                                    <button
                                      key={t.value}
                                      className="qual-dropdown-item"
                                      onClick={() => addQual(course.course_id, t.value)}
                                    >
                                      <span className="qual-dropdown-id">{t.value}</span>
                                      <span className="qual-dropdown-title">{t.label}</span>
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td>
                      <textarea
                        className="notes-textarea"
                        value={course.notes ?? ""}
                        rows={1}
                        onChange={e => handleCellChange(originalIdx, "notes", e.target.value)}
                      />
                    </td>

                    {/* Delete action */}
                    <td style={{ width: 40, padding: "0 4px", position: "relative" }}>
                      {confirmDelete === originalIdx ? (
                        <div className="delete-confirm">
                          <button className="delete-confirm-yes" onClick={() => deleteCourse(originalIdx)}>Delete</button>
                          <button className="delete-confirm-no" onClick={() => setConfirmDelete(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="row-action-btn" onClick={() => setConfirmDelete(originalIdx)} title="Row actions">
                          ⋯
                        </button>
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
