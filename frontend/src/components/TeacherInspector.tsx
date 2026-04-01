import { X } from "lucide-react";
import type { Section } from "../api";

interface Teacher {
  teacher_id: string;
  full_name: string;
  department: string;
  max_sections: number;
}

interface Props {
  teacher: Teacher | null;
  sections: Section[];
  onClose: () => void;
}

const DEPT_TAG_STYLE: Record<string, { background: string; color: string }> = {
  MATH:             { background: "#eff6ff", color: "#1e40af" },
  SCIENCE:          { background: "#f0fdf4", color: "#166534" },
  ENGLISH:          { background: "#fdf4ff", color: "#6b21a8" },
  "SOCIAL SCIENCE": { background: "#fffbeb", color: "#92400e" },
  PE:               { background: "#ecfdf5", color: "#065f46" },
  SPED:             { background: "#fff1f2", color: "#9f1239" },
  CTE:              { background: "#fff7ed", color: "#9a3412" },
  VAPA:             { background: "#fdf2f8", color: "#86198f" },
  HEALTH:           { background: "#f0fdfa", color: "#134e4a" },
  "WORLD LANGUAGE": { background: "#ecfeff", color: "#164e63" },
  ELD:              { background: "#eef2ff", color: "#3730a3" },
};

export default function TeacherInspector({ teacher, sections, onClose }: Props) {
  if (!teacher) return null;

  const mySections = sections
    .filter(s => s.teacher_id === teacher.teacher_id)
    .sort((a, b) => a.period - b.period);

  const teachingSections = mySections.filter(s => s.course_id !== "CONFERENCE");
  const totalStudents = teachingSections.reduce((sum, s) => sum + (s.total_students ?? 0), 0);
  const maxSections = Number(teacher.max_sections);
  const tagStyle = DEPT_TAG_STYLE[teacher.department] ?? { background: "#f1f5f9", color: "#334155" };
  const displayName = teacher.full_name || teacher.teacher_id;

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div className="inspector-teacher-id">{displayName}</div>
            <span className="inspector-dept-tag" style={tagStyle}>
              {teacher.department}
            </span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#aaa", padding: 0, marginTop: 2 }}>
            <X size={15} />
          </button>
        </div>
      </div>

      <div className="inspector-stats">
        <div className="inspector-stat">
          <div className="inspector-stat-val">
            {teachingSections.length}
            <span style={{ fontSize: 14, color: "#aaa" }}>/{maxSections}</span>
          </div>
          <div className="inspector-stat-label">Sections</div>
        </div>
        <div className="inspector-stat">
          <div className="inspector-stat-val">{totalStudents}</div>
          <div className="inspector-stat-label">Students</div>
        </div>
      </div>

      <div className="inspector-periods">
        <div style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "#bbb", marginBottom: 10 }}>
          Schedule
        </div>
        {[1, 2, 3, 4, 5, 6, 7].map(p => {
          const sec = mySections.find(s => s.period === p);
          return (
            <div key={p} className="inspector-period-row">
              <div className="inspector-period-num">P{p}</div>
              {sec ? (
                <div className="inspector-period-content">
                  <div className="inspector-course-id">
                    {sec.course_id}
                  </div>
                  {sec.course_id === "CONFERENCE" ? (
                    <div className="inspector-course-meta">Conference / Prep</div>
                  ) : sec.total_students != null ? (
                    <div className="inspector-course-meta">
                      {sec.total_students} students
                      {sec.students_7th ? ` · 7th: ${sec.students_7th}` : ""}
                      {sec.students_8th ? ` · 8th: ${sec.students_8th}` : ""}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="inspector-period-empty">—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
