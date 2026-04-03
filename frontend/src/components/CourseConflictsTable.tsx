import { useState, useCallback, useEffect, useRef } from "react";
import { fetchTable, saveTable } from "../api";

interface ConflictGroup {
  name: string;
  type: "hard" | "soft";
  maxPerPeriod: number;
  courses: string[];
  notes: string;
}

interface Props {
  courseOptions: { value: string; label: string }[];
  onExport?: () => void;
}

export default function CourseConflictsTable({ courseOptions, onExport }: Props) {
  const [groups, setGroups] = useState<ConflictGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [addingFor, setAddingFor] = useState<string | null>(null); // group name
  const [addSearch, setAddSearch] = useState("");
  const [editingName, setEditingName] = useState<string | null>(null); // group being renamed
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchTable("course_conflicts") as {
        group_name: string; course_id: string;
        constraint_type?: string; max_per_period?: number; notes?: string;
      }[];

      // Reconstruct groups from flat rows
      const map = new Map<string, ConflictGroup>();
      for (const r of rows) {
        if (!map.has(r.group_name)) {
          map.set(r.group_name, {
            name: r.group_name,
            type: (r.constraint_type === "soft" ? "soft" : "hard") as "hard" | "soft",
            maxPerPeriod: Number(r.max_per_period) || 1,
            courses: [],
            notes: r.notes ?? "",
          });
        }
        const g = map.get(r.group_name)!;
        if (r.course_id && !g.courses.includes(r.course_id)) {
          g.courses.push(r.course_id);
        }
        // constraint_type, max_per_period, and notes: use last row's value (should be consistent within group)
        if (r.constraint_type) g.type = r.constraint_type === "soft" ? "soft" : "hard";
        const mpp = Number(r.max_per_period);
        if (mpp > 0) g.maxPerPeriod = mpp;
        if (r.notes) g.notes = r.notes;
      }
      setGroups([...map.values()]);
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setAddingFor(null);
        setAddSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function showToast(type: "ok" | "err", msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }

  function addGroup() {
    const base = "New Group";
    let name = base;
    let i = 2;
    while (groups.some(g => g.name === name)) name = `${base} ${i++}`;
    setGroups(prev => [...prev, { name, type: "hard", maxPerPeriod: 1, courses: [], notes: "" }]);
    setDirty(true);
    // Start editing the name immediately
    setEditingName(name);
    setNewName(name);
  }

  function deleteGroup(name: string) {
    setGroups(prev => prev.filter(g => g.name !== name));
    setDirty(true);
    setConfirmDelete(null);
  }

  function updateGroup(name: string, patch: Partial<ConflictGroup>) {
    setGroups(prev => prev.map(g => g.name === name ? { ...g, ...patch } : g));
    setDirty(true);
  }

  function commitRename(oldName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) { setEditingName(null); return; }
    if (groups.some(g => g.name === trimmed)) { setEditingName(null); return; } // duplicate
    setGroups(prev => prev.map(g => g.name === oldName ? { ...g, name: trimmed } : g));
    setDirty(true);
    setEditingName(null);
  }

  function addCourse(groupName: string, courseId: string) {
    setGroups(prev => prev.map(g =>
      g.name === groupName && !g.courses.includes(courseId)
        ? { ...g, courses: [...g.courses, courseId] }
        : g
    ));
    setDirty(true);
    setAddSearch("");
  }

  function removeCourse(groupName: string, courseId: string) {
    setGroups(prev => prev.map(g =>
      g.name === groupName ? { ...g, courses: g.courses.filter(c => c !== courseId) } : g
    ));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Flatten groups back to rows
      const rows: { group_name: string; course_id: string; constraint_type: string; max_per_period: number; notes: string }[] = [];
      for (const g of groups) {
        for (const cid of g.courses) {
          rows.push({
            group_name: g.name, course_id: cid, constraint_type: g.type,
            max_per_period: g.type === "hard" ? g.maxPerPeriod : 0,
            notes: g.notes,
          });
        }
      }
      await saveTable("course_conflicts", rows);
      setDirty(false);
      showToast("ok", "Saved");
    } catch (e: unknown) {
      showToast("err", String(e));
    } finally {
      setSaving(false);
    }
  }

  const courseMap = new Map(courseOptions.map(c => [c.value, c.label]));
  const totalCourses = groups.reduce((n, g) => n + g.courses.length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexShrink: 0 }}>
        <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 11, color: "#aaa" }}>
          {groups.length} groups · {totalCourses} courses
        </span>
        <div style={{ flex: 1 }} />
        {toast && <span className={`toast toast-${toast.type}`}>{toast.msg}</span>}
        {onExport && (
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={onExport}>Export CSV</button>
        )}
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={load}>Reload</button>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={addGroup}>+ Add Group</button>
        <button
          className={`btn${dirty ? " btn-primary" : " btn-ghost"}`}
          style={{ fontSize: 11, padding: "5px 12px" }}
          onClick={handleSave}
          disabled={!dirty || saving}
        >{saving ? "Saving…" : "Save"}</button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 12 }}>Loading…</div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {groups.length === 0 && (
            <div style={{ color: "#aaa", fontSize: 12, fontFamily: "'Helvetica Neue', Arial, sans-serif", padding: "20px 0" }}>
              No conflict groups yet. Click "+ Add Group" to create one.
            </div>
          )}
          {groups.map(group => {
            const isAddingHere = addingFor === group.name;
            const available = courseOptions.filter(c =>
              !group.courses.includes(c.value) &&
              (!addSearch.trim() || c.label.toLowerCase().includes(addSearch.toLowerCase()) || c.value.toLowerCase().includes(addSearch.toLowerCase()))
            );

            return (
              <div key={group.name} className="conflict-group-card">
                {/* Card header */}
                <div className="conflict-group-header">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                    {editingName === group.name ? (
                      <input
                        autoFocus
                        className="conflict-name-input"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onBlur={() => commitRename(group.name)}
                        onKeyDown={e => { if (e.key === "Enter") commitRename(group.name); if (e.key === "Escape") setEditingName(null); }}
                      />
                    ) : (
                      <span
                        className="conflict-group-name"
                        onClick={() => { setEditingName(group.name); setNewName(group.name); }}
                        title="Click to rename"
                      >{group.name}</span>
                    )}
                    {/* Single rule selector */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 11, color: "#aaa", whiteSpace: "nowrap" }}>Constraint</span>
                      <select
                        className="conflict-rule-select"
                        value={group.type === "soft" ? "soft" : String(group.maxPerPeriod)}
                        onChange={e => {
                          const v = e.target.value;
                          if (v === "soft") updateGroup(group.name, { type: "soft", maxPerPeriod: 1 });
                          else updateGroup(group.name, { type: "hard", maxPerPeriod: Number(v) });
                        }}
                      >
                        <option value="soft">Spread evenly</option>
                        <option value="1">Max 1 per period</option>
                        <option value="2">Max 2 per period</option>
                        <option value="3">Max 3 per period</option>
                        <option value="4">Max 4 per period</option>
                        <option value="5">Max 5 per period</option>
                        <option value="6">Max 6 per period</option>
                      </select>
                    </div>
                  </div>
                  {/* Delete */}
                  {confirmDelete === group.name ? (
                    <div className="delete-confirm" style={{ position: "static", display: "flex" }}>
                      <button className="delete-confirm-yes" onClick={() => deleteGroup(group.name)}>Delete</button>
                      <button className="delete-confirm-no" onClick={() => setConfirmDelete(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="row-action-btn" onClick={() => setConfirmDelete(group.name)} title="Delete group">⋯</button>
                  )}
                </div>

                {/* Courses */}
                <div className="conflict-group-body">
                  {group.courses.map(cid => (
                    <span key={cid} className="qual-tag conflict-course-tag" title={cid}>
                      <span className="qual-tag-label">{courseMap.get(cid) ?? cid}</span>
                      <span className="id-pill" style={{ fontSize: 9, marginLeft: 2 }}>{cid}</span>
                      <button className="qual-tag-remove" onClick={() => removeCourse(group.name, cid)} title="Remove">×</button>
                    </span>
                  ))}

                  {/* Add course dropdown */}
                  <div ref={isAddingHere ? dropdownRef : undefined} style={{ position: "relative", display: "inline-block" }}>
                    <button
                      className="qual-add-btn"
                      onClick={() => { setAddingFor(isAddingHere ? null : group.name); setAddSearch(""); }}
                    >+ Add Course</button>
                    {isAddingHere && (
                      <div className="qual-dropdown">
                        <input
                          autoFocus
                          className="qual-search"
                          placeholder="Search courses…"
                          value={addSearch}
                          onChange={e => setAddSearch(e.target.value)}
                        />
                        <div className="qual-dropdown-list">
                          {available.length === 0 ? (
                            <div className="qual-dropdown-empty">No matches</div>
                          ) : (
                            available.slice(0, 60).map(c => (
                              <button key={c.value} className="qual-dropdown-item" onClick={() => addCourse(group.name, c.value)}>
                                <span className="qual-dropdown-id">{c.value}</span>
                                <span className="qual-dropdown-title">{c.label}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
