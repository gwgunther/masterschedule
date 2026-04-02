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
  onSelectTeacher: (teacher: Teacher) => void;
  selectedTeacherId?: string;
  fixedKeys?: Set<string>;
  coteachKeys?: Set<string>;
  courseNames?: Map<string, string>;
}

const PERIODS = [1, 2, 3, 4, 5, 6, 7];

function pillClass(dept: string, isConf: boolean): string {
  if (isConf) return "course-pill pill-conf";
  const key = dept.replace(/ /g, "_");
  return `course-pill pill-${key}`;
}

function deptAbbrev(dept: string): string {
  const map: Record<string, string> = {
    "ENGLISH": "ENG",
    "MATH": "MATH",
    "SCIENCE": "SCI",
    "SOCIAL SCIENCE": "SOC",
    "CTE": "CTE",
    "PE/HEALTH": "PE",
    "VAPA": "VAPA",
    "WORLD LANGUAGE": "LANG",
    "SPED": "SPED",
  };
  return map[dept] ?? dept.slice(0, 4);
}

function courseLabel(courseId: string, courseNames?: Map<string, string>): string {
  if (!courseNames) return courseId;
  const title = courseNames.get(courseId);
  if (!title) return courseId;
  return title.length > 14 ? title.slice(0, 13) + "…" : title;
}

export default function ScheduleGrid({ sections, teachers, onSelectTeacher, selectedTeacherId, fixedKeys, coteachKeys, courseNames }: Props) {
  // lookup: teacher_id → period → Section
  const lookup = new Map<string, Map<number, Section>>();
  for (const s of sections) {
    if (!lookup.has(s.teacher_id)) lookup.set(s.teacher_id, new Map());
    lookup.get(s.teacher_id)!.set(s.period, s);
  }

  // group by department
  const byDept = new Map<string, Teacher[]>();
  for (const t of teachers) {
    const d = t.department || "OTHER";
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d)!.push(t);
  }
  const depts = [...byDept.keys()].sort();

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      <table className="schedule-table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Teacher</th>
            {PERIODS.map(p => <th key={p}>P{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {depts.map(dept => (
            <>
              <tr key={`dept-${dept}`} className="dept-row">
                <td colSpan={8}>{dept}</td>
              </tr>
              {byDept.get(dept)!.map(teacher => {
                const periodMap = lookup.get(teacher.teacher_id);
                const isSelected = teacher.teacher_id === selectedTeacherId;
                return (
                  <tr
                    key={teacher.teacher_id}
                    className={isSelected ? "selected" : ""}
                    onClick={() => onSelectTeacher(teacher)}
                  >
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span>{teacher.full_name || teacher.teacher_id}</span>
                        <span className="dept-badge">{deptAbbrev(teacher.department)}</span>
                      </span>
                    </td>
                    {PERIODS.map(p => {
                      const sec = periodMap?.get(p);
                      if (!sec) {
                        return <td key={p} className="period-cell"><span className="pill-empty">—</span></td>;
                      }
                      const isConf = sec.course_id === "CONFERENCE";
                      const isFixed = fixedKeys?.has(`${sec.teacher_id}|${sec.course_id}|${sec.period}`);
                      const isCoteach = coteachKeys?.has(`${sec.teacher_id}|${sec.course_id}`);
                      return (
                        <td key={p} className="period-cell">
                          <span className="period-cell-inner">
                            <span className={pillClass(teacher.department, isConf)}>
                              {isConf ? "Conference" : courseLabel(sec.course_id, courseNames)}
                            </span>
                            {!isConf && sec.total_students != null && sec.total_students > 0 && (
                              <span className="pill-students">
                                {sec.students_7th && sec.students_8th
                                  ? `${sec.students_7th} · ${sec.students_8th}`
                                  : `${sec.total_students}`}
                              </span>
                            )}
                            {(isFixed || isCoteach) && (
                              <span className="pill-icons">
                                {isFixed && <LockIcon />}
                                {isCoteach && <CoteachIcon />}
                              </span>
                            )}
                          </span>
                        </td>
                      );
                    })}
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

function LockIcon() {
  return (
    <svg className="pill-icon" width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 3c1.66 0 3 1.34 3 3v2H9V6c0-1.66 1.34-3 3-3zm6 17H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>
    </svg>
  );
}

function CoteachIcon() {
  return (
    <svg className="pill-icon" width="11" height="9" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  );
}
