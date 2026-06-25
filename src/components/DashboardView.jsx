import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { CATEGORIES } from "../checklistTemplate";
import { useIsMobile } from "../useIsMobile";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

export default function DashboardView({ session, onBack, onSignOut }) {
  const isMobile = useIsMobile();
  const [projects, setProjects] = useState([]);
  const [stats, setStats] = useState({});
  const [categoryStats, setCategoryStats] = useState({});
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    const { data: memberRows } = await supabase
      .from("project_members")
      .select("project_id, project:projects(id, name)")
      .eq("user_id", session.user.id);

    const projs = memberRows?.map((r) => r.project).filter(Boolean) || [];
    setProjects(projs);

    if (projs.length === 0) { setLoading(false); return; }

    const ids = projs.map((p) => p.id);

    const { data: checklists } = await supabase
      .from("checklists")
      .select("project_id, category, status")
      .in("project_id", ids);

    const statsMap = {};
    const catMap = {};
    projs.forEach((p) => {
      statsMap[p.id] = { total: 0, complete: 0, na: 0, pending: 0 };
      catMap[p.id] = {};
    });

    (checklists || []).forEach((c) => {
      const s = statsMap[c.project_id];
      if (!s) return;
      s.total++;
      s[c.status] = (s[c.status] || 0) + 1;
      const cs = catMap[c.project_id];
      if (!cs[c.category]) cs[c.category] = { total: 0, done: 0 };
      cs[c.category].total++;
      if (c.status === "complete" || c.status === "na") cs[c.category].done++;
    });

    setStats(statsMap);
    setCategoryStats(catMap);

    const today = new Date().toISOString().split("T")[0];
    const { data: ms } = await supabase
      .from("project_milestones")
      .select("*, project:projects(name)")
      .in("project_id", ids)
      .gte("date", today)
      .order("date")
      .limit(10);

    setMilestones(ms || []);
    setLoading(false);
  };

  const overall = projects.reduce(
    (acc, p) => {
      const s = stats[p.id] || {};
      acc.total += s.total || 0;
      acc.complete += s.complete || 0;
      acc.na += s.na || 0;
      acc.pending += s.pending || 0;
      return acc;
    },
    { total: 0, complete: 0, na: 0, pending: 0 }
  );
  const overallPct = overall.total
    ? Math.round(((overall.complete + overall.na) / overall.total) * 100)
    : 0;

  const chartData = projects.map((p) => {
    const s = stats[p.id] || {};
    const total = s.total || 1;
    const label = p.name.length > 22 ? p.name.slice(0, 20) + "…" : p.name;
    return {
      name: label,
      Complete: Math.round(((s.complete || 0) / total) * 100),
      "N/A": Math.round(((s.na || 0) / total) * 100),
      Pending: Math.round(((s.pending || 0) / total) * 100),
    };
  });

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontFamily: "Inter, sans-serif" }}>
        Loading dashboard...
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", fontFamily: "Inter, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: isMobile ? "12px 16px" : "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button onClick={onBack} style={{ background: "#334155", color: "#f1f5f9", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "13px" }}>
            ←
          </button>
          <h1 style={{ margin: 0, fontSize: isMobile ? "15px" : "18px", fontWeight: "700", color: "#f1f5f9" }}>Dashboard</h1>
        </div>
        <button onClick={onSignOut} style={{ padding: isMobile ? "6px 10px" : "8px 16px", background: "#ef4444", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: isMobile ? "13px" : "14px" }}>
          {isMobile ? "↩" : "Sign Out"}
        </button>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: isMobile ? "20px 16px" : "32px 24px" }}>

        {/* Overall stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
          {[
            { label: "Projects", value: projects.length, color: "#3b82f6" },
            { label: "Overall Progress", value: `${overallPct}%`, color: overallPct === 100 ? "#4ade80" : "#f1f5f9" },
            { label: "Done / N/A", value: overall.complete + overall.na, color: "#4ade80" },
            { label: "Pending", value: overall.pending, color: overall.pending === 0 ? "#4ade80" : "#f59e0b" },
          ].map((stat) => (
            <div key={stat.label} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: isMobile ? "14px" : "20px" }}>
              <p style={{ margin: "0 0 6px", color: "#94a3b8", fontSize: "12px" }}>{stat.label}</p>
              <p style={{ margin: 0, color: stat.color, fontSize: isMobile ? "22px" : "28px", fontWeight: "700" }}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Bar chart */}
        {projects.length > 0 && (
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: isMobile ? "16px" : "24px", marginBottom: "24px" }}>
            <h2 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: "15px", fontWeight: "600" }}>
              Progress by Project (%)
            </h2>
            <ResponsiveContainer width="100%" height={Math.max(160, projects.length * (isMobile ? 40 : 48))}>
              <BarChart data={chartData} layout="vertical" margin={{ left: isMobile ? 0 : 10, right: 30, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: isMobile ? 10 : 12 }} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: isMobile ? 10 : 12 }} width={isMobile ? 90 : 130} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9" }}
                  formatter={(val) => `${val}%`}
                />
                <Legend wrapperStyle={{ color: "#94a3b8", fontSize: "12px" }} />
                <Bar dataKey="Complete" stackId="a" fill="#22c55e" />
                <Bar dataKey="N/A" stackId="a" fill="#78716c" />
                <Bar dataKey="Pending" stackId="a" fill="#334155" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Upcoming milestones */}
        {milestones.length > 0 && (
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: "24px", marginBottom: "32px" }}>
            <h2 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: "16px", fontWeight: "600" }}>
              Upcoming Milestones
            </h2>
            <div style={{ display: "grid", gap: "8px" }}>
              {milestones.map((m) => {
                const daysUntil = Math.ceil(
                  (new Date(m.date + "T00:00:00") - new Date()) / (1000 * 60 * 60 * 24)
                );
                const isAlert = daysUntil <= m.days_before_alert;
                return (
                  <div key={m.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", background: "#0f172a", borderRadius: "8px",
                    border: `1px solid ${isAlert ? "#f59e0b" : "#334155"}`,
                  }}>
                    <div>
                      <span style={{ color: "#f1f5f9", fontSize: "14px", fontWeight: "600" }}>{m.name}</span>
                      <span style={{ color: "#64748b", fontSize: "12px", marginLeft: "10px" }}>
                        {m.project?.name}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {isAlert && (
                        <span style={{ fontSize: "11px", color: "#f59e0b", background: "#451a03", padding: "2px 8px", borderRadius: "20px" }}>
                          ⚠ {daysUntil}d remaining
                        </span>
                      )}
                      <span style={{ color: "#94a3b8", fontSize: "13px" }}>
                        {new Date(m.date + "T00:00:00").toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Per-project breakdown */}
        <h2 style={{ color: "#f1f5f9", fontSize: "16px", fontWeight: "600", marginBottom: "16px" }}>
          Per-Project Category Breakdown
        </h2>
        <div style={{ display: "grid", gap: "16px" }}>
          {projects.map((p) => {
            const s = stats[p.id] || {};
            const total = s.total || 0;
            const pct = total ? Math.round(((s.complete + s.na) / total) * 100) : 0;
            const isExpanded = expanded === p.id;
            const catSt = categoryStats[p.id] || {};

            return (
              <div key={p.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", overflow: "hidden" }}>
                <div
                  onClick={() => setExpanded(isExpanded ? null : p.id)}
                  style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                  <div>
                    <h3 style={{ color: "#f1f5f9", margin: "0 0 4px", fontSize: "16px" }}>{p.name}</h3>
                    <p style={{ color: "#94a3b8", margin: 0, fontSize: "12px" }}>
                      {s.complete || 0} complete · {s.na || 0} N/A · {s.pending || 0} pending
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <span style={{ color: pct === 100 ? "#4ade80" : "#f1f5f9", fontSize: "24px", fontWeight: "700" }}>
                      {pct}%
                    </span>
                    <span style={{ color: "#64748b", fontSize: "12px" }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>
                </div>

                <div style={{ height: "4px", background: "#0f172a", margin: "0 20px 16px" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#22c55e" : "#3b82f6", borderRadius: "2px", transition: "width 0.3s" }} />
                </div>

                {isExpanded && (
                  <div style={{ padding: "4px 20px 20px", borderTop: "1px solid #334155" }}>
                    <div style={{ display: "grid", gap: "8px", marginTop: "16px" }}>
                      {CATEGORIES.filter((cat) => catSt[cat.id]).map((cat) => {
                        const cs = catSt[cat.id];
                        const catPct = cs.total ? Math.round((cs.done / cs.total) * 100) : 0;
                        return (
                          <div key={cat.id}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                              <span style={{ color: "#94a3b8", fontSize: "13px" }}>{cat.label}</span>
                              <span style={{ color: catPct === 100 ? "#4ade80" : "#94a3b8", fontSize: "12px", fontWeight: "600" }}>
                                {catPct}% ({cs.done}/{cs.total})
                              </span>
                            </div>
                            <div style={{ height: "4px", background: "#0f172a", borderRadius: "2px" }}>
                              <div style={{ height: "100%", width: `${catPct}%`, background: catPct === 100 ? "#22c55e" : "#3b82f6", borderRadius: "2px" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
