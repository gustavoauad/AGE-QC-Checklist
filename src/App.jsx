import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import AuthScreen from "./components/AuthScreen";
import ProjectsDashboard from "./components/ProjectsDashboard";
import ChecklistView from "./components/ChecklistView";
import DashboardView from "./components/DashboardView";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("projects"); // "projects" | "dashboard" | "checklist"
  const [selectedProject, setSelectedProject] = useState(null);
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSelectedProject(null);
    setUserRole(null);
    setView("projects");
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontFamily: "Manrope, sans-serif" }}>
        Loading...
      </div>
    );
  }

  if (!session) return <AuthScreen />;

  if (view === "checklist" && selectedProject) {
    return (
      <ChecklistView
        project={selectedProject}
        userRole={userRole}
        session={session}
        onBack={() => setView("projects")}
        onSignOut={handleSignOut}
      />
    );
  }

  if (view === "dashboard") {
    return (
      <DashboardView
        session={session}
        onBack={() => setView("projects")}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <ProjectsDashboard
      session={session}
      onSelectProject={(project, role) => {
        setSelectedProject(project);
        setUserRole(role);
        setView("checklist");
      }}
      onShowDashboard={() => setView("dashboard")}
      onSignOut={handleSignOut}
    />
  );
}
