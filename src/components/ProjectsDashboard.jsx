import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { useIsMobile } from "../useIsMobile";
import CreateProjectModal from "./CreateProjectModal";
import ProjectSetupModal from "./ProjectSetupModal";

const roleColors = {
  project_manager: { bg: "#012d5a", color: "#33bdef", label: "Project Manager" },
  engineer:        { bg: "#1a3a2a", color: "#4ade80", label: "Engineer" },
  drafter:         { bg: "#3a1a3a", color: "#c084fc", label: "Drafter" },
};

export default function ProjectsDashboard({ session, org, orgRole, onSelectProject }) {
  const isMobile = useIsMobile();
  const [projects, setProjects] = useState([]);       // active: user is a member
  const [allOrgProjects, setAllOrgProjects] = useState([]); // admin only: all org projects
  const [archived, setArchived] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [setupProject, setSetupProject] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [archivingId, setArchivingId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    fetchProjects();

    // Real-time: refresh when added to a project
    const ch = supabase
      .channel(`pm-projects-${session.user.id}-${org.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "project_members", filter: `user_id=eq.${session.user.id}` }, () => fetchProjects())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [org.id]);

  const fetchProjects = async () => {
    setLoading(true);

    // Projects user is directly assigned to (active)
    const { data: memberRows } = await supabase
      .from("project_members")
      .select("role, project:projects(id, name, description, created_at, archived_at, organization_id)")
      .eq("user_id", session.user.id);

    const myProjects = (memberRows || [])
      .filter((r) => r.project?.organization_id === org.id)
      .map((r) => ({ role: r.role, project: r.project }));

    setProjects(myProjects.filter((r) => !r.project.archived_at));
    setArchived(myProjects.filter((r) => r.project.archived_at));

    // Admin: also fetch all org projects (to show unassigned ones)
    if (orgRole === "admin") {
      const { data: orgProjs } = await supabase
        .from("projects")
        .select("id, name, description, created_at, archived_at")
        .eq("organization_id", org.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      setAllOrgProjects(orgProjs || []);
    }

    setLoading(false);
  };

  const handleArchive = async (e, projectId) => {
    e.stopPropagation();
    if (!window.confirm("Archive this project? It can be unarchived later.")) return;
    setArchivingId(projectId);
    await supabase.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", projectId);
    fetchProjects();
    setArchivingId(null);
  };

  const handleUnarchive = async (projectId) => {
    await supabase.from("projects").update({ archived_at: null }).eq("id", projectId);
    fetchProjects();
  };

  const handleDelete = async (e, projectId) => {
    e.stopPropagation();
    if (!window.confirm("Permanently delete this project? This cannot be undone.")) return;
    setDeletingId(projectId);
    await supabase.from("projects").delete().eq("id", projectId);
    fetchProjects();
    setDeletingId(null);
  };

  // For admin: merge allOrgProjects with myProjects to get role info
  const getProjectRole = (projectId) => {
    const match = projects.find((r) => r.project.id === projectId);
    return match?.role || null;
  };

  // Cards shown in the active list for the current user
  const activeList = orgRole === "admin"
    ? allOrgProjects.map((p) => ({ project: p, role: getProjectRole(p.id) }))
    : projects;

  return (
    <div style={{ padding: isMobile ? "20px 16px" : "32px 28px", maxWidth: "900px", margin: "0 auto", fontFamily: "Manrope, sans-serif" }}>

      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", gap: "12px" }}>
        <div>
          <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: isMobile ? "18px" : "22px", fontWeight: "700" }}>Projects</h2>
          <p style={{ color: "#94a3b8", margin: "4px 0 0", fontSize: "13px" }}>
            {activeList.length} project{activeList.length !== 1 ? "s" : ""}
          </p>
        </div>
        {orgRole === "admin" && (
          <button onClick={() => setShowCreate(true)} style={{
            padding: isMobile ? "8px 14px" : "10px 20px", background: "#0095da", color: "white",
            border: "none", borderRadius: "8px", fontSize: isMobile ? "13px" : "14px",
            fontWeight: "600", cursor: "pointer", flexShrink: 0, fontFamily: "Manrope, sans-serif",
          }}>
            {isMobile ? "+ New" : "+ New Project"}
          </button>
        )}
      </div>

      {/* Active projects */}
      {loading ? (
        <p style={{ color: "#94a3b8", textAlign: "center", padding: "40px 0" }}>Loading projects...</p>
      ) : activeList.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <p style={{ color: "#94a3b8", fontSize: "16px" }}>No projects yet.</p>
          <p style={{ color: "#64748b", fontSize: "13px" }}>
            {orgRole === "admin" ? "Create a new project to get started." : "You haven't been assigned to any projects yet."}
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "12px", marginBottom: "32px" }}>
          {activeList.map(({ role, project }) => (
            <div
              key={project.id}
              onClick={() => role && onSelectProject(project, role)}
              style={{
                background: "#1e293b", border: "1px solid #334155", borderRadius: "12px",
                padding: isMobile ? "16px" : "20px",
                cursor: role ? "pointer" : "default",
                opacity: role ? 1 : 0.6,
              }}
              onMouseEnter={(e) => role && (e.currentTarget.style.borderColor = "#0095da")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#334155")}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ color: "#f1f5f9", margin: "0 0 4px", fontSize: isMobile ? "15px" : "17px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {project.name}
                  </h3>
                  {project.description && (
                    <p style={{ color: "#94a3b8", margin: "0 0 6px", fontSize: "13px" }}>{project.description}</p>
                  )}
                  <p style={{ color: "#64748b", margin: 0, fontSize: "11px" }}>
                    Created {new Date(project.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-end" : "center", gap: "8px", flexShrink: 0 }}>
                  {role ? (
                    <span style={{
                      padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: "600",
                      background: roleColors[role]?.bg, color: roleColors[role]?.color, whiteSpace: "nowrap",
                    }}>
                      {isMobile ? (role === "project_manager" ? "PM" : role.charAt(0).toUpperCase() + role.slice(1)) : roleColors[role]?.label}
                    </span>
                  ) : (
                    <span style={{ padding: "4px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: "600", background: "#1e293b", color: "#64748b", border: "1px solid #334155" }}>
                      Not assigned
                    </span>
                  )}
                  {orgRole === "admin" && (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSetupProject({ project, role: role || "project_manager" }); }}
                        style={{ padding: "5px 10px", background: "#012d5a", color: "#33bdef", border: "1px solid #0095da", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                        ⚙ Setup
                      </button>
                      <button
                        onClick={(e) => handleArchive(e, project.id)}
                        disabled={archivingId === project.id}
                        style={{ padding: "5px 10px", background: "transparent", color: "#f59e0b", border: "1px solid #f59e0b", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>
                        {archivingId === project.id ? "..." : "Archive"}
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, project.id)}
                        disabled={deletingId === project.id}
                        style={{ padding: "5px 10px", background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>
                        {deletingId === project.id ? "..." : "✕"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Archived projects */}
      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: "8px", background: "none",
              border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px",
              fontWeight: "600", padding: "0", marginBottom: showArchived ? "16px" : "0",
              fontFamily: "Manrope, sans-serif",
            }}>
            <span>{showArchived ? "▼" : "▶"}</span>
            <span>Archived Projects ({archived.length})</span>
          </button>

          {showArchived && (
            <div style={{ display: "grid", gap: "8px" }}>
              {archived.map(({ role, project }) => (
                <div key={project.id} style={{
                  background: "#151f2e", border: "1px solid #243044", borderRadius: "10px",
                  padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap",
                }}>
                  <div>
                    <span style={{ color: "#64748b", fontSize: "14px", fontWeight: "600" }}>{project.name}</span>
                    <span style={{ color: "#4a5568", fontSize: "11px", marginLeft: "10px" }}>
                      Archived {new Date(project.archived_at).toLocaleDateString()}
                    </span>
                  </div>
                  {orgRole === "admin" && (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        onClick={() => handleUnarchive(project.id)}
                        style={{ padding: "5px 12px", background: "transparent", color: "#33bdef", border: "1px solid #0095da", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>
                        Unarchive
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, project.id)}
                        disabled={deletingId === project.id}
                        style={{ padding: "5px 10px", background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>
                        {deletingId === project.id ? "..." : "✕"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateProjectModal
          userId={session.user.id}
          org={org}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchProjects(); }}
        />
      )}
      {setupProject && (
        <ProjectSetupModal
          project={setupProject.project}
          session={session}
          org={org}
          orgRole={orgRole}
          userRole={setupProject.role}
          onClose={() => setSetupProject(null)}
          onProjectRenamed={(newName, newDesc) => {
            fetchProjects();
            setSetupProject((prev) => ({ ...prev, project: { ...prev.project, name: newName, description: newDesc } }));
          }}
        />
      )}
    </div>
  );
}
