import { useState, useCallback, useEffect, useRef } from "react";
import { fetchTable, saveTable } from "../api";

interface Course {
  course_id: string;
  course_title: string;
  department: string;
  enrollment_7th: string;
  enrollment_8th: string;
  total_enrollment: string;
  num_sections: string;
  max_class_size: string;
  course_group: string;
  course_group_order: string;
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
  onExport?: () => void;
}

export default function CourseQualificationsTable({ onExport }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [qualMap, setQualMap] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [search, setSearch] = useState("");
  const [linkingFor, setLinkingFor] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<"course_id" | "course_title" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const linkRef = useRef<HTMLDivElement>(null);

  // Assigned teachers from section locks: courseId → [{teacher_id, num_sections}]
  const [lockMap, setLockMap] = useState<Map<string, { teacher_id: string; num_sections: number }[]>>(new Map());
  const [deptOptions, setDeptOptions] = useState<{ code: string; display: string }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [courseRows, teacherRows, qualRows, lockRows, deptRows] = await Promise.all([
        fetchTable("courses"),
        fetchTable("teachers"),
        fetchTable("teacher_qualifications"),
        fetchTable("teacher_section_locks"),
        fetchTable("departments"),
      ]);
      setCourses(courseRows as Course[]);
      setTeachers(teacherRows as Teacher[]);
      setDeptOptions((deptRows as { department_code: string; display_name: string }[]).map(d => ({ code: d.department_code, display: d.display_name })));
      const map = new Map<string, Set<string>>();
      for (const c of courseRows as Course[]) map.set(c.course_id, new Set());
      for (const q of qualRows as { teacher_id: string; course_id: string }[]) {
        if (!map.has(q.course_id)) map.set(q.course_id, new Set());
        map.get(q.course_id)!.add(q.teacher_id);
      }
      setQualMap(map);
      // Build lock map: course → teachers with section counts
      const lm = new Map<string, { teacher_id: string; num_sections: number }[]>();
      for (const r of lockRows as { teacher_id: string; course_id: string; num_sections: string }[]) {
        if (!lm.has(r.course_id)) lm.set(r.course_id, []);
        lm.get(r.course_id)!.push({ teacher_id: r.teacher_id, num_sections: Number(r.num_sections) || 0 });
      }
      setLockMap(lm);
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (linkRef.current && !linkRef.current.contains(e.target as Node)) {
        setLinkingFor(null); setLinkSearch("");
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
      // If course_id changed, migrate the qualMap key so quals aren't lost
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

  function handleMaxSizeChange(idx: number, value: string) {
    // Sync max_class_size across all courses in the same group
    setCourses(prev => {
      const group = prev[idx]?.course_group;
      return prev.map((c, i) => {
        if (i === idx) return { ...c, max_class_size: value };
        if (group && c.course_group === group) return { ...c, max_class_size: value };
        return c;
      });
    });
    setDirty(true);
  }

  function linkCourses(courseAId: string, courseBId: string) {
    const groupId = `${courseAId}__${courseBId}`;
    setCourses(prev => prev.map(c => {
      if (c.course_id === courseAId) return { ...c, course_group: groupId, course_group_order: "0" };
      if (c.course_id === courseBId) return { ...c, course_group: groupId, course_group_order: "1" };
      return c;
    }));
    setLinkingFor(null);
    setLinkSearch("");
    setDirty(true);
  }

  function unlinkCourse(groupId: string) {
    setCourses(prev => prev.map(c =>
      c.course_group === groupId ? { ...c, course_group: "", course_group_order: "" } : c
    ));
    setDirty(true);
  }

  function switchGroupOrder(groupId: string) {
    setCourses(prev => prev.map(c => {
      if (c.course_group !== groupId) return c;
      return { ...c, course_group_order: c.course_group_order === "0" ? "1" : "0" };
    }));
    setDirty(true);
  }

  function addCourse() {
    const empty: Course = {
      course_id: "", course_title: "", department: "", enrollment_7th: "", enrollment_8th: "",
      total_enrollment: "", num_sections: "", max_class_size: "",
      course_group: "", course_group_order: "", notes: "",
    };
    setCourses(prev => [...prev, empty]);
    setDirty(true);
  }

  function deleteCourse(idx: number) {
    setCourses(prev => {
      const course = prev[idx];
      // If grouped, clear the group from the partner too
      if (course?.course_group) {
        const groupId = course.course_group;
        setTimeout(() => unlinkCourse(groupId), 0);
      }
      setQualMap(qm => { const next = new Map(qm); next.delete(course.course_id); return next; });
      return prev.filter((_, i) => i !== idx);
    });
    setDirty(true);
    setConfirmDelete(null);
  }


  async function handleSave() {
    setSaving(true);
    try {
      await saveTable("courses", courses);
      const qualRows: { teacher_id: string; course_id: string }[] = [];
      for (const [cid, teacherSet] of qualMap.entries()) {
        for (const tid of teacherSet) qualRows.push({ teacher_id: tid, course_id: cid });
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

  // Build group map: groupId → [primary, secondary] (sorted by order)
  function buildGroups(courseList: Course[]): Map<string, [Course, Course]> {
    const map = new Map<string, Course[]>();
    for (const c of courseList) {
      if (!c.course_group) continue;
      if (!map.has(c.course_group)) map.set(c.course_group, []);
      map.get(c.course_group)!.push(c);
    }
    const result = new Map<string, [Course, Course]>();
    for (const [gid, members] of map.entries()) {
      if (members.length !== 2) continue;
      const sorted = [...members].sort((a, b) => Number(a.course_group_order) - Number(b.course_group_order));
      result.set(gid, [sorted[0], sorted[1]]);
    }
    return result;
  }

  function toggleSort(col: "course_id" | "course_title") {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  // Sort courses as units: groups sort by primary's value, ungrouped sort individually.
  // All units interleaved in one sorted list.
  function sortedCourses(courseList: Course[]): Course[] {
    const groups = buildGroups(courseList);

    // Build units: each unit has a sort key and an ordered list of courses to emit
    type Unit = { key: string; courses: Course[] };
    const units: Unit[] = [];
    const seen = new Set<string>();

    for (const c of courseList) {
      if (c.course_group && groups.has(c.course_group)) {
        if (seen.has(c.course_group)) continue;
        seen.add(c.course_group);
        const [primary, secondary] = groups.get(c.course_group)!;
        const key = sortCol === "course_title"
          ? (primary.course_title ?? "").toLowerCase()
          : primary.course_id.toLowerCase();
        units.push({ key, courses: [primary, secondary] });
      } else {
        const key = sortCol === "course_title"
          ? (c.course_title ?? "").toLowerCase()
          : c.course_id.toLowerCase();
        units.push({ key, courses: [c] });
      }
    }

    if (sortCol) {
      units.sort((a, b) => sortDir === "asc"
        ? a.key.localeCompare(b.key)
        : b.key.localeCompare(a.key));
    }

    return units.flatMap(u => u.courses);
  }

  function renderGroupedStatus(primary: Course, secondary: Course) {
    const combinedEnr = (Number(primary.total_enrollment) || 0) + (Number(secondary.total_enrollment) || 0);
    const primarySections = Number(primary.num_sections) || 0;
    const maxSize = Number(primary.max_class_size) || 0;
    if (combinedEnr <= 0 || primarySections <= 0) return <span style={{ color: "#ccc", fontSize: 11 }}>—</span>;
    if (maxSize <= 0) return (
      <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 10, color: "#aaa" }}>
        {combinedEnr} enrolled
      </span>
    );
    const capacity = primarySections * maxSize;
    const diff = combinedEnr - capacity;
    const color = diff > 0 ? "#b91c1c" : diff < 0 ? "#166534" : "#aaa";
    const avgSize = parseFloat((combinedEnr / primarySections).toFixed(1));
    return (
      <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.3, alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 500, color, whiteSpace: "nowrap" }}>
          {combinedEnr}/{capacity}{diff !== 0 && <span style={{ fontSize: 10, fontWeight: 400 }}> ({diff > 0 ? "+" : ""}{diff})</span>}
        </span>
        <span style={{ fontSize: 10, fontWeight: 400, color: "#aaa", whiteSpace: "nowrap" }}>
          {avgSize}/section
        </span>
      </span>
    );
  }

  function renderStatus(course: Course) {
    const enrollment = Number(course.total_enrollment) || 0;
    const sections = Number(course.num_sections) || 0;
    const maxSize = Number(course.max_class_size) || 0;
    if (enrollment <= 0 || sections <= 0) return <span style={{ color: "#ccc", fontSize: 11 }}>—</span>;
    if (maxSize <= 0) return (
      <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 10, color: "#aaa" }}>
        {parseFloat((enrollment / sections).toFixed(1))}/section
      </span>
    );
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

  // Build indexed list first so we can carry originalIdx through sort/filter
  const indexedCourses = courses.map((course, originalIdx) => ({ course, originalIdx }));

  const filteredIndexed = indexedCourses.filter(({ course }) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const quals = [...(qualMap.get(course.course_id) ?? [])].map(tid => teacherMap.get(tid) ?? tid).join(" ").toLowerCase();
    return (
      course.course_id.toLowerCase().includes(q) ||
      (course.course_title ?? "").toLowerCase().includes(q) ||
      quals.includes(q)
    );
  });

  // Sort while preserving originalIdx
  const filteredCourses = filteredIndexed.map(x => x.course);
  const sortedFiltered = sortedCourses(filteredCourses);
  // Re-attach originalIdx by matching course_id reference (object identity safe after sort)
  const idxByCourse = new Map(filteredIndexed.map(x => [x.course, x.originalIdx]));
  const displayCourses = sortedFiltered.map(c => ({ course: c, originalIdx: idxByCourse.get(c) ?? courses.indexOf(c) }));
  const groups = buildGroups(displayCourses.map(x => x.course));

  // Track which secondary rows we've already rendered (to skip their shared cells)
  const renderedSecondaries = new Set<string>();

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
            fontSize: 11, padding: "4px 10px", border: "1px solid #e0e0e0", borderRadius: 6,
            outline: "none", width: 220, fontFamily: "'Helvetica Neue', Arial, sans-serif",
            color: "#1a1a1a", background: search ? "#fffbe6" : "#fff",
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
        >{saving ? "Saving…" : "Save"}</button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 12 }}>Loading…</div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="data-table" style={{ tableLayout: "auto", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 6, padding: 0 }} />
                <th
                  style={{ minWidth: 100, cursor: "pointer", userSelect: "none" }}
                  onClick={() => toggleSort("course_id")}
                >
                  course id {sortCol === "course_id" ? (sortDir === "asc" ? "↑" : "↓") : <span style={{ color: "#ccc" }}>⇅</span>}
                </th>
                <th
                  style={{ minWidth: 160, cursor: "pointer", userSelect: "none" }}
                  onClick={() => toggleSort("course_title")}
                >
                  title {sortCol === "course_title" ? (sortDir === "asc" ? "↑" : "↓") : <span style={{ color: "#ccc" }}>⇅</span>}
                </th>
                <th style={{ whiteSpace: "nowrap" }}>dept</th>
                <th style={{ minWidth: 56, textAlign: "center" }}>enr 7</th>
                <th style={{ minWidth: 56, textAlign: "center" }}>enr 8</th>
                <th style={{ minWidth: 56, textAlign: "center", borderRight: "2px solid #e8e4dc" }}>total</th>
                <th style={{ minWidth: 56, textAlign: "center" }}>sections</th>
                <th style={{ minWidth: 56, textAlign: "center" }}>max size</th>
                <th style={{ minWidth: 80, textAlign: "center", borderRight: "2px solid #e8e4dc" }}>status</th>
                <th style={{ minWidth: 120 }}>assigned to</th>
                <th style={{ width: "100%", background: "#f9f8f5" }}>notes</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {displayCourses.map(({ course, originalIdx }) => {
                const isLinkingHere = linkingFor === course.course_id;
                const groupId = course.course_group;
                const groupPair = groupId ? groups.get(groupId) : undefined;
                const isPrimary = groupPair ? groupPair[0].course_id === course.course_id : false;
                const isSecondary = groupPair ? groupPair[1].course_id === course.course_id : false;

                // Skip shared cells on secondary row
                const skipShared = isSecondary && renderedSecondaries.has(groupId!);
                if (isPrimary && groupId) renderedSecondaries.add(groupId);

                // Courses available to link with (ungrouped, not self)
                const linkableCourses = courses.filter(c =>
                  c.course_id !== course.course_id && !c.course_group &&
                  (!linkSearch.trim() || c.course_title?.toLowerCase().includes(linkSearch.toLowerCase()) || c.course_id.toLowerCase().includes(linkSearch.toLowerCase()))
                );

                const NON_INSTR = new Set(["CONFERENCE", "PROGRESS", "PROGRESSMON", "TITLE1", "COMMUNITY", "COMSCHOOLS", "5CS", "ASB", "ASBRELEASE", "REWARDS", "DLI"]);
                const totalEnrollment = Number(course.total_enrollment) || Number(course.enrollment_7th) || Number(course.enrollment_8th) || 0;
                const isUnassigned = !NON_INSTR.has(course.course_id) && totalEnrollment > 0 && !isSecondary && (lockMap.get(course.course_id) ?? []).length === 0;

                const rowClass = groupPair
                  ? (isPrimary ? "cg-row cg-primary" : "cg-row cg-secondary")
                  : "";

                return (
                  <tr key={originalIdx} className={rowClass} style={isUnassigned ? { background: "#fffbeb" } : undefined}>
                    {/* Group bracket / unassigned indicator column */}
                    <td className={groupPair ? (isPrimary ? "cg-bracket cg-bracket-top" : "cg-bracket cg-bracket-bottom") : "cg-bracket"}
                      style={{ position: "relative" }}>
                      {isUnassigned && (
                        <span title="No teacher assigned in Section Quotas" style={{
                          position: "absolute", left: "50%", top: "50%",
                          transform: "translate(-50%, -50%)",
                          width: 6, height: 6, borderRadius: "50%",
                          background: "#f59e0b", display: "block",
                        }} />
                      )}
                    </td>

                    <td style={{ whiteSpace: "nowrap" }}>
                      <input className="cell-input" value={course.course_id}
                        onChange={e => handleCellChange(originalIdx, "course_id", e.target.value)} />
                    </td>
                    <td>
                      <input className="cell-input" value={course.course_title ?? ""}
                        onChange={e => handleCellChange(originalIdx, "course_title", e.target.value)} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <select
                        className="conflict-rule-select"
                        value={course.department ?? ""}
                        onChange={e => handleCellChange(originalIdx, "department", e.target.value)}
                      >
                        <option value="">—</option>
                        {deptOptions.map(d => <option key={d.code} value={d.code}>{d.display}</option>)}
                      </select>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input className="cell-input-narrow" value={course.enrollment_7th ?? ""}
                        onChange={e => handleCellChange(originalIdx, "enrollment_7th", e.target.value)} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input className="cell-input-narrow" value={course.enrollment_8th ?? ""}
                        onChange={e => handleCellChange(originalIdx, "enrollment_8th", e.target.value)} />
                    </td>
                    <td style={{ textAlign: "center", borderRight: "2px solid #e8e4dc" }}>
                      <input className="cell-input-narrow" value={course.total_enrollment ?? ""}
                        onChange={e => handleCellChange(originalIdx, "total_enrollment", e.target.value)} />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {isSecondary ? (
                        <span
                          title="Secondary course — primary course sections count for capacity"
                          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}
                        >
                          <span style={{ color: "#bbb", fontSize: 12, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
                            {course.num_sections || "—"}
                          </span>
                          <span style={{ color: "#ccc", fontSize: 9, fontFamily: "'Helvetica Neue', Arial, sans-serif", fontStyle: "italic" }}>
                            not counted
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: "#888", fontSize: 12, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
                          {course.num_sections || "—"}
                        </span>
                      )}
                    </td>

                    {/* Shared max size — rowspan on primary, skip on secondary */}
                    {!skipShared && (
                      <td style={{ textAlign: "center" }} rowSpan={groupPair ? 2 : 1} className={groupPair ? "cg-shared-cell" : ""}>
                        <input className="cell-input-narrow" value={course.max_class_size ?? ""}
                          onChange={e => handleMaxSizeChange(originalIdx, e.target.value)} />
                      </td>
                    )}

                    {/* Shared status — rowspan on primary, skip on secondary */}
                    {!skipShared && (
                      <td style={{ textAlign: "center", borderRight: "2px solid #e8e4dc" }} rowSpan={groupPair ? 2 : 1} className={groupPair ? "cg-shared-cell" : ""}>
                        {groupPair ? renderGroupedStatus(groupPair[0], groupPair[1]) : renderStatus(course)}
                      </td>
                    )}

                    {/* Assigned teachers from section locks (read-only) */}
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "2px 0" }}>
                        {isUnassigned && (
                          <span style={{ fontSize: 10, fontFamily: "'Helvetica Neue', Arial, sans-serif", color: "#b45309", fontStyle: "italic" }}>
                            unassigned in Section Quotas
                          </span>
                        )}
                        {(lockMap.get(course.course_id) ?? []).map(({ teacher_id, num_sections }) => (
                          <span key={teacher_id} style={{
                            fontSize: 10, fontFamily: "'Helvetica Neue', Arial, sans-serif",
                            background: "#f0eee8", color: "#555", borderRadius: 4,
                            padding: "1px 6px", whiteSpace: "nowrap",
                          }}>
                            {teacherMap.get(teacher_id) ?? teacher_id}
                            <span style={{ color: "#999", marginLeft: 2 }}>({num_sections})</span>
                          </span>
                        ))}
                      </div>
                    </td>

                    <td style={{ background: "#f9f8f5" }}>
                      <textarea className="notes-textarea" value={course.notes ?? ""} rows={1}
                        onChange={e => handleCellChange(originalIdx, "notes", e.target.value)} />
                    </td>

                    {/* Action column: group controls + delete */}
                    <td style={{ width: 80, padding: "0 4px", position: "relative", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                        {/* Group controls */}
                        {groupPair && isPrimary && (
                          <>
                            <button className="cg-action-btn" title="Switch primary/secondary" onClick={() => switchGroupOrder(groupId!)}>⇅</button>
                            <button className="cg-action-btn cg-unlink-btn" title="Unlink courses" onClick={() => unlinkCourse(groupId!)}>⊗</button>
                          </>
                        )}
                        {!groupPair && (
                          <div ref={isLinkingHere ? linkRef : undefined} style={{ position: "relative" }}>
                            <button className="cg-action-btn cg-link-btn" title="Link to another course" onClick={() => { setLinkingFor(isLinkingHere ? null : course.course_id); setLinkSearch(""); }}>⇢</button>
                            {isLinkingHere && (
                              <div className="qual-dropdown" style={{ right: 0, left: "auto", minWidth: 220 }}>
                                <input autoFocus className="qual-search" placeholder="Search course to link…" value={linkSearch} onChange={e => setLinkSearch(e.target.value)} />
                                <div className="qual-dropdown-list">
                                  {linkableCourses.length === 0 ? <div className="qual-dropdown-empty">No ungrouped courses</div> : linkableCourses.slice(0, 30).map(c => (
                                    <button key={c.course_id} className="qual-dropdown-item" onClick={() => linkCourses(course.course_id, c.course_id)}>
                                      <span className="qual-dropdown-id">{c.course_id}</span>
                                      <span className="qual-dropdown-title">{c.course_title}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Delete */}
                        {confirmDelete === originalIdx ? (
                          <>
                            <button className="delete-confirm-yes" onClick={() => deleteCourse(originalIdx)}>Del</button>
                            <button className="delete-confirm-no" onClick={() => setConfirmDelete(null)}>✕</button>
                          </>
                        ) : (
                          <button className="row-action-btn" onClick={() => setConfirmDelete(originalIdx)} title="Delete">⋯</button>
                        )}
                      </div>
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
