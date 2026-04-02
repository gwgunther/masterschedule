import { useState, useEffect, useCallback } from "react";
import ScheduleGrid from "../components/ScheduleGrid";

import ValidationPanel from "../components/ValidationPanel";
import DiagnosticsPanel from "../components/DiagnosticsPanel";
import { fetchSchedule, fetchTable, fetchContext, fetchProjectSettings, toggleGridLock, clearGridLocks } from "../api";
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
  const [courseNames, setCourseNames] = useState<Map<string, string>>(new Map());
  const [courseEnrollment, setCourseEnrollment] = useState<Map<string, { enrollment_7th: number; enrollment_8th: number }>>(new Map());
  const [totalStudents, setTotalStudents] = useState<{ grade7: number; grade8: number } | undefined>();

  const showingBestAttempt = hasBestAttempt && (diagnostics?.length ?? 0) > 0;
  const hasDiagnostics = diagnostics && diagnostics.length > 0;

  const handleToggleLock = async (teacher_id: string, course_id: string, period: number) => {
    const result = await toggleGridLock(teacher_id, course_id, period);
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
                courseNames={courseNames}
                courseEnrollment={courseEnrollment}
                totalStudents={totalStudents}
                onToggleLock={handleToggleLock}
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
