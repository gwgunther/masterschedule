import { useEffect, useState, useRef } from "react";
import {
  fetchProjects,
  fetchScenarios,
  setContext,
  type Project,
  type Scenario,
  type ActiveContext,
} from "../api";

interface Props {
  context: ActiveContext;
  onContextChange: (ctx: ActiveContext) => void;
}

export default function ProjectScenarioSelector({ context, onContextChange }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showScenarioMenu, setShowScenarioMenu] = useState(false);
  const projectRef = useRef<HTMLDivElement>(null);
  const scenarioRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchProjects().then(setProjects);
  }, []);

  useEffect(() => {
    if (context.project) {
      fetchScenarios(context.project).then(setScenarios);
    }
  }, [context.project]);

  // Expose a refresh method for ManagePage to call after changes
  useEffect(() => {
    const refresh = () => {
      fetchProjects().then(setProjects);
      if (context.project) fetchScenarios(context.project).then(setScenarios);
    };
    window.addEventListener("projects-updated", refresh);
    return () => window.removeEventListener("projects-updated", refresh);
  }, [context.project]);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (projectRef.current && !projectRef.current.contains(e.target as Node))
        setShowProjectMenu(false);
      if (scenarioRef.current && !scenarioRef.current.contains(e.target as Node))
        setShowScenarioMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const switchProject = async (slug: string) => {
    setShowProjectMenu(false);
    const scs = await fetchScenarios(slug);
    setScenarios(scs);
    const firstScenario = scs[0]?.slug || "baseline";
    const newCtx = await setContext(slug, firstScenario);
    onContextChange(newCtx);
  };

  const switchScenario = async (slug: string) => {
    setShowScenarioMenu(false);
    if (!context.project) return;
    const newCtx = await setContext(context.project, slug);
    onContextChange(newCtx);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* Project selector */}
      <div ref={projectRef} style={{ position: "relative" }}>
        <button
          className="selector-btn"
          onClick={() => { setShowProjectMenu(!showProjectMenu); setShowScenarioMenu(false); }}
        >
          <span className="selector-label">Project</span>
          <span className="selector-value">{context.project_name || "None"}</span>
          <ChevronDown />
        </button>
        {showProjectMenu && (
          <div className="selector-menu">
            {projects.map((p) => (
              <div
                key={p.slug}
                className={`selector-item${p.slug === context.project ? " active" : ""}`}
                onClick={() => switchProject(p.slug)}
              >
                {p.name}
              </div>
            ))}
          </div>
        )}
      </div>

      <span style={{ color: "#ccc", fontSize: 14 }}>/</span>

      {/* Scenario selector */}
      <div ref={scenarioRef} style={{ position: "relative" }}>
        <button
          className="selector-btn"
          onClick={() => { setShowScenarioMenu(!showScenarioMenu); setShowProjectMenu(false); }}
        >
          <span className="selector-label">Scenario</span>
          <span className="selector-value">{context.scenario_name || "None"}</span>
          <ChevronDown />
        </button>
        {showScenarioMenu && (
          <div className="selector-menu">
            {scenarios.map((s) => (
              <div
                key={s.slug}
                className={`selector-item${s.slug === context.scenario ? " active" : ""}`}
                onClick={() => switchScenario(s.slug)}
              >
                {s.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
