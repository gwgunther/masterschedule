import { useRef, useState } from "react";
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
  gridLockedKeys?: Set<string>;
  coteachKeys?: Set<string>;
  /** "teacher_id|course_id" → partnerTeacherId */
  semesterPairs?: Map<string, string>;
  courseNames?: Map<string, string>;
  courseEnrollment?: Map<string, { enrollment_7th: number; enrollment_8th: number }>;
  /** Total unique students per grade (not course-enrollment sums) */
  totalStudents?: { grade7: number; grade8: number };
  onToggleLock?: (teacher_id: string, course_id: string, period: number) => void;
  onSwap?: (teacher_id: string, course_a: string, period_a: number, course_b: string, period_b: number) => void;
  coteachPairs?: Map<string, { partnerTeacher: string; partnerCourse: string }>;
}

const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const NON_INSTR = new Set(["CONFERENCE", "PROGRESS", "PROGRESSMON", "TITLE1", "COMMUNITY", "COMSCHOOLS", "5CS", "ASB", "ASBRELEASE", "REWARDS", "DLI"]);

function pillClass(dept: string, isConf: boolean): string {
  if (isConf) return "course-pill pill-conf";
  // Normalize: spaces → _, slashes → _, then map known variants
  const raw = dept.replace(/[ /]/g, "_").toUpperCase();
  const keyMap: Record<string, string> = {
    "PE_HEALTH": "PE",
    "PE": "PE",
    "SWD_MILD_MOD": "SPED",
    "SWD_MOD_SEV": "SPED",
    "SPED": "SPED",
    "SOCIAL_SCIENCE": "SOCIAL_SCIENCE",
    "WORLD_LANGUAGE": "WORLD_LANGUAGE",
  };
  const key = keyMap[raw] ?? raw;
  return `course-pill pill-${key}`;
}

function deptAbbrev(dept: string): string {
  const map: Record<string, string> = {
    "ENGLISH": "ENG", "MATH": "MATH", "SCIENCE": "SCI", "SOCIAL SCIENCE": "SOC",
    "CTE": "CTE", "PE/HEALTH": "PE", "VAPA": "VAPA", "WORLD LANGUAGE": "LANG",
    "SPED": "SPED", "SWD_MILD_MOD": "SWD", "SWD_MOD_SEV": "SWD",
  };
  return map[dept] ?? dept.slice(0, 4);
}

function courseLabel(courseId: string, courseNames?: Map<string, string>): string {
  if (!courseNames) return courseId;
  return courseNames.get(courseId) ?? courseId;
}

function sign(n: number) { return n > 0 ? "+" : ""; }
function netCls(n: number) { return n > 0 ? "summary-pos" : n < 0 ? "summary-neg" : ""; }

export default function ScheduleGrid({ sections, teachers, onSelectTeacher, selectedTeacherId, fixedKeys, gridLockedKeys, coteachKeys, semesterPairs, courseNames, totalStudents, onToggleLock, onSwap, coteachPairs }: Props) {
  const dragSrc = useRef<{ teacher_id: string; course_id: string; period: number } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [swapWarning, setSwapWarning] = useState<string | null>(null);
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

  // Per-period seat totals
  const periodSeats7 = new Map<number, number>();
  const periodSeats8 = new Map<number, number>();
  for (const s of sections) {
    if (NON_INSTR.has(s.course_id)) continue;
    periodSeats7.set(s.period, (periodSeats7.get(s.period) ?? 0) + (s.students_7th ?? 0));
    periodSeats8.set(s.period, (periodSeats8.get(s.period) ?? 0) + (s.students_8th ?? 0));
  }

  const enroll7 = totalStudents?.grade7 ?? 0;
  const enroll8 = totalStudents?.grade8 ?? 0;

  // Hero totals: sum across all periods
  const totalSeats7 = PERIODS.reduce((n, p) => n + (periodSeats7.get(p) ?? 0), 0);
  const totalSeats8 = PERIODS.reduce((n, p) => n + (periodSeats8.get(p) ?? 0), 0);
  // Compare total seats to enrollment * 7 (each student needs a seat every period)
  const neededTotal7 = enroll7 * PERIODS.length;
  const neededTotal8 = enroll8 * PERIODS.length;
  const netTotal7 = totalSeats7 - neededTotal7;
  const netTotal8 = totalSeats8 - neededTotal8;

  // Averages per period
  const n = PERIODS.length;
  const avgSeats7 = Math.round(totalSeats7 / n);
  const avgSeats8 = Math.round(totalSeats8 / n);
  const netAvg7 = avgSeats7 - enroll7;
  const netAvg8 = avgSeats8 - enroll8;

  const showSummary = sections.length > 0 && !!totalStudents;
  // Total columns: Teacher + 7 periods + Sections + 7th + 8th + Total = 12
  const TOTAL_COLS = 1 + PERIODS.length + 4;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {swapWarning && (
        <div style={{
          padding: "7px 40px", background: "#fef3c7", borderBottom: "1px solid #fcd34d",
          fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 12, color: "#92400e",
        }}>
          {swapWarning}
        </div>
      )}

      {/* ── Schedule grid (summary rows inline at top for column alignment) ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table className="schedule-table">
          <thead>
            <tr>
              <th />
              {PERIODS.map(p => <th key={p}>P{p}</th>)}
              <th colSpan={4} style={{ background: "transparent", border: "none" }} />
            </tr>
          </thead>

          {/* Summary rows — inside the table so period columns align exactly */}
          {showSummary && (
            <tbody className="summary-tbody">
              {/* Seats */}
              <tr className="sum-row">
                <td className="sum-label">Seats</td>
                {PERIODS.map(p => {
                  const s7 = periodSeats7.get(p) ?? 0;
                  const s8 = periodSeats8.get(p) ?? 0;
                  return (
                    <td key={p} className="sum-cell">
                      <span className="tfoot-trio">
                        <span className="tfoot-sub"><span className="tfoot-g">7</span>{s7}</span>
                        <span className="tfoot-sep">·</span>
                        <span className="tfoot-sub"><span className="tfoot-g">8</span>{s8}</span>
                        <span className="tfoot-sep">·</span>
                        <span className="tfoot-total">{s7 + s8}</span>
                      </span>
                    </td>
                  );
                })}
                {/* Stacked aggregate — rowspan covers all 3 summary rows */}
                <td className="sum-agg" colSpan={4} rowSpan={3}>
                  {[
                    { label: "Avg Seats / Period", vals: [
                      { g: "7", v: avgSeats7 }, { g: "8", v: avgSeats8 },
                      { g: "", v: avgSeats7 + avgSeats8, bold: true },
                    ]},
                    { label: "Enrollment", vals: [
                      { g: "7", v: enroll7 }, { g: "8", v: enroll8 },
                      { g: "", v: enroll7 + enroll8, bold: true },
                    ]},
                    { label: "Net / Period", vals: [
                      { g: "7", v: netAvg7, net: true }, { g: "8", v: netAvg8, net: true },
                      { g: "", v: netAvg7 + netAvg8, net: true, bold: true },
                    ]},
                  ].map(row => (
                    <div key={row.label} className="sum-agg-block">
                      <div className="sum-agg-label">{row.label}</div>
                      <div className="sum-agg-vals">
                        {row.vals.map((v, i) => (
                          <span key={i} className={`sum-agg-val${v.bold ? " sum-agg-bold" : ""}${v.net ? ` ${netCls(v.v)}` : ""}`}>
                            {v.g && <span className="tfoot-g">{v.g}</span>}
                            {v.net && v.v !== 0 ? sign(v.v) : ""}{v.v}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </td>
              </tr>
              {/* Enrollment */}
              <tr className="sum-row">
                <td className="sum-label">Enrollment</td>
                {PERIODS.map(p => (
                  <td key={p} className="sum-cell">
                    <span className="tfoot-trio">
                      <span className="tfoot-sub"><span className="tfoot-g">7</span>{enroll7}</span>
                      <span className="tfoot-sep">·</span>
                      <span className="tfoot-sub"><span className="tfoot-g">8</span>{enroll8}</span>
                      <span className="tfoot-sep">·</span>
                      <span className="tfoot-total">{enroll7 + enroll8}</span>
                    </span>
                  </td>
                ))}
              </tr>
              {/* Net */}
              <tr className="sum-row">
                <td className="sum-label">Net</td>
                {PERIODS.map(p => {
                  const d7 = (periodSeats7.get(p) ?? 0) - enroll7;
                  const d8 = (periodSeats8.get(p) ?? 0) - enroll8;
                  return (
                    <td key={p} className="sum-cell">
                      <span className="tfoot-trio">
                        <span className={netCls(d7)}><span className="tfoot-g">7</span>{sign(d7)}{d7}</span>
                        <span className="tfoot-sep">·</span>
                        <span className={netCls(d8)}><span className="tfoot-g">8</span>{sign(d8)}{d8}</span>
                        <span className="tfoot-sep">·</span>
                        <span className={`tfoot-total ${netCls(d7 + d8)}`}>{sign(d7 + d8)}{d7 + d8}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          )}

          <tbody>
            {/* Sub-header row: stat column labels aligned with grid */}
            <tr className="grid-subheader">
              <th style={{ textAlign: "left" }}>Teacher</th>
              {PERIODS.map(p => <th key={p}>P{p}</th>)}
              <th className="teacher-stat-th">Sect</th>
              <th className="teacher-stat-th">7th</th>
              <th className="teacher-stat-th">8th</th>
              <th className="teacher-stat-th">Total</th>
            </tr>
            {depts.map(dept => (
              <>
                <tr key={`dept-${dept}`} className="dept-row">
                  <td colSpan={TOTAL_COLS}>{dept}</td>
                </tr>
                {byDept.get(dept)!.map(teacher => {
                  const periodMap = lookup.get(teacher.teacher_id);
                  const isSelected = teacher.teacher_id === selectedTeacherId;
                  const instructional = sections.filter(
                    s => s.teacher_id === teacher.teacher_id && !NON_INSTR.has(s.course_id)
                  );
                  const tSeats7 = instructional.reduce((n, s) => n + (s.students_7th ?? 0), 0);
                  const tSeats8 = instructional.reduce((n, s) => n + (s.students_8th ?? 0), 0);

                  return (
                    <tr
                      key={teacher.teacher_id}
                      className={isSelected ? "selected" : ""}
                      onClick={() => onSelectTeacher(teacher)}
                    >
                      <td>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span>{teacher.full_name || teacher.teacher_id}</span>
                        </span>
                      </td>
                      {PERIODS.map(p => {
                        const sec = periodMap?.get(p);
                        if (!sec) {
                          return <td key={p} className="period-cell"><span className="pill-empty">—</span></td>;
                        }
                        const isConf = sec.course_id === "CONFERENCE";
                        const key = `${sec.teacher_id}|${sec.course_id}|${sec.period}`;
                        const isDataLocked = fixedKeys?.has(key) && !gridLockedKeys?.has(key);
                        const isGridLocked = gridLockedKeys?.has(key);
                        const isCoteach = coteachKeys?.has(`${sec.teacher_id}|${sec.course_id}|${sec.period}`);
                        const isSemesterPair = semesterPairs?.has(`${sec.teacher_id}|${sec.course_id}`) ?? false;
                        const isLockable = !!onToggleLock && !isDataLocked;
                        const dragKey = `${teacher.teacher_id}|${p}`;
                        const isDragOver = dragOverKey === dragKey;
                        return (
                          <td
                            key={p}
                            className={`period-cell${isGridLocked ? " grid-locked" : ""}${isLockable ? " lockable" : ""}${isDragOver ? " drag-over" : ""}`}
                            onClick={isLockable ? (e) => { e.stopPropagation(); onToggleLock(sec.teacher_id, sec.course_id, sec.period); } : undefined}
                            title={isDataLocked ? "Locked in data table" : isGridLocked ? "Click to unlock" : isCoteach ? "Co-taught — drags with partner" : isSemesterPair ? "Semester pair — drags with paired teacher" : isLockable ? "Click to lock" : undefined}
                            draggable={!!onSwap}
                            onDragStart={onSwap ? (e) => {
                              dragSrc.current = { teacher_id: teacher.teacher_id, course_id: sec.course_id, period: p };
                              e.dataTransfer.effectAllowed = "move";
                            } : undefined}
                            onDragOver={onSwap ? (e) => {
                              if (dragSrc.current && dragSrc.current.teacher_id === teacher.teacher_id && dragSrc.current.period !== p) {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                                setDragOverKey(dragKey);
                              }
                            } : undefined}
                            onDragLeave={onSwap ? () => setDragOverKey(null) : undefined}
                            onDragEnd={onSwap ? () => { dragSrc.current = null; setDragOverKey(null); } : undefined}
                            onDrop={onSwap ? (e) => {
                              e.preventDefault();
                              setDragOverKey(null);
                              const src = dragSrc.current;
                              dragSrc.current = null;
                              if (!src || src.teacher_id !== teacher.teacher_id || src.period === p) return;

                              // Check semester pair partner for conflicts
                              const semPartner = semesterPairs?.get(`${src.teacher_id}|${src.course_id}`);
                              if (semPartner) {
                                const partnerSrcKey = `${semPartner}|${src.course_id}|${src.period}`;
                                const partnerDstKey = `${semPartner}|${src.course_id}|${p}`;
                                // Also check what's in the partner's destination slot
                                const partnerDstSection = lookup.get(semPartner)?.get(p);
                                const partnerDstCourseKey = partnerDstSection ? `${semPartner}|${partnerDstSection.course_id}|${p}` : null;
                                const blocked =
                                  (fixedKeys?.has(partnerSrcKey) && !gridLockedKeys?.has(partnerSrcKey)) ||
                                  (fixedKeys?.has(partnerDstKey) && !gridLockedKeys?.has(partnerDstKey)) ||
                                  (partnerDstCourseKey && fixedKeys?.has(partnerDstCourseKey) && !gridLockedKeys?.has(partnerDstCourseKey));
                                if (blocked) {
                                  setSwapWarning("Cannot move — semester pair partner has a locked assignment in one of these periods.");
                                  setTimeout(() => setSwapWarning(null), 4000);
                                  return;
                                }
                              }

                              onSwap(teacher.teacher_id, src.course_id, src.period, sec.course_id, p);
                            } : undefined}
                          >
                            <span className="period-cell-inner">
                              {(isDataLocked || isGridLocked || isCoteach || isSemesterPair) && (
                                <span className="pill-icons">
                                  {isDataLocked && <LockIcon className="pill-icon-data" />}
                                  {isGridLocked && <GridLockIcon />}
                                  {isCoteach && <CoteachIcon />}
                                  {isSemesterPair && <SemesterPairIcon />}
                                </span>
                              )}
                              <span className={pillClass(teacher.department, isConf)}>
                                {isConf ? "Conference" : courseLabel(sec.course_id, courseNames)}
                              </span>
                              {!isConf && sec.total_students != null && sec.total_students > 0 && (
                                <span className="pill-students">
                                  {sec.students_7th != null && sec.students_8th != null
                                    ? <><span className="pill-grade-label">7</span>{sec.students_7th}<span className="pill-grade-sep"> · </span><span className="pill-grade-label">8</span>{sec.students_8th}</>
                                    : `${sec.total_students}`}
                                </span>
                              )}
                            </span>
                          </td>
                        );
                      })}
                      {/* Per-teacher stats */}
                      <td className="teacher-stat-cell">{instructional.length || "—"}</td>
                      <td className="teacher-stat-cell">{tSeats7 || "—"}</td>
                      <td className="teacher-stat-cell">{tSeats8 || "—"}</td>
                      <td className="teacher-stat-cell teacher-stat-total">{(tSeats7 + tSeats8) || "—"}</td>
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LockIcon({ className = "pill-icon" }: { className?: string }) {
  return (
    <svg className={className} width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 3c1.66 0 3 1.34 3 3v2H9V6c0-1.66 1.34-3 3-3zm6 17H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>
    </svg>
  );
}

/** Open padlock icon — used for grid locks (unlockable) */
function GridLockIcon() {
  return (
    <svg className="pill-icon-grid" width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1C9.24 1 7 3.24 7 6v1H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2h-1V6c0-2.76-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3v1H9V6c0-1.66 1.34-3 3-3zm0 9c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2z"/>
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

/** Swap arrows icon — used for semester pairs (two teachers sharing same course periods) */
function SemesterPairIcon() {
  return (
    <svg className="pill-icon" width="11" height="9" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z"/>
    </svg>
  );
}
