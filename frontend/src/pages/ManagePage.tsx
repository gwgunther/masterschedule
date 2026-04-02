import { useEffect, useState } from "react";
import {
  fetchProjects,
  fetchScenarios,
  createProject,
  createScenario,
  renameProject,
  renameScenario,
  deleteProject,
  deleteScenario,
  setContext,
  type Project,
  type Scenario,
  type ActiveContext,
} from "../api";

interface Props {
  context: ActiveContext;
  onContextChange: (ctx: ActiveContext) => void;
}

export default function ManagePage({ context, onContextChange }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  // New project form
  const [newProjectName, setNewProjectName] = useState("");
  const [showNewProject, setShowNewProject] = useState(false);

  // New scenario form
  const [newScenarioName, setNewScenarioName] = useState("");
  const [cloneFrom, setCloneFrom] = useState<string>("");
  const [showNewScenario, setShowNewScenario] = useState(false);

  // Inline rename state
  const [renamingProject, setRenamingProject] = useState<string | null>(null);
  const [renameProjectValue, setRenameProjectValue] = useState("");
  const [renamingScenario, setRenamingScenario] = useState<string | null>(null);
  const [renameScenarioValue, setRenameScenarioValue] = useState("");

  useEffect(() => {
    fetchProjects().then((ps) => {
      setProjects(ps);
      const active = context.project || ps[0]?.slug || null;
      setSelectedProject(active);
    });
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetchScenarios(selectedProject).then(setScenarios);
    } else {
      setScenarios([]);
    }
  }, [selectedProject]);

  const reload = async () => {
    const ps = await fetchProjects();
    setProjects(ps);
    if (selectedProject) {
      const scs = await fetchScenarios(selectedProject);
      setScenarios(scs);
    }
    window.dispatchEvent(new Event("projects-updated"));
  };

  // ── Projects ──────────────────────────────────────────────────────────────

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    const proj = await createProject(newProjectName.trim());
    setNewProjectName("");
    setShowNewProject(false);
    setSelectedProject(proj.slug);
    const newCtx = await setContext(proj.slug, "baseline");
    onContextChange(newCtx);
    await reload();
  };

  const startRenamingProject = (slug: string, current: string) => {
    setRenamingProject(slug);
    setRenameProjectValue(current);
  };

  const commitRenameProject = async () => {
    if (!renamingProject || !renameProjectValue.trim()) {
      setRenamingProject(null);
      return;
    }
    const original = projects.find((p) => p.slug === renamingProject)?.name;
    if (renameProjectValue.trim() === original) {
      setRenamingProject(null);
      return;
    }
    await renameProject(renamingProject, renameProjectValue.trim());
    const slug = renamingProject;
    setRenamingProject(null);
    await reload();
    if (context.project === slug) {
      const ctx = await setContext(slug, context.scenario!);
      onContextChange(ctx);
    }
  };

  const handleDeleteProject = async (slug: string, name: string) => {
    if (!confirm(`Delete project "${name}" and ALL its scenarios and runs? This cannot be undone.`)) return;
    await deleteProject(slug);
    const remaining = await fetchProjects();
    setProjects(remaining);
    if (selectedProject === slug) {
      const next = remaining[0]?.slug || null;
      setSelectedProject(next);
      if (next) {
        const scs = await fetchScenarios(next);
        setScenarios(scs);
        const newCtx = await setContext(next, scs[0]?.slug || "baseline");
        onContextChange(newCtx);
      } else {
        onContextChange({ project: null, scenario: null });
      }
    }
    window.dispatchEvent(new Event("projects-updated"));
  };

  // ── Scenarios ─────────────────────────────────────────────────────────────

  const handleCreateScenario = async () => {
    if (!newScenarioName.trim() || !selectedProject) return;
    const sc = await createScenario(selectedProject, newScenarioName.trim(), cloneFrom || undefined);
    setNewScenarioName("");
    setCloneFrom("");
    setShowNewScenario(false);
    const newCtx = await setContext(selectedProject, sc.slug);
    onContextChange(newCtx);
    await reload();
  };

  const startRenamingScenario = (slug: string, current: string) => {
    setRenamingScenario(slug);
    setRenameScenarioValue(current);
  };

  const commitRenameScenario = async () => {
    if (!renamingScenario || !selectedProject || !renameScenarioValue.trim()) {
      setRenamingScenario(null);
      return;
    }
    const original = scenarios.find((s) => s.slug === renamingScenario)?.name;
    if (renameScenarioValue.trim() === original) {
      setRenamingScenario(null);
      return;
    }
    await renameScenario(selectedProject, renamingScenario, renameScenarioValue.trim());
    const slug = renamingScenario;
    setRenamingScenario(null);
    await reload();
    if (context.project === selectedProject && context.scenario === slug) {
      const newCtx = await setContext(selectedProject, slug);
      onContextChange(newCtx);
    }
  };

  const handleDeleteScenario = async (slug: string, name: string) => {
    if (!selectedProject) return;
    if (!confirm(`Delete scenario "${name}" and all its runs? This cannot be undone.`)) return;
    try {
      await deleteScenario(selectedProject, slug);
      const scs = await fetchScenarios(selectedProject);
      setScenarios(scs);
      if (context.project === selectedProject && context.scenario === slug && scs.length > 0) {
        const newCtx = await setContext(selectedProject, scs[0].slug);
        onContextChange(newCtx);
      }
      window.dispatchEvent(new Event("projects-updated"));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cannot delete");
    }
  };

  const handleActivate = async (projectSlug: string, scenarioSlug: string) => {
    const newCtx = await setContext(projectSlug, scenarioSlug);
    onContextChange(newCtx);
  };

  const selectedProj = projects.find((p) => p.slug === selectedProject);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── Left: Projects ─────────────────────────────────────── */}
      <div style={{ width: 360, minWidth: 260, borderRight: "1px solid #e0ddd5", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "24px 24px 12px", borderBottom: "1px solid #e0ddd5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", fontWeight: 600 }}>
            Projects
          </span>
          <button className="btn-small" onClick={() => { setShowNewProject(true); setNewProjectName(""); }}>
            + New
          </button>
        </div>

        {showNewProject && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e0ddd5", display: "flex", gap: 8 }}>
            <input
              className="selector-input"
              placeholder="Project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateProject(); if (e.key === "Escape") setShowNewProject(false); }}
              autoFocus
              style={{ flex: 1 }}
            />
            <button className="btn-small" onClick={handleCreateProject}>Create</button>
            <button className="manage-cancel" onClick={() => setShowNewProject(false)}>✕</button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto" }}>
          {projects.map((p) => (
            <div
              key={p.slug}
              className={`manage-project-row${p.slug === selectedProject ? " selected" : ""}`}
              onClick={() => setSelectedProject(p.slug)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {renamingProject === p.slug ? (
                  <input
                    className="selector-input"
                    value={renameProjectValue}
                    onChange={(e) => setRenameProjectValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRenameProject(); if (e.key === "Escape") setRenamingProject(null); }}
                    onBlur={commitRenameProject}
                    autoFocus
                    style={{ fontSize: 13, width: "100%" }}
                  />
                ) : (
                  <>
                    <div style={{ fontWeight: p.slug === context.project ? 600 : 400, fontSize: 13, wordBreak: "break-word" }}>
                      {p.name}
                      {p.slug === context.project && <span className="manage-active-badge">active</span>}
                    </div>
                    <div style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 10, color: "#aaa", marginTop: 2 }}>
                      {new Date(p.created).toLocaleDateString()}
                    </div>
                  </>
                )}
              </div>
              <div className="manage-row-actions" onClick={(e) => e.stopPropagation()}>
                <button className="manage-icon-btn" title="Rename" onClick={() => startRenamingProject(p.slug, p.name)}>
                  <PencilIcon />
                </button>
                <button className="manage-icon-btn danger" title="Delete" onClick={() => handleDeleteProject(p.slug, p.name)}>
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: Scenarios ───────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "24px 32px 12px", borderBottom: "1px solid #e0ddd5", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#888", fontWeight: 600 }}>
              Scenarios
            </span>
            {selectedProj && (
              <span style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 11, color: "#aaa", marginLeft: 10 }}>
                {selectedProj.name}
              </span>
            )}
          </div>
          {selectedProject && (
            <button className="btn-small" onClick={() => { setShowNewScenario(true); setNewScenarioName(""); setCloneFrom(context.scenario || ""); }}>
              + New Scenario
            </button>
          )}
        </div>

        {showNewScenario && selectedProject && (
          <div style={{ padding: "12px 32px", borderBottom: "1px solid #e0ddd5", display: "flex", gap: 10, alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
              <input
                className="selector-input"
                placeholder="Scenario name"
                value={newScenarioName}
                onChange={(e) => setNewScenarioName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateScenario(); if (e.key === "Escape") setShowNewScenario(false); }}
                autoFocus
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 11, color: "#888", whiteSpace: "nowrap" }}>
                  Clone from:
                </label>
                <select
                  className="selector-input"
                  value={cloneFrom}
                  onChange={(e) => setCloneFrom(e.target.value)}
                  style={{ flex: 1 }}
                >
                  <option value="">Empty (blank)</option>
                  {scenarios.map((s) => (
                    <option key={s.slug} value={s.slug}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button className="btn-small" onClick={handleCreateScenario} style={{ height: 32 }}>Create</button>
            <button className="manage-cancel" onClick={() => setShowNewScenario(false)}>✕</button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {!selectedProject && (
            <div style={{ padding: "48px 32px", fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 13, color: "#bbb" }}>
              Select a project to see its scenarios.
            </div>
          )}
          {selectedProject && scenarios.length === 0 && (
            <div style={{ padding: "48px 32px", fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 13, color: "#bbb" }}>
              No scenarios yet.
            </div>
          )}
          {scenarios.map((s) => {
            const isActive = context.project === selectedProject && context.scenario === s.slug;
            return (
              <div key={s.slug} className="manage-scenario-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingScenario === s.slug ? (
                    <input
                      className="selector-input"
                      value={renameScenarioValue}
                      onChange={(e) => setRenameScenarioValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitRenameScenario(); if (e.key === "Escape") setRenamingScenario(null); }}
                      onBlur={commitRenameScenario}
                      autoFocus
                      style={{ fontSize: 13, width: "100%" }}
                    />
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: isActive ? 600 : 400, fontSize: 13 }}>{s.name}</span>
                        {isActive && <span className="manage-active-badge">active</span>}
                      </div>
                      <div style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", fontSize: 10, color: "#aaa", marginTop: 2 }}>
                        Created {new Date(s.created).toLocaleDateString()}
                      </div>
                    </>
                  )}
                </div>
                <div className="manage-row-actions">
                  {!isActive && selectedProject && (
                    <button
                      className="manage-activate-btn"
                      onClick={() => handleActivate(selectedProject, s.slug)}
                    >
                      Use
                    </button>
                  )}
                  <button className="manage-icon-btn" title="Rename" onClick={() => startRenamingScenario(s.slug, s.name)}>
                    <PencilIcon />
                  </button>
                  <button
                    className="manage-icon-btn danger"
                    title="Delete"
                    onClick={() => handleDeleteScenario(s.slug, s.name)}
                    disabled={scenarios.length <= 1}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}
