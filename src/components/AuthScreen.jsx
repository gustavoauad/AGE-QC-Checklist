import { useState } from "react";
import { supabase } from "../supabase";
import AgeLogo from "./AgeLogo";

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--c-bg)",
  border: "1px solid #334155",
  borderRadius: "8px",
  color: "var(--c-text)",
  fontSize: "14px",
  boxSizing: "border-box",
};

export default function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
    } else {
      await supabase.from("profiles").insert({
        id: data.user.id,
        full_name: fullName,
        email: email,
      });
      setMessage("✅ Account created! Please check your email and confirm your account before signing in.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Manrope, sans-serif" }}>
      <div style={{ background: "var(--c-surface)", borderRadius: "12px", padding: "40px", width: "100%", maxWidth: "400px", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>
        
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
            <AgeLogo height={40} />
          </div>
          <p style={{ color: "#777f8f", fontSize: "12px", margin: 0, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: "600" }}>QAQC Checklist</p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", marginBottom: "24px", background: "var(--c-bg)", borderRadius: "8px", padding: "4px" }}>
          {["login", "register"].map((m) => (
            <button key={m}
              onClick={() => { setMode(m); setError(""); setMessage(""); }}
              style={{ flex: 1, padding: "8px", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600", fontSize: "14px", background: mode === m ? "var(--c-accent)" : "transparent", color: mode === m ? "white" : "var(--c-text-2)" }}>
              {m === "login" ? "Sign In" : "Register"}
            </button>
          ))}
        </div>

        {/* Error / Message */}
        {error && (
          <div style={{ background: "var(--c-err-bg)", border: "1px solid #ef4444", borderRadius: "8px", padding: "12px", marginBottom: "16px", color: "var(--c-err-text)", fontSize: "14px" }}>
            {error}
          </div>
        )}
        {message && (
          <div style={{ background: "var(--c-ok-bg)", border: "1px solid #4da447", borderRadius: "8px", padding: "12px", marginBottom: "16px", color: "#a8e0a5", fontSize: "14px" }}>
            {message}
          </div>
        )}

        {/* Form */}
        <form onSubmit={mode === "login" ? handleLogin : handleRegister}>
          {mode === "register" && (
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", color: "var(--c-text-2)", fontSize: "14px", marginBottom: "6px" }}>Full Name</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="John Smith" style={inputStyle} />
            </div>
          )}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", color: "var(--c-text-2)", fontSize: "14px", marginBottom: "6px" }}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" style={inputStyle} />
          </div>
          <div style={{ marginBottom: "24px" }}>
            <label style={{ display: "block", color: "var(--c-text-2)", fontSize: "14px", marginBottom: "6px" }}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" style={inputStyle} />
          </div>
          <button type="submit" disabled={loading}
            style={{ width: "100%", padding: "12px", background: loading ? "#007ab8" : "var(--c-accent)", color: "white", border: "none", borderRadius: "8px", fontSize: "16px", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}