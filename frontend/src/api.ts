/** Typed API wrappers for the FastAPI backend. */

export type TableName =
  | "courses"
  | "teachers"
  | "teacher_qualifications"
  | "teacher_section_locks"
  | "fixed_assignments"
  | "coteaching_combinations"
  | "semester_pairs"
  | "departments";

export interface Section {
  section_id: string;
  course_id: string;
  teacher_id: string;
  period: number;
  total_students?: number;
  students_7th?: number;
  students_8th?: number;
}

export interface ConstraintViolation {
  key: string;
  slack: number;
  message: string;
  context: string;
}

export interface DiagnosticGroup {
  group: string;
  label: string;
  source_table: string | null;
  total_slack: number;
  violation_count: number;
  violations: ConstraintViolation[];
}

export interface SolverStatus {
  status: "idle" | "running" | "done" | "error" | "infeasible";
  message: string;
  solve_time: number | null;
  error: string | null;
  run_id: string | null;
  phase: string | null;
  phase_message: string | null;
  diagnostics: DiagnosticGroup[] | null;
  has_best_attempt: boolean;
}

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
}

export interface ValidationResult {
  data_issues: ValidationIssue[];
  schedule_issues: ValidationIssue[];
  error_count: number;
  warning_count: number;
}

export interface Run {
  run_id: string;
  created: string;
  status: string;
  has_schedule: boolean;
  solve_time?: number;
  sections_count?: number;
}

// ── Project / Scenario / Context types ───────────────────────────────────────

export interface Project {
  slug: string;
  name: string;
  description: string;
  created: string;
}

export interface Scenario {
  slug: string;
  name: string;
  description: string;
  created: string;
}

export interface ActiveContext {
  project: string | null;
  scenario: string | null;
  project_name?: string | null;
  scenario_name?: string | null;
}

const base = "/api";

// ── Data endpoints ───────────────────────────────────────────────────────────

export async function fetchTable(table: TableName): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${base}/data/${table}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function saveTable(table: TableName, rows: Record<string, unknown>[]): Promise<void> {
  const res = await fetch(`${base}/data/${table}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function fetchSchedule(): Promise<{ exists: boolean; sections: Section[] }> {
  const res = await fetch(`${base}/schedule`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRunSchedule(runId: string): Promise<{ exists: boolean; sections: Section[] }> {
  const res = await fetch(`${base}/runs/${runId}/schedule`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startSolver(): Promise<void> {
  const res = await fetch(`${base}/solver/run`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
}

export async function fetchSolverStatus(): Promise<SolverStatus> {
  const res = await fetch(`${base}/solver/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function resetSolver(): Promise<void> {
  await fetch(`${base}/solver/reset`, { method: "POST" });
}

export async function fetchValidation(): Promise<ValidationResult> {
  const res = await fetch(`${base}/validate`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRuns(): Promise<Run[]> {
  const res = await fetch(`${base}/runs`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.runs;
}

export async function deleteRun(runId: string): Promise<void> {
  const res = await fetch(`${base}/runs/${runId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

/** Trigger a browser download of a single table as CSV. */
export function downloadTableCsv(table: TableName): void {
  const a = document.createElement("a");
  a.href = `${base}/export/${table}`;
  a.download = `${table}.csv`;
  a.click();
}

/** Trigger a browser download of all tables as a ZIP. */
export function downloadAllCsv(context?: ActiveContext | null): void {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const proj = slugify(context?.project_name || context?.project || "project");
  const scen = slugify(context?.scenario_name || context?.scenario || "scenario");
  const filename = `masterschedule_${proj}_${scen}_${date}_${time}.zip`;
  const a = document.createElement("a");
  a.href = `${base}/export`;
  a.download = filename;
  a.click();
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Context endpoints ────────────────────────────────────────────────────────

export async function fetchContext(): Promise<ActiveContext> {
  const res = await fetch(`${base}/context`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function setContext(project: string, scenario: string): Promise<ActiveContext> {
  const res = await fetch(`${base}/context`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, scenario }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Project endpoints ────────────────────────────────────────────────────────

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${base}/projects`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.projects;
}

export async function createProject(name: string, description: string = ""): Promise<Project> {
  const res = await fetch(`${base}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function renameProject(slug: string, name: string): Promise<Project> {
  const res = await fetch(`${base}/projects/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteProject(slug: string): Promise<void> {
  const res = await fetch(`${base}/projects/${slug}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

// ── Scenario endpoints ───────────────────────────────────────────────────────

export async function fetchScenarios(projectSlug: string): Promise<Scenario[]> {
  const res = await fetch(`${base}/projects/${projectSlug}/scenarios`);
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.scenarios;
}

export async function createScenario(
  projectSlug: string,
  name: string,
  cloneFrom?: string,
  description: string = "",
): Promise<Scenario> {
  const res = await fetch(`${base}/projects/${projectSlug}/scenarios`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, clone_from: cloneFrom || null, description }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function renameScenario(projectSlug: string, scenarioSlug: string, name: string): Promise<Scenario> {
  const res = await fetch(`${base}/projects/${projectSlug}/scenarios/${scenarioSlug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteScenario(projectSlug: string, scenarioSlug: string): Promise<void> {
  const res = await fetch(`${base}/projects/${projectSlug}/scenarios/${scenarioSlug}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function importScenarioCsv(
  projectSlug: string,
  scenarioSlug: string,
  table: string,
  file: File,
): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(
    `${base}/projects/${projectSlug}/scenarios/${scenarioSlug}/import/${table}`,
    { method: "POST", body: formData },
  );
  if (!res.ok) throw new Error(await res.text());
}
