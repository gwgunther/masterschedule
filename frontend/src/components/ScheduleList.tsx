import type { Section } from "../api";

interface Teacher {
  teacher_id: string;
  full_name: string;
  department: string;
  max_sections: number;
}

interface Props {
  sections: Section[];
  teachers: Teacher[];
  courseNames?: Map<string, string>;
  courseEnrollment?: Map<string, { enrollment_7th: number; enrollment_8th: number }>;
  totalStudents?: { grade7: number; grade8: number };
}

const NON_INSTR = new Set(["CONFERENCE", "PROGRESS", "PROGRESSMON", "TITLE1", "COMMUNITY", "COMSCHOOLS", "5CS", "ASB", "ASBRELEASE", "REWARDS", "DLI"]);
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

export default function ScheduleList({ sections, teachers, courseNames, courseEnrollment, totalStudents }: Props) {
  // Build lookup: teacher_id → period → Section
  const lookup = new Map<string, Map<number, Section>>();
  for (const s of sections) {
    if (!lookup.has(s.teacher_id)) lookup.set(s.teacher_id, new Map());
    lookup.get(s.teacher_id)!.set(s.period, s);
  }

  // Per-teacher metrics
  const teacherMap = new Map(teachers.map(t => [t.teacher_id, t]));

  // Summary totals
  const totalSeats7 = sections.filter(s => !NON_INSTR.has(s.course_id)).reduce((n, s) => n + (s.students_7th ?? 0), 0);
  const totalSeats8 = sections.filter(s => !NON_INSTR.has(s.course_id)).reduce((n, s) => n + (s.students_8th ?? 0), 0);
  const enroll7 = totalStudents?.grade7 ?? 0;
  const enroll8 = totalStudents?.grade8 ?? 0;

  // Group teachers by department (same order as grid)
  const byDept = new Map<string, Teacher[]>();
  for (const t of teachers) {
    const d = t.department || "OTHER";
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d)!.push(t);
  }
  const depts = [...byDept.keys()].sort();

  function fmt(n: number | undefined | null) {
    return n != null ? String(n) : "—";
  }

  function netClass(diff: number) {
    if (diff > 0) return "summary-pos";
    if (diff < 0) return "summary-neg";
    return "";
  }

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "0 0 32px" }}>
      {/* Summary banner */}
      {totalStudents && (
        <div className="slist-summary">
          <div className="slist-summary-item">
            <span className="slist-summary-label">7th Enrollment</span>
            <span className="slist-summary-val">{enroll7}</span>
          </div>
          <div className="slist-summary-item">
            <span className="slist-summary-label">7th Seats Assigned</span>
            <span className={`slist-summary-val ${netClass(totalSeats7 - enroll7)}`}>{totalSeats7}</span>
          </div>
          <div className="slist-summary-divider" />
          <div className="slist-summary-item">
            <span className="slist-summary-label">8th Enrollment</span>
            <span className="slist-summary-val">{enroll8}</span>
          </div>
          <div className="slist-summary-item">
            <span className="slist-summary-label">8th Seats Assigned</span>
            <span className={`slist-summary-val ${netClass(totalSeats8 - enroll8)}`}>{totalSeats8}</span>
          </div>
          <div className="slist-summary-divider" />
          <div className="slist-summary-item">
            <span className="slist-summary-label">Net 7th</span>
            <span className={`slist-summary-val ${netClass(totalSeats7 - enroll7)}`}>
              {totalSeats7 - enroll7 > 0 ? "+" : ""}{totalSeats7 - enroll7}
            </span>
          </div>
          <div className="slist-summary-item">
            <span className="slist-summary-label">Net 8th</span>
            <span className={`slist-summary-val ${netClass(totalSeats8 - enroll8)}`}>
              {totalSeats8 - enroll8 > 0 ? "+" : ""}{totalSeats8 - enroll8}
            </span>
          </div>
        </div>
      )}

      <table className="slist-table">
        <thead>
          <tr>
            <th className="slist-th-teacher">Teacher</th>
            <th className="slist-th-dept">Dept</th>
            {PERIODS.map(p => <th key={p} className="slist-th-period">P{p}</th>)}
            <th className="slist-th-num">Sections</th>
            <th className="slist-th-num">7th Seats</th>
            <th className="slist-th-num">8th Seats</th>
            <th className="slist-th-num">Total Seats</th>
          </tr>
        </thead>
        <tbody>
          {depts.map(dept => (
            <>
              <tr key={`dept-${dept}`} className="slist-dept-row">
                <td colSpan={4 + PERIODS.length}>{dept}</td>
              </tr>
              {byDept.get(dept)!.map(teacher => {
                const periodMap = lookup.get(teacher.teacher_id);
                const instructional = sections.filter(
                  s => s.teacher_id === teacher.teacher_id && !NON_INSTR.has(s.course_id)
                );
                const seats7 = instructional.reduce((n, s) => n + (s.students_7th ?? 0), 0);
                const seats8 = instructional.reduce((n, s) => n + (s.students_8th ?? 0), 0);

                return (
                  <tr key={teacher.teacher_id} className="slist-row">
                    <td className="slist-td-teacher">{teacher.full_name || teacher.teacher_id}</td>
                    <td className="slist-td-dept">{teacher.department}</td>
                    {PERIODS.map(p => {
                      const sec = periodMap?.get(p);
                      if (!sec) return <td key={p} className="slist-td-period slist-empty">—</td>;
                      const isConf = sec.course_id === "CONFERENCE";
                      const name = isConf ? "Conference" : (courseNames?.get(sec.course_id) ?? sec.course_id);
                      return (
                        <td key={p} className={`slist-td-period${isConf ? " slist-conf" : ""}`}>
                          <div className="slist-course-name">{name}</div>
                          {!isConf && sec.total_students != null && sec.total_students > 0 && (
                            <div className="slist-course-counts">
                              {sec.students_7th != null && sec.students_8th != null
                                ? <><span className="slist-grade-label">7</span>{sec.students_7th} <span className="slist-grade-label">8</span>{sec.students_8th}</>
                                : sec.total_students}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="slist-td-num">{instructional.length}</td>
                    <td className="slist-td-num">{seats7 || "—"}</td>
                    <td className="slist-td-num">{seats8 || "—"}</td>
                    <td className="slist-td-num slist-total">{(seats7 + seats8) || "—"}</td>
                  </tr>
                );
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
