import { useState, useEffect } from "react";
import EditableTable from "../components/EditableTable";
import TeacherQualificationsTable from "../components/TeacherQualificationsTable";
import CourseQualificationsTable from "../components/CourseQualificationsTable";
import { fetchTable, downloadTableCsv } from "../api";
import type { TableName } from "../api";

/** {value, label} options for dropdown columns */
export interface RefOption {
  value: string;
  label: string;
}

/** Map of column name → dropdown options */
export type ColumnRefs = Record<string, RefOption[]>;

interface TableDef {
  name: TableName;
  label: string;
  columns: string[];
  teacherCols?: string[];
  courseCols?: string[];
  fixedOptions?: Record<string, RefOption[]>;
  computedColumns?: string[];
  narrowColumns?: string[];
  columnLabels?: Record<string, string>;
  groupByColumn?: string;
}

const PERIOD_OPTIONS: RefOption[] = [1, 2, 3, 4, 5, 6, 7].map(p => ({ value: String(p), label: `P${p}` }));
const SECTION_COUNT_OPTIONS: RefOption[] = Array.from({ length: 20 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

const TABLES: TableDef[] = [
  {
    name: "courses",
    label: "Courses",
    columns: ["course_id", "course_title", "enrollment_7th", "enrollment_8th", "total_enrollment", "num_sections", "max_class_size", "status", "notes"],
    computedColumns: ["status"],
    fixedOptions: { num_sections: SECTION_COUNT_OPTIONS },
    narrowColumns: ["enrollment_7th", "enrollment_8th", "total_enrollment", "num_sections", "max_class_size"],
  },
  {
    name: "teachers",
    label: "Teachers",
    columns: ["teacher_id", "full_name", "department", "max_sections"],
  },
  {
    name: "departments",
    label: "Departments",
    columns: ["department_code", "display_name"],
  },
  {
    name: "teacher_section_locks",
    label: "Section Quotas",
    columns: ["teacher_id", "course_id", "num_sections", "notes"],
    teacherCols: ["teacher_id"],
    courseCols: ["course_id"],
    fixedOptions: { num_sections: SECTION_COUNT_OPTIONS },
    columnLabels: { teacher_id: "Teacher", course_id: "Course", num_sections: "Sections" },
  },
  {
    name: "fixed_assignments",
    label: "Fixed Assignments",
    columns: ["teacher_id", "course_id", "course_display", "period"],
    teacherCols: ["teacher_id"],
    courseCols: ["course_id"],
    fixedOptions: { period: PERIOD_OPTIONS },
    columnLabels: { teacher_id: "Teacher", course_id: "Course", course_display: "Display Name" },
  },
  {
    name: "coteaching_combinations",
    label: "Co-Teaching",
    columns: ["gened_course_code", "gened_teacher", "swd_course_code", "swd_teacher", "num_sections", "notes"],
    teacherCols: ["swd_teacher", "gened_teacher"],
    courseCols: ["gened_course_code", "swd_course_code"],
    fixedOptions: { num_sections: SECTION_COUNT_OPTIONS },
    groupByColumn: "gened_course_code",
    columnLabels: {
      gened_course_code: "Gen Ed Course",
      swd_course_code: "SWD Course",
      gened_teacher: "Gen Ed Teacher",
      swd_teacher: "SWD Teacher",
      num_sections: "Sections",
    },
  },
  {
    name: "semester_pairs",
    label: "Semester Pairs",
    columns: ["course_a", "teacher_a", "course_b", "teacher_b", "notes"],
    teacherCols: ["teacher_a", "teacher_b"],
    courseCols: ["course_a", "course_b"],
    columnLabels: { course_a: "Course A", teacher_a: "Teacher A", course_b: "Course B", teacher_b: "Teacher B" },
  },
];

interface Props {
  activeTable: TableName;
}

export default function DataPage({ activeTable }: Props) {
  const [teacherOptions, setTeacherOptions] = useState<RefOption[]>([]);
  const [courseOptions, setCourseOptions] = useState<RefOption[]>([]);
  const [deptOptions, setDeptOptions] = useState<RefOption[]>([]);

  useEffect(() => {
    fetchTable("teachers").then(rows => {
      const opts = (rows as { teacher_id: string; full_name?: string }[])
        .map(r => ({ value: r.teacher_id, label: r.full_name || r.teacher_id }))
        .sort((a, b) => a.value.localeCompare(b.value));
      setTeacherOptions(opts);
    });
    fetchTable("courses").then(rows => {
      const opts = (rows as { course_id: string; course_title?: string }[])
        .map(r => ({ value: r.course_id, label: r.course_title || r.course_id }))
        .sort((a, b) => a.value.localeCompare(b.value));
      setCourseOptions(opts);
    });
    fetchTable("departments").then(rows => {
      const opts = (rows as { department_code: string; display_name?: string }[])
        .map(r => ({ value: r.department_code, label: r.display_name || r.department_code }))
        .sort((a, b) => a.value.localeCompare(b.value));
      setDeptOptions(opts);
    });
  }, []);

  const tableDef = TABLES.find(t => t.name === activeTable)!;

  // Build column refs for the active table
  const columnRefs: ColumnRefs = {};
  for (const col of tableDef.teacherCols ?? []) columnRefs[col] = teacherOptions;
  for (const col of tableDef.courseCols ?? []) columnRefs[col] = courseOptions;
  if (tableDef.fixedOptions) {
    for (const [col, opts] of Object.entries(tableDef.fixedOptions)) columnRefs[col] = opts;
  }
  if (tableDef.columns.includes("department")) columnRefs["department"] = deptOptions;

  const refColumns = [
    ...(tableDef.teacherCols ?? []),
    ...(tableDef.courseCols ?? []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "20px 40px", overflow: "hidden" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTable === "teachers" ? (
          <TeacherQualificationsTable courseOptions={courseOptions} deptOptions={deptOptions} onExport={() => downloadTableCsv("teachers")} />
        ) : activeTable === "courses" ? (
          <CourseQualificationsTable teacherOptions={teacherOptions} onExport={() => downloadTableCsv("courses")} />
        ) : (
          <EditableTable
            key={activeTable}
            table={tableDef.name}
            columns={tableDef.columns}
            columnRefs={columnRefs}
            label={tableDef.label}
            computedColumns={tableDef.computedColumns}
            narrowColumns={tableDef.narrowColumns}
            refColumns={refColumns}
            columnLabels={tableDef.columnLabels}
            groupByColumn={tableDef.groupByColumn}
            searchable
            onExport={() => downloadTableCsv(tableDef.name)}
          />
        )}
      </div>
    </div>
  );
}
