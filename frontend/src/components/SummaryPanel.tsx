import { useState, useMemo } from "react";
import type { Section } from "../api";

interface Teacher {
  teacher_id: string;
  full_name: string;
  department: string;
  max_sections: number;
}

interface CourseRow {
  course_id: string;
  course_title: string;
  num_sections: number;
  total_enrollment: number;
}

interface SectionLock {
  teacher_id: string;
  course_id: string;
  num_sections: number;
}

interface Props {
  sections: Section[];
  teachers: Teacher[];
  courses: CourseRow[];
  sectionLocks: SectionLock[];
  courseNames: Map<string, string>;
  scheduleExists: boolean;
}

type SortDir = "asc" | "desc";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s" }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function StatusPill({ status }: { status: "full" | "under" | "over" | "empty" | "complete" | "partial" | "none" }) {
  const map = {
    full: { label: "Full", bg: "#ecfdf5", color: "#166534", border: "#bbf7d0" },
    complete: { label: "Complete", bg: "#ecfdf5", color: "#166534", border: "#bbf7d0" },
    under: { label: "Under", bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
    partial: { label: "Partial", bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
    over: { label: "Over", bg: "#fef2f2", color: "#991b1b", border: "#fecaca" },
    empty: { label: "Empty", bg: "#f9fafb", color: "#9ca3af", border: "#e5e7eb" },
    none: { label: "None", bg: "#fef2f2", color: "#991b1b", border: "#fecaca" },
  };
  const s = map[status];
  return (
    <span style={{
      display: "inline-block",
      padding: "1px 8px",
      borderRadius: 10,
      fontSize: 10,
      fontFamily: "'Helvetica Neue', Arial, sans-serif",
      fontWeight: 500,
      background: s.bg,
      color: s.color,
      border: `1px solid ${s.border}`,
      whiteSpace: "nowrap",
    }}>
      {s.label}
    </span>
  );
}

function SortHeader({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <th onClick={onClick} style={{ cursor: "pointer", userSelect: "none" }}>
      {label}
      {active && <span style={{ marginLeft: 3, fontSize: 9 }}>{dir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

export default function SummaryPanel({ sections, teachers, courses, sectionLocks, courseNames, scheduleExists }: Props) {
  const PERIODS = 7;

  // ── Teacher stats ──
  const teacherStats = useMemo(() => {
    const bySections = new Map<string, Section[]>();
    for (const s of sections) {
      if (!bySections.has(s.teacher_id)) bySections.set(s.teacher_id, []);
      bySections.get(s.teacher_id)!.push(s);
    }

    return teachers.map(t => {
      const assigned = bySections.get(t.teacher_id) ?? [];
      const assignedCount = assigned.length;
      const free = PERIODS - assignedCount;
      const status: "full" | "under" | "over" | "empty" =
        assignedCount === 0 ? "empty" :
        assignedCount > t.max_sections ? "over" :
        assignedCount === t.max_sections ? "full" : "under";

      // Group by course
      const byCourse = new Map<string, number>();
      for (const s of assigned) {
        byCourse.set(s.course_id, (byCourse.get(s.course_id) ?? 0) + 1);
      }

      // Quotas for this teacher
      const quotas = sectionLocks.filter(l => l.teacher_id === t.teacher_id);

      return { ...t, assignedCount, free, status, byCourse, quotas };
    });
  }, [teachers, sections, sectionLocks]);

  // ── Course stats ──
  const courseStats = useMemo(() => {
    const byScheduled = new Map<string, Section[]>();
    for (const s of sections) {
      if (!byScheduled.has(s.course_id)) byScheduled.set(s.course_id, []);
      byScheduled.get(s.course_id)!.push(s);
    }

    return courses
      .filter(c => c.num_sections > 0 || byScheduled.has(c.course_id))
      .map(c => {
        const scheduled = byScheduled.get(c.course_id) ?? [];
        const scheduledCount = scheduled.length;
        const gap = scheduledCount - c.num_sections;
        const status: "complete" | "partial" | "none" =
          c.num_sections === 0 ? "complete" :
          scheduledCount >= c.num_sections ? "complete" :
          scheduledCount > 0 ? "partial" : "none";

        // Which teachers teach it
        const byTeacher = new Map<string, number[]>();
        for (const s of scheduled) {
          if (!byTeacher.has(s.teacher_id)) byTeacher.set(s.teacher_id, []);
          byTeacher.get(s.teacher_id)!.push(s.period);
        }

        return { ...c, scheduledCount, gap, status, byTeacher };
      });
  }, [courses, sections]);

  // ── Department stats ──
  const deptStats = useMemo(() => {
    const deptMap = new Map<string, typeof teacherStats>();
    for (const t of teacherStats) {
      const dept = t.department || "OTHER";
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(t);
    }

    return [...deptMap.entries()].map(([dept, deptTeachers]) => {
      const totalAssigned = deptTeachers.reduce((s, t) => s + t.assignedCount, 0);
      const totalCapacity = deptTeachers.reduce((s, t) => s + t.max_sections, 0);
      const avgLoad = deptTeachers.length > 0 ? totalAssigned / deptTeachers.length : 0;
      const pct = totalCapacity > 0 ? Math.round((totalAssigned / totalCapacity) * 100) : 0;

      return { dept, teachers: deptTeachers, totalAssigned, totalCapacity, avgLoad, pct };
    }).sort((a, b) => a.dept.localeCompare(b.dept));
  }, [teacherStats]);

  // ── Sorting state ──
  const [teacherSort, setTeacherSort] = useState<{ col: string; dir: SortDir }>({ col: "status", dir: "asc" });
  const [courseSort, setCourseSort] = useState<{ col: string; dir: SortDir }>({ col: "status", dir: "asc" });

  // ── Expand state ──
  const [expandedTeacher, setExpandedTeacher] = useState<string | null>(null);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);

  // ── Collapse state ──
  const [teachersOpen, setTeachersOpen] = useState(true);
  const [coursesOpen, setCoursesOpen] = useState(true);
  const [deptsOpen, setDeptsOpen] = useState(true);

  // ── Sort helpers ──
  const statusPriority = { over: 0, empty: 1, under: 2, full: 3, none: 0, partial: 1, complete: 2 };

  const sortedTeachers = useMemo(() => {
    const sorted = [...teacherStats];
    const { col, dir } = teacherSort;
    sorted.sort((a, b) => {
      let cmp = 0;
      if (col === "name") cmp = (a.full_name || a.teacher_id).localeCompare(b.full_name || b.teacher_id);
      else if (col === "dept") cmp = a.department.localeCompare(b.department);
      else if (col === "assigned") cmp = a.assignedCount - b.assignedCount;
      else if (col === "free") cmp = a.free - b.free;
      else if (col === "status") cmp = statusPriority[a.status] - statusPriority[b.status];
      return dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [teacherStats, teacherSort]);

  const sortedCourses = useMemo(() => {
    const sorted = [...courseStats];
    const { col, dir } = courseSort;
    sorted.sort((a, b) => {
      let cmp = 0;
      if (col === "title") cmp = a.course_title.localeCompare(b.course_title);
      else if (col === "needed") cmp = a.num_sections - b.num_sections;
      else if (col === "scheduled") cmp = a.scheduledCount - b.scheduledCount;
      else if (col === "gap") cmp = a.gap - b.gap;
      else if (col === "status") cmp = statusPriority[a.status] - statusPriority[b.status];
      return dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [courseStats, courseSort]);

  function toggleSort(
    current: { col: string; dir: SortDir },
    setter: (v: { col: string; dir: SortDir }) => void,
    col: string,
  ) {
    if (current.col === col) setter({ col, dir: current.dir === "asc" ? "desc" : "asc" });
    else setter({ col, dir: "asc" });
  }

  // ── Aggregate counts ──
  const teachersAtCapacity = teacherStats.filter(t => t.status === "full").length;
  const teachersOver = teacherStats.filter(t => t.status === "over").length;
  const coursesComplete = courseStats.filter(c => c.status === "complete").length;
  const coursesWithSections = courseStats.filter(c => c.num_sections > 0).length;

  const font = "'Helvetica Neue', Arial, sans-serif";

  if (!scheduleExists) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 32, marginBottom: 4 }}>--</div>
        <div className="empty-state-title">No schedule generated yet</div>
        <div className="empty-state-sub">Click Run Solver to produce a schedule</div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 40px", fontFamily: font, fontSize: 12 }}>

      {/* ── Teacher Load ── */}
      <div className="summary-card">
        <div className="summary-card-header" onClick={() => setTeachersOpen(!teachersOpen)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ChevronIcon open={teachersOpen} />
            <span className="summary-card-title">Teacher Load</span>
          </div>
          <span className="summary-card-count">
            {teachersAtCapacity} of {teachers.length} at capacity
            {teachersOver > 0 && <span style={{ color: "#991b1b", marginLeft: 8 }}>{teachersOver} over</span>}
          </span>
        </div>
        {teachersOpen && (
          <table className="summary-table">
            <thead>
              <tr>
                <SortHeader label="Teacher" active={teacherSort.col === "name"} dir={teacherSort.dir} onClick={() => toggleSort(teacherSort, setTeacherSort, "name")} />
                <SortHeader label="Dept" active={teacherSort.col === "dept"} dir={teacherSort.dir} onClick={() => toggleSort(teacherSort, setTeacherSort, "dept")} />
                <SortHeader label="Assigned" active={teacherSort.col === "assigned"} dir={teacherSort.dir} onClick={() => toggleSort(teacherSort, setTeacherSort, "assigned")} />
                <th>Max</th>
                <SortHeader label="Free" active={teacherSort.col === "free"} dir={teacherSort.dir} onClick={() => toggleSort(teacherSort, setTeacherSort, "free")} />
                <SortHeader label="Status" active={teacherSort.col === "status"} dir={teacherSort.dir} onClick={() => toggleSort(teacherSort, setTeacherSort, "status")} />
              </tr>
            </thead>
            <tbody>
              {sortedTeachers.map(t => (
                <>
                  <tr
                    key={t.teacher_id}
                    className="summary-row"
                    onClick={() => setExpandedTeacher(expandedTeacher === t.teacher_id ? null : t.teacher_id)}
                  >
                    <td style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <ChevronIcon open={expandedTeacher === t.teacher_id} />
                      {t.full_name || t.teacher_id}
                    </td>
                    <td>{t.department}</td>
                    <td style={{ textAlign: "center" }}>{t.assignedCount}</td>
                    <td style={{ textAlign: "center" }}>{t.max_sections}</td>
                    <td style={{ textAlign: "center" }}>{t.free}</td>
                    <td style={{ textAlign: "center" }}><StatusPill status={t.status} /></td>
                  </tr>
                  {expandedTeacher === t.teacher_id && (
                    <tr key={`${t.teacher_id}-detail`} className="summary-detail-row">
                      <td colSpan={6}>
                        <div className="summary-detail">
                          {t.byCourse.size === 0 ? (
                            <span style={{ color: "#aaa", fontStyle: "italic" }}>No sections assigned</span>
                          ) : (
                            <table className="summary-subtable">
                              <thead>
                                <tr>
                                  <th>Course</th>
                                  <th>Scheduled</th>
                                  <th>Quota</th>
                                  <th>Diff</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...t.byCourse.entries()].map(([cid, count]) => {
                                  const quota = t.quotas.find(q => q.course_id === cid);
                                  const diff = quota ? count - quota.num_sections : 0;
                                  return (
                                    <tr key={cid}>
                                      <td>{courseNames.get(cid) || cid}</td>
                                      <td style={{ textAlign: "center" }}>{count}</td>
                                      <td style={{ textAlign: "center", color: quota ? "#1a1a1a" : "#ccc" }}>{quota ? quota.num_sections : "—"}</td>
                                      <td style={{
                                        textAlign: "center",
                                        color: diff > 0 ? "#991b1b" : diff < 0 ? "#92400e" : "#166534",
                                        fontWeight: diff !== 0 ? 600 : 400,
                                      }}>
                                        {quota ? (diff > 0 ? `+${diff}` : diff === 0 ? "—" : String(diff)) : ""}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Course Fulfillment ── */}
      <div className="summary-card">
        <div className="summary-card-header" onClick={() => setCoursesOpen(!coursesOpen)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ChevronIcon open={coursesOpen} />
            <span className="summary-card-title">Course Fulfillment</span>
          </div>
          <span className="summary-card-count">
            {coursesComplete} of {coursesWithSections} fully staffed
          </span>
        </div>
        {coursesOpen && (
          <table className="summary-table">
            <thead>
              <tr>
                <th>Code</th>
                <SortHeader label="Title" active={courseSort.col === "title"} dir={courseSort.dir} onClick={() => toggleSort(courseSort, setCourseSort, "title")} />
                <SortHeader label="Needed" active={courseSort.col === "needed"} dir={courseSort.dir} onClick={() => toggleSort(courseSort, setCourseSort, "needed")} />
                <SortHeader label="Scheduled" active={courseSort.col === "scheduled"} dir={courseSort.dir} onClick={() => toggleSort(courseSort, setCourseSort, "scheduled")} />
                <SortHeader label="Gap" active={courseSort.col === "gap"} dir={courseSort.dir} onClick={() => toggleSort(courseSort, setCourseSort, "gap")} />
                <SortHeader label="Status" active={courseSort.col === "status"} dir={courseSort.dir} onClick={() => toggleSort(courseSort, setCourseSort, "status")} />
              </tr>
            </thead>
            <tbody>
              {sortedCourses.map(c => (
                <>
                  <tr
                    key={c.course_id}
                    className="summary-row"
                    onClick={() => setExpandedCourse(expandedCourse === c.course_id ? null : c.course_id)}
                  >
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <ChevronIcon open={expandedCourse === c.course_id} />
                        <span className="id-pill" style={{ fontSize: 9 }}>{c.course_id}</span>
                      </span>
                    </td>
                    <td>{c.course_title}</td>
                    <td style={{ textAlign: "center" }}>{c.num_sections}</td>
                    <td style={{ textAlign: "center" }}>{c.scheduledCount}</td>
                    <td style={{
                      textAlign: "center",
                      color: c.gap < 0 ? "#991b1b" : c.gap > 0 ? "#92400e" : "#166534",
                      fontWeight: c.gap !== 0 ? 600 : 400,
                    }}>
                      {c.gap > 0 ? `+${c.gap}` : c.gap === 0 ? "—" : String(c.gap)}
                    </td>
                    <td style={{ textAlign: "center" }}><StatusPill status={c.status} /></td>
                  </tr>
                  {expandedCourse === c.course_id && (
                    <tr key={`${c.course_id}-detail`} className="summary-detail-row">
                      <td colSpan={6}>
                        <div className="summary-detail">
                          {c.byTeacher.size === 0 ? (
                            <span style={{ color: "#aaa", fontStyle: "italic" }}>No teachers assigned</span>
                          ) : (
                            <table className="summary-subtable">
                              <thead>
                                <tr>
                                  <th>Teacher</th>
                                  <th>Sections</th>
                                  <th>Periods</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...c.byTeacher.entries()].map(([tid, periods]) => {
                                  const teacher = teachers.find(t => t.teacher_id === tid);
                                  return (
                                    <tr key={tid}>
                                      <td>{teacher?.full_name || tid}</td>
                                      <td style={{ textAlign: "center" }}>{periods.length}</td>
                                      <td>{periods.sort((a, b) => a - b).map(p => `P${p}`).join(", ")}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Department Overview ── */}
      <div className="summary-card">
        <div className="summary-card-header" onClick={() => setDeptsOpen(!deptsOpen)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ChevronIcon open={deptsOpen} />
            <span className="summary-card-title">Department Overview</span>
          </div>
          <span className="summary-card-count">
            {deptStats.length} departments
          </span>
        </div>
        {deptsOpen && (
          <table className="summary-table">
            <thead>
              <tr>
                <th>Department</th>
                <th>Teachers</th>
                <th>Sections</th>
                <th>Avg Load</th>
                <th>Capacity</th>
              </tr>
            </thead>
            <tbody>
              {deptStats.map(d => (
                <>
                  <tr
                    key={d.dept}
                    className="summary-row"
                    onClick={() => setExpandedDept(expandedDept === d.dept ? null : d.dept)}
                  >
                    <td style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <ChevronIcon open={expandedDept === d.dept} />
                      {d.dept}
                    </td>
                    <td style={{ textAlign: "center" }}>{d.teachers.length}</td>
                    <td style={{ textAlign: "center" }}>{d.totalAssigned}/{d.totalCapacity}</td>
                    <td style={{ textAlign: "center" }}>{d.avgLoad.toFixed(1)}</td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{
                        color: d.pct >= 90 ? "#166534" : d.pct >= 70 ? "#92400e" : "#991b1b",
                        fontWeight: 500,
                      }}>
                        {d.pct}%
                      </span>
                    </td>
                  </tr>
                  {expandedDept === d.dept && (
                    <tr key={`${d.dept}-detail`} className="summary-detail-row">
                      <td colSpan={5}>
                        <div className="summary-detail">
                          <table className="summary-subtable">
                            <thead>
                              <tr>
                                <th>Teacher</th>
                                <th>Assigned</th>
                                <th>Max</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {d.teachers.map(t => (
                                <tr key={t.teacher_id}>
                                  <td>{t.full_name || t.teacher_id}</td>
                                  <td style={{ textAlign: "center" }}>{t.assignedCount}</td>
                                  <td style={{ textAlign: "center" }}>{t.max_sections}</td>
                                  <td style={{ textAlign: "center" }}><StatusPill status={t.status} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
