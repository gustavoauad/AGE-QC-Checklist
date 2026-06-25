import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import CreateProjectModal from "./CreateProjectModal";
import ProjectSetupModal from "./ProjectSetupModal";

const roleColors = {
  project_manager: { bg: "#1e3a5f", color: "#60a5fa", label: "Project Manager" },
  engineer: { bg: "#1a3a2a", color: "#4ade80", label: "Engineer" },
  drafter: { bg: "#3a1a3a", color: "#c084fc", label: "Drafter" },
};

export default function ProjectsDashboard({ session, onSelectProject, onSignOut, onShowDashboard }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [setupProject, setSetupProject] = useState(null);
  const [profile, setProfile] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    fetchProfile();
    fetchProjects();
  }, []);

  const fetchProfile = async () => {
    const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    setProfile(data);
  };

  const fetchProjects = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("project_members")
      .select("role, project:projects(id, name, description, created_at)")
      .eq("user_id", session.user.id);
    setProjects(data || []);
    setLoading(false);
  };

  const handleDelete = async (e, projectId) => {
    e.stopPropagation();
    if (!window.confirm("Delete this project? All checklists will be permanently removed.")) return;
    setDeletingId(projectId);
    const { error } = await supabase.from("projects").delete().eq("id", projectId);
    if (error) { alert("Error: " + error.message); } else { fetchProjects(); }
    setDeletingId(null);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", fontFamily: "Inter, sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "700", color: "#f1f5f9" }}>
          AGE-QC-Checklist
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            onClick={onShowDashboard}
            style={{ padding: "8px 16px", background: "#1e293b", color: "#94a3b8", border: "1px solid #334155", borderRadius: "6px", cursor: "pointer", fontSize: "14px" }}>
            📊 Dashboard
          </button>
          <span style={{ color: "#94a3b8", fontSize: "14px" }}>
            {profile?.full_name || session.user.email}
          </span>
          <button onClick={onSignOut} style={{ padding: "8px 16px", background: "#ef4444", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "14px" }}>
            Sign Out
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
          <div>
            <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: "24px" }}>My Projects</h2>
            <p style={{ color: "#94a3b8", margin: "4px 0 0", fontSize: "14px" }}>
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button onClick={() => setShowCreate(true)} style={{ padding: "10px 20px", background: "#3b82f6", color: "white", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>
            + New Project
          </button>
        </div>

        {loading ? (
          <p style={{ color: "#94a3b8", textAlign: "center" }}>Loading projects...</p>
        ) : projects.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <p style={{ color: "#94a3b8", fontSize: "18px" }}>No projects yet.</p>
            <p style={{ color: "#64748b", fontSize: "14px" }}>
              Create a new project or wait for an invitation from a Project Manager.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "16px" }}>
            {projects.map(({ role, project }) => (
              <div
                key={project.id}
                onClick={() => onSelectProject(project, role)}
                style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: "24px", cursor: "pointer", position: "relative" }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = "#3b82f6"}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = "#334155"}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ color: "#f1f5f9", margin: "0 0 8px", fontSize: "18px" }}>{project.name}</h3>
                    {project.description && (
                      <p style={{ color: "#94a3b8", margin: "0 0 12px", fontSize: "14px" }}>{project.description}</p>
                    )}
                    <p style={{ color: "#64748b", margin: 0, fontSize: "12px" }}>
                      Created {new Date(project.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "600", background: roleColors[role]?.bg, color: roleColors[role]?.color }}>
                      {roleColors[role]?.label}
                    </span>
                    {role === "project_manager" && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSetupProject({ project, role }); }}
                          style={{ padding: "6px 12px", background: "#1e3a5f", color: "#60a5fa", border: "1px solid #3b82f6", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                          ⚙ Setup
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, project.id)}
                          disabled={deletingId === project.id}
                          style={{ padding: "6px 12px", background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                          {deletingId === project.id ? "Deleting..." : "Delete"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectModal
          userId={session.user.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchProjects(); }}
        />
      )}

      {setupProject && (
        <ProjectSetupModal
          project={setupProject.project}
          session={session}
          onClose={() => setSetupProject(null)}
          onProjectRenamed={(newName, newDesc) => {
            setProjects((prev) => prev.map((p) =>
              p.project.id === setupProject.project.id
                ? { ...p, project: { ...p.project, name: newName, description: newDesc } }
                : p
            ));
            setSetupProject((prev) => ({ ...prev, project: { ...prev.project, name: newName, description: newDesc } }));
          }}
        />
      )}
    </div>
  );
}
