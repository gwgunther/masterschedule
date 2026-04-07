import { useState, useEffect, useCallback } from "react";
import ScheduleGrid from "../components/ScheduleGrid";

import ValidationPanel from "../components/ValidationPanel";
import DiagnosticsPanel from "../components/DiagnosticsPanel";
import { fetchSchedule, fetchTable, fetchContext, fetchProjectSettings, toggleGridLock, clearGridLocks, swapGridLock } from "../api";
import type { Section, DiagnosticGroup } from "../api";

interface Teacher {
  teacher_id: string;
  full_name: string;
  department: string;
  max_sections: number;
}

interface Props {
  activeTab: "schedule" | "diagnostics" | "validation";
  /** Increments when solver finishes — triggers data reload */
  scheduleVersion: number;
  diagnostics: DiagnosticGroup[] | null;
  hasBestAttempt: boolean;
}

export default function SchedulePage({ activeTab, scheduleVersion, diagnostics, hasBestAttempt }: Props) {
  const [sections, setSections] = useState<Section[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [scheduleExists, setScheduleExists] = useState(false);
  const [fixedKeys, setFixedKeys] = useState<Set<string>>(new Set());
  const [gridLockedKeys, setGridLockedKeys] = useState<Set<string>>(new Set());
  const [coteachKeys, setCoteachKeys] = useState<Set<string>>(new Set());
  // Full coteach pairs: "teacher_id|course_id" → { partnerTeacher, partnerCourse }
  const [coteachPairs, setCoteachPairs] = useState<Map<string, { partnerTeacher: string; partnerCourse: string }>>(new Map());
  // semesterPairs: "teacher_id|course_id" → partnerTeacherId (same course_id)
  const [semesterPairs, setSemesterPairs] = useState<Map<string, string>>(new Map());
  const [courseNames, setCourseNames] = useState<Map<string, string>>(new Map());
  const [courseEnrollment, setCourseEnrollment] = useState<Map<string, { enrollment_7th: number; enrollment_8th: number }>>(new Map());
  const [totalStudents, setTotalStudents] = useState<{ grade7: number; grade8: number } | undefined>();

  // Derive period-specific co-teach keys from actual schedule data
  // key: "teacher_id|course_id|period" — only periods where the partner also appears in the same period
  useEffect(() => {
    if (sections.length === 0 || coteachPairs.size === 0) { setCoteachKeys(new Set()); return; }
    // Build set of all "teacher|course|period" triples in the schedule
    const scheduleTriples = new Set<string>(sections.map(s => `${s.teacher_id}|${s.course_id}|${s.period}`));
    const keys = new Set<string>();
    for (const s of sections) {
      const pairKey = `${s.teacher_id}|${s.course_id}`;
      const partner = coteachPairs.get(pairKey);
      if (!partner) continue;
      // Check if partner has a section in the same period
      if (scheduleTriples.has(`${partner.partnerTeacher}|${partner.partnerCourse}|${s.period}`)) {
        keys.add(`${s.teacher_id}|${s.course_id}|${s.period}`);
      }
    }
    setCoteachKeys(keys);
  }, [sections, coteachPairs]);

  const showingBestAttempt = hasBestAttempt && (diagnostics?.length ?? 0) > 0;
  const hasDiagnostics = diagnostics && diagnostics.length > 0;

  const handleToggleLock = async (teacher_id: string, course_id: string, period: number) => {
    const result = await toggleGridLock(teacher_id, course_id, period);
    setFixedKeys(new Set(result.fixedKeys));
    setGridLockedKeys(new Set(result.gridLockedKeys));
  };

  const handleSwap = async (teacher_id: string, course_a: string, period_a: number, course_b: string, period_b: number) => {
    // Find co-teach partners for both cells (if any)
    const partnerA = coteachPairs.get(`${teacher_id}|${course_a}`);
    const partnerB = coteachPairs.get(`${teacher_id}|${course_b}`);
    // Find semester pair partners (same course_id, different teacher)
    const semPartnerA = semesterPairs.get(`${teacher_id}|${course_a}`);
    const semPartnerB = semesterPairs.get(`${teacher_id}|${course_b}`);

    // Optimistic update — swap this teacher's sections
    setSections(prev => prev.map(s => {
      if (s.teacher_id === teacher_id) {
        if (s.course_id === course_a && s.period === period_a) return { ...s, period: period_b };
        if (s.course_id === course_b && s.period === period_b) return { ...s, period: period_a };
      }
      // Also swap co-teach partners
      if (partnerA && s.teacher_id === partnerA.partnerTeacher && s.course_id === partnerA.partnerCourse && s.period === period_a) {
        return { ...s, period: period_b };
      }
      if (partnerB && s.teacher_id === partnerB.partnerTeacher && s.course_id === partnerB.partnerCourse && s.period === period_b) {
        return { ...s, period: period_a };
      }
      // Also swap semester pair partners (same course, different teacher)
      if (semPartnerA && s.teacher_id === semPartnerA && s.course_id === course_a && s.period === period_a) {
        return { ...s, period: period_b };
      }
      if (semPartnerB && s.teacher_id === semPartnerB && s.course_id === course_b && s.period === period_b) {
        return { ...s, period: period_a };
      }
      return s;
    }));

    // API calls — swap this teacher, then partners if needed
    let result = await swapGridLock(teacher_id, course_a, period_a, course_b, period_b);
    if (partnerA) {
      result = await swapGridLock(partnerA.partnerTeacher, partnerA.partnerCourse, period_a, partnerB?.partnerCourse ?? partnerA.partnerCourse, period_b);
    }
    if (semPartnerA) {
      result = await swapGridLock(semPartnerA, course_a, period_a, semPartnerB ? course_b : course_a, period_b);
    }
    setFixedKeys(new Set(result.fixedKeys));
    setGridLockedKeys(new Set(result.gridLockedKeys));
  };

  const handleClearLocks = async () => {
    const result = await clearGridLocks();
    setFixedKeys(new Set(result.fixedKeys));
    setGridLockedKeys(new Set(result.gridLockedKeys));
  };

  const loadSchedule = useCallback(async () => {
    const result = await fetchSchedule();
    setScheduleExists(result.exists);
    setSections(result.sections as Section[]);
  }, []);

  // Load schedule data + reference data on mount and when solver finishes
  useEffect(() => {
    loadSchedule();
    // Load teachers + section locks, then derive max_sections from quotas
    Promise.all([
      fetchTable("teachers"),
      fetchTable("teacher_section_locks"),
    ]).then(([teacherRows, lockRows]) => {
      const quotaSums = new Map<string, number>();
      for (const r of lockRows) {
        if (r.course_id === "CONFERENCE") continue;
        const t = String(r.teacher_id);
        quotaSums.set(t, (quotaSums.get(t) ?? 0) + (Number(r.num_sections) || 0));
      }
      const derived = (teacherRows as unknown as Teacher[]).map(t => ({
        ...t,
        max_sections: quotaSums.get(t.teacher_id) ?? 0,
      }));
      setTeachers(derived);
    });
    fetchTable("courses").then(rows => {
      const map = new Map<string, string>();
      const enr = new Map<string, { enrollment_7th: number; enrollment_8th: number }>();
      for (const r of rows) {
        if (r.course_id && r.course_title) map.set(String(r.course_id), String(r.course_title));
        if (r.course_id) enr.set(String(r.course_id), {
          enrollment_7th: Number(r.enrollment_7th) || 0,
          enrollment_8th: Number(r.enrollment_8th) || 0,
        });
      }
      setCourseNames(map);
      setCourseEnrollment(enr);
    });
    // Load total students from project settings
    fetchContext().then(ctx => {
      if (!ctx.project) return;
      fetchProjectSettings(ctx.project).then(settings => {
        if (settings.total_students_7th != null && settings.total_students_8th != null) {
          setTotalStudents({ grade7: Number(settings.total_students_7th), grade8: Number(settings.total_students_8th) });
        }
      });
    });
    fetchTable("fixed_assignments").then(rows => {
      const allKeys = new Set<string>();
      const gridKeys = new Set<string>();
      for (const r of rows) {
        const k = `${r.teacher_id}|${r.course_id}|${r.period}`;
        allKeys.add(k);
        if (r.source === "grid") gridKeys.add(k);
      }
      setFixedKeys(allKeys);
      setGridLockedKeys(gridKeys);
    });
    fetchTable("semester_pairs").then(rows => {
      const map = new Map<string, string>();
      for (const r of rows) {
        const cid = String(r.course_id ?? "");
        if (r.teacher_a && r.teacher_b) {
          map.set(`${r.teacher_a}|${cid}`, String(r.teacher_b));
          map.set(`${r.teacher_b}|${cid}`, String(r.teacher_a));
        }
      }
      setSemesterPairs(map);
    });
    fetchTable("coteaching_combinations").then(rows => {
      const pairs = new Map<string, { partnerTeacher: string; partnerCourse: string }>();
      for (const r of rows) {
        const genKey = `${r.gened_teacher}|${r.gened_course_code}`;
        const swdKey = `${r.swd_teacher}|${r.swd_course_code}`;
        pairs.set(genKey, { partnerTeacher: String(r.swd_teacher), partnerCourse: String(r.swd_course_code) });
        pairs.set(swdKey, { partnerTeacher: String(r.gened_teacher), partnerCourse: String(r.gened_course_code) });
      }
      setCoteachPairs(pairs);
    });
  }, [loadSchedule, scheduleVersion]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {activeTab === "schedule" && (
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {!scheduleExists ? (
            <div className="empty-state">
              <div style={{ fontSize: 32, marginBottom: 4 }}>—</div>
              <div className="empty-state-title">No schedule generated yet</div>
              <div className="empty-state-sub">Click Run Solver to produce a schedule</div>
            </div>
          ) : (
            <>
              {showingBestAttempt && (
                <div style={{
                  padding: "8px 40px",
                  background: "#fffbeb",
                  borderBottom: "1px solid #fde68a",
                  fontFamily: "'Helvetica Neue', Arial, sans-serif",
                  fontSize: 12,
                  color: "#92400e",
                }}>
                  Showing best attempt — this schedule has constraint violations
                </div>
              )}
              {gridLockedKeys.size > 0 && (
                <div style={{
                  padding: "6px 40px",
                  background: "#eff6ff",
                  borderBottom: "1px solid #bfdbfe",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontFamily: "'Helvetica Neue', Arial, sans-serif",
                  fontSize: 12,
                  color: "#1e40af",
                }}>
                  <span>{gridLockedKeys.size} assignment{gridLockedKeys.size !== 1 ? "s" : ""} locked — re-run solver to apply</span>
                  <button className="unlock-all-btn" onClick={handleClearLocks}>Unlock All</button>
                </div>
              )}
              <ScheduleGrid
                sections={sections}
                teachers={teachers}
                onSelectTeacher={() => {}}
                selectedTeacherId={undefined}
                fixedKeys={fixedKeys}
                gridLockedKeys={gridLockedKeys}
                coteachKeys={coteachKeys}
                semesterPairs={semesterPairs}
                courseNames={courseNames}
                courseEnrollment={courseEnrollment}
                totalStudents={totalStudents}
                onToggleLock={handleToggleLock}
                onSwap={handleSwap}
                coteachPairs={coteachPairs}
              />
            </>
          )}
        </div>
      )}

      {activeTab === "diagnostics" && hasDiagnostics && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <DiagnosticsPanel
            diagnostics={diagnostics}
            hasBestAttempt={hasBestAttempt}
            onShowBestAttempt={() => {/* parent switches tab */}}
          />
        </div>
      )}

      {activeTab === "validation" && (
        <div style={{ flex: 1, overflow: "auto" }}>
          <ValidationPanel fullPage />
        </div>
      )}
    </div>
  );
}
