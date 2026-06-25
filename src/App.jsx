import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import AuthScreen from "./components/AuthScreen";
import OrgSelector from "./components/OrgSelector";
import OrgShell from "./components/OrgShell";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState(null);
  const [orgRole, setOrgRole] = useState(null);
  const [inviteToast, setInviteToast] = useState(null);

  // Capture invite token before auth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token) localStorage.setItem("pending_invite", token);
  }, []);

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

  // Process invite token once logged in
  useEffect(() => {
    if (!session) return;
    const urlToken = new URLSearchParams(window.location.search).get("invite");
    const storedToken = localStorage.getItem("pending_invite");
    const token = urlToken || storedToken;
    if (token) {
      localStorage.removeItem("pending_invite");
      window.history.replaceState({}, "", window.location.pathname);
      processInviteToken(token, session.user.id);
    }
  }, [session]);

  const processInviteToken = async (token, userId) => {
    const { data: tokenData } = await supabase
      .from("project_invite_tokens")
      .select("*, project:projects(id, name)")
      .eq("token", token)
      .gte("expires_at", new Date().toISOString())
      .single();

    if (!tokenData) { showToast("error", "Invite link is invalid or has expired."); return; }

    const { data: existing } = await supabase
      .from("project_members").select("id")
      .eq("project_id", tokenData.project_id).eq("user_id", userId).single();

    if (existing) { showToast("info", `You're already a member of "${tokenData.project?.name}".`); return; }

    await supabase.from("project_members").insert({
      project_id: tokenData.project_id, user_id: userId,
      role: tokenData.role, invited_by: tokenData.created_by,
    });
    await supabase.from("notifications").insert({
      user_id: userId, project_id: tokenData.project_id,
      type: "project_join",
      title: `Joined "${tokenData.project?.name}"`,
      body: `You joined as ${tokenData.role.replace(/_/g, " ")}. The project is now in your list.`,
    });
    showToast("success", `✅ You've joined "${tokenData.project?.name}"!`);
  };

  const showToast = (type, message) => {
    setInviteToast({ type, message });
    setTimeout(() => setInviteToast(null), 5000);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setOrg(null);
    setOrgRole(null);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontFamily: "Manrope, sans-serif" }}>
      Loading...
    </div>
  );

  if (!session) return <AuthScreen />;

  const toastColors = {
    success: { bg: "#1a3318", border: "#4da447", color: "#7ecb7b" },
    error:   { bg: "#450a0a", border: "#ef4444", color: "#fca5a5" },
    info:    { bg: "#011a3d", border: "#0095da", color: "#33bdef" },
  };

  return (
    <>
      {inviteToast && (
        <div style={{
          position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
          zIndex: 1000, padding: "12px 20px", borderRadius: "10px",
          background: toastColors[inviteToast.type].bg,
          border: `1px solid ${toastColors[inviteToast.type].border}`,
          color: toastColors[inviteToast.type].color,
          fontSize: "14px", fontWeight: "600", fontFamily: "Manrope, sans-serif",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          maxWidth: "calc(100vw - 32px)", textAlign: "center",
        }}>
          {inviteToast.message}
        </div>
      )}

      {!org ? (
        <OrgSelector
          session={session}
          onSelectOrg={(selectedOrg, role) => { setOrg(selectedOrg); setOrgRole(role); }}
          onSignOut={handleSignOut}
        />
      ) : (
        <OrgShell
          session={session}
          org={org}
          orgRole={orgRole}
          onSignOut={handleSignOut}
          onSwitchOrg={() => { setOrg(null); setOrgRole(null); }}
        />
      )}
    </>
  );
}
