import { useState } from "react";
import { useIsMobile } from "../useIsMobile";
import AgeLogo from "./AgeLogo";
import NotificationBell from "./NotificationBell";
import OrgDashboard from "./OrgDashboard";
import ProjectsDashboard from "./ProjectsDashboard";
import OrgSettings from "./OrgSettings";
import ChecklistView from "./ChecklistView";

export default function OrgShell({ session, org: initialOrg, orgRole, onSignOut, onSwitchOrg }) {
  const isMobile = useIsMobile();
  const [section, setSection] = useState("projects");
  const [selectedProject, setSelectedProject] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [org, setOrg] = useState(initialOrg);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const nav = [
    { id: "dashboard", icon: "📊", label: "Dashboard" },
    { id: "projects",  icon: "📁", label: "Projects" },
    { id: "settings",  icon: "⚙",  label: "Settings" },
  ];

  if (selectedProject) {
    return (
      <ChecklistView
        project={selectedProject}
        userRole={userRole}
        session={session}
        onBack={() => { setSelectedProject(null); setUserRole(null); }}
        onSignOut={onSignOut}
        onGoToProjects={() => { setSelectedProject(null); setUserRole(null); setSection("projects"); }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f172a", fontFamily: "Manrope, sans-serif" }}>

      {/* Header */}
      <div style={{
        background: "#1e293b", borderBottom: "1px solid #334155",
        padding: isMobile ? "10px 16px" : "12px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <AgeLogo height={isMobile ? 20 : 24} />
          <div style={{ borderLeft: "1px solid #334155", paddingLeft: "12px" }}>
            <div style={{ color: "#f1f5f9", fontSize: isMobile ? "13px" : "14px", fontWeight: "700", lineHeight: 1.2 }}>{org.name}</div>
            <div style={{ color: orgRole === "admin" ? "#33bdef" : "#7ecb7b", fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {orgRole}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {!isMobile && (
            <button onClick={onSwitchOrg} style={{
              padding: "6px 12px", background: "transparent", border: "1px solid #334155",
              color: "#94a3b8", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontFamily: "Manrope, sans-serif",
            }}>
              Switch Org
            </button>
          )}
          <NotificationBell userId={session.user.id} onGoToProjects={() => setSection("projects")} />
          <button onClick={onSignOut} style={{
            padding: isMobile ? "6px 10px" : "7px 14px", background: "#ef4444", color: "white",
            border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontFamily: "Manrope, sans-serif",
          }}>
            {isMobile ? "↩" : "Sign Out"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Sidebar (desktop only) */}
        {!isMobile && (
          <div style={{
            width: sidebarOpen ? "200px" : "52px",
            background: "#1e293b", borderRight: "1px solid #334155",
            padding: sidebarOpen ? "20px 12px" : "20px 8px",
            display: "flex", flexDirection: "column", gap: "4px", flexShrink: 0,
            transition: "width 0.2s ease",
            overflow: "hidden",
          }}>
            {/* Toggle button */}
            <button onClick={() => setSidebarOpen((v) => !v)} title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"} style={{
              display: "flex", alignItems: "center", justifyContent: sidebarOpen ? "flex-end" : "center",
              padding: "6px", border: "none", borderRadius: "6px",
              background: "transparent", color: "#64748b",
              cursor: "pointer", marginBottom: "8px", flexShrink: 0,
            }}>
              <span style={{ fontSize: "14px" }}>{sidebarOpen ? "◀" : "▶"}</span>
            </button>

            {nav.map(({ id, icon, label }) => (
              <button key={id} onClick={() => setSection(id)} title={!sidebarOpen ? label : undefined} style={{
                display: "flex", alignItems: "center", gap: sidebarOpen ? "10px" : "0",
                justifyContent: sidebarOpen ? "flex-start" : "center",
                padding: "10px 12px", border: "none", borderRadius: "8px",
                background: section === id ? "#0095da" : "transparent",
                color: section === id ? "white" : "#94a3b8",
                cursor: "pointer", fontSize: "14px", fontWeight: section === id ? "600" : "400",
                textAlign: "left", width: "100%", fontFamily: "Manrope, sans-serif",
                whiteSpace: "nowrap",
              }}>
                <span style={{ fontSize: "16px", flexShrink: 0 }}>{icon}</span>
                {sidebarOpen && <span>{label}</span>}
              </button>
            ))}

            {/* Switch org at bottom of sidebar */}
            <div style={{ marginTop: "auto", paddingTop: "20px", borderTop: "1px solid #334155" }}>
              <button onClick={onSwitchOrg} title={!sidebarOpen ? "Switch Org" : undefined} style={{
                display: "flex", alignItems: "center", gap: sidebarOpen ? "10px" : "0",
                justifyContent: sidebarOpen ? "flex-start" : "center",
                padding: "8px 12px", border: "none", borderRadius: "8px",
                background: "transparent", color: "#64748b",
                cursor: "pointer", fontSize: "13px", width: "100%", fontFamily: "Manrope, sans-serif",
              }}>
                <span style={{ flexShrink: 0 }}>↩</span>
                {sidebarOpen && <span>Switch Org</span>}
              </button>
            </div>
          </div>
        )}

        {/* Main content */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {section === "dashboard" && (
            <OrgDashboard session={session} org={org} orgRole={orgRole} />
          )}
          {section === "projects" && (
            <ProjectsDashboard
              session={session}
              org={org}
              orgRole={orgRole}
              onSelectProject={(project, role) => { setSelectedProject(project); setUserRole(role); }}
            />
          )}
          {section === "settings" && (
            <OrgSettings
              session={session}
              org={org}
              orgRole={orgRole}
              onOrgRenamed={(newName) => setOrg((prev) => ({ ...prev, name: newName }))}
            />
          )}
        </div>
      </div>

      {/* Bottom nav (mobile only) */}
      {isMobile && (
        <div style={{ display: "flex", background: "#1e293b", borderTop: "1px solid #334155", flexShrink: 0 }}>
          {nav.map(({ id, icon, label }) => (
            <button key={id} onClick={() => setSection(id)} style={{
              flex: 1, padding: "10px 4px 8px", border: "none",
              background: section === id ? "#012d5a" : "transparent",
              color: section === id ? "#0095da" : "#64748b",
              cursor: "pointer", fontSize: "11px", fontWeight: section === id ? "700" : "400",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
              fontFamily: "Manrope, sans-serif",
            }}>
              <span style={{ fontSize: "18px" }}>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
