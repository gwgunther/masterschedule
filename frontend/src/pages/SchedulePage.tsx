import { useState, useEffect, useCallback } from "react";
import ScheduleGrid from "../components/ScheduleGrid";
import ValidationPanel from "../components/ValidationPanel";
import DiagnosticsPanel from "../components/DiagnosticsPanel";
import { fetchSchedule, fetchTable } from "../api";
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
  const [coteachKeys, setCoteachKeys] = useState<Set<string>>(new Set());
  const [courseNames, setCourseNames] = useState<Map<string, string>>(new Map());
  const [courseEnrollment, setCourseEnrollment] = useState<Map<string, { enrollment_7th: number; enrollment_8th: number }>>(new Map());
  const [totalStudents, setTotalStudents] = useState<{ grade7: number; grade8: number } | undefined>();

  const showingBestAttempt = hasBestAttempt && (diagnostics?.length ?? 0) > 0;
  const hasDiagnostics = diagnostics && diagnostics.length > 0;

  const loadSchedule = useCallback(async () => {
    const result = await fetchSchedule();
    setScheduleExists(result.exists);
    setSections(result.sections as Section[]);
  }, []);

  // Load schedule data + reference data on mount and when solver finishes
  useEffect(() => {
    loadSchedule();
    fetchTable("teachers").then(rows => setTeachers(rows as unknown as Teacher[]));
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
      // Unique students per grade = total course-enrollments / 7 periods
      const NON_INSTR = new Set(["CONFERENCE", "PROGRESS", "PROGRESSMON", "TITLE1", "COMMUNITY", "COMSCHOOLS", "5CS", "ASB", "ASBRELEASE", "REWARDS", "DLI"]);
      let sum7 = 0, sum8 = 0;
      for (const r of rows) {
        if (!r.course_id || NON_INSTR.has(String(r.course_id))) continue;
        sum7 += Number(r.enrollment_7th) || 0;
        sum8 += Number(r.enrollment_8th) || 0;
      }
      setTotalStudents({ grade7: Math.round(sum7 / 7), grade8: Math.round(sum8 / 7) });
    });
    fetchTable("fixed_assignments").then(rows => {
      const keys = new Set<string>();
      for (const r of rows) keys.add(`${r.teacher_id}|${r.course_id}|${r.period}`);
      setFixedKeys(keys);
    });
    fetchTable("coteaching_combinations").then(rows => {
      const keys = new Set<string>();
      for (const r of rows) {
        keys.add(`${r.sped_teacher}|${r.coteach_id}`);
        keys.add(`${r.gened_teacher}|${r.gened_course}`);
      }
      setCoteachKeys(keys);
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
              <ScheduleGrid
                sections={sections}
                teachers={teachers}
                onSelectTeacher={() => {}}
                selectedTeacherId={undefined}
                fixedKeys={fixedKeys}
                coteachKeys={coteachKeys}
                courseNames={courseNames}
                courseEnrollment={courseEnrollment}
                totalStudents={totalStudents}
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
