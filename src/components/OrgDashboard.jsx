import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { CATEGORIES } from "../checklistTemplate";
import { useIsMobile } from "../useIsMobile";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

export default function OrgDashboard({ session, org }) {
  const isMobile = useIsMobile();
  const [projects, setProjects] = useState([]);
  const [stats, setStats] = useState({});
  const [categoryStats, setCategoryStats] = useState({});
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { fetchAll(); }, [org.id]);

  const fetchAll = async () => {
    setLoading(true);
    const { data: memberRows } = await supabase
      .from("project_members")
      .select("project_id, role, project:projects(id, name, organization_id)")
      .eq("user_id", session.user.id);

    const projs = (memberRows || [])
      .filter((r) => r.project?.organization_id === org.id && !r.project?.archived_at)
      .map((r) => ({ ...r.project, myRole: r.role }));
    setProjects(projs);

    if (!projs.length) { setLoading(false); return; }

    const ids = projs.map((p) => p.id);
    const { data: checklists } = await supabase
      .from("checklists").select("project_id, category, status").in("project_id", ids);

    const statsMap = {};
    const catMap = {};
    projs.forEach((p) => { statsMap[p.id] = { total: 0, complete: 0, na: 0, pending: 0 }; catMap[p.id] = {}; });
    (checklists || []).forEach((c) => {
      const s = statsMap[c.project_id]; if (!s) return;
      s.total++; s[c.status] = (s[c.status] || 0) + 1;
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
    (acc, p) => { const s = stats[p.id] || {}; acc.total += s.total || 0; acc.complete += s.complete || 0; acc.na += s.na || 0; acc.pending += s.pending || 0; return acc; },
    { total: 0, complete: 0, na: 0, pending: 0 }
  );
  const overallPct = overall.total ? Math.round(((overall.complete + overall.na) / overall.total) * 100) : 0;

  const chartData = projects.map((p) => {
    const s = stats[p.id] || {};
    const total = s.total || 1;
    return {
      name: p.name.length > 22 ? p.name.slice(0, 20) + "…" : p.name,
      Complete: Math.round(((s.complete || 0) / total) * 100),
      "N/A": Math.round(((s.na || 0) / total) * 100),
      Pending: Math.round(((s.pending || 0) / total) * 100),
    };
  });

  if (loading) return (
    <div style={{ padding: "48px 24px", textAlign: "center", color: "#94a3b8", fontFamily: "Manrope, sans-serif" }}>
      Loading dashboard...
    </div>
  );

  return (
    <div style={{ padding: isMobile ? "20px 16px" : "32px 28px", maxWidth: "1100px", margin: "0 auto", fontFamily: "Manrope, sans-serif" }}>
      <h2 style={{ color: "#f1f5f9", margin: "0 0 24px", fontSize: isMobile ? "18px" : "22px", fontWeight: "700" }}>
        Dashboard
      </h2>

      {projects.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#64748b" }}>
          <p style={{ fontSize: "16px" }}>No active projects yet.</p>
          <p style={{ fontSize: "13px" }}>Create a project from the Projects menu.</p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: "12px", marginBottom: "24px" }}>
            {[
              { label: "Projects", value: projects.length, color: "#0095da" },
              { label: "Overall Progress", value: `${overallPct}%`, color: overallPct === 100 ? "#7ecb7b" : "#f1f5f9" },
              { label: "Done / N/A", value: overall.complete + overall.na, color: "#7ecb7b" },
              { label: "Pending", value: overall.pending, color: overall.pending === 0 ? "#7ecb7b" : "#f59e0b" },
            ].map((stat) => (
              <div key={stat.label} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: isMobile ? "14px" : "20px" }}>
                <p style={{ margin: "0 0 6px", color: "#94a3b8", fontSize: "12px" }}>{stat.label}</p>
                <p style={{ margin: 0, color: stat.color, fontSize: isMobile ? "22px" : "28px", fontWeight: "700" }}>{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: isMobile ? "16px" : "24px", marginBottom: "24px" }}>
            <h3 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: "15px", fontWeight: "600" }}>Progress by Project (%)</h3>
            <ResponsiveContainer width="100%" height={Math.max(160, projects.length * (isMobile ? 40 : 48))}>
              <BarChart data={chartData} layout="vertical" margin={{ left: isMobile ? 0 : 10, right: 30, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: isMobile ? 10 : 12 }} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: isMobile ? 10 : 12 }} width={isMobile ? 90 : 130} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9" }} formatter={(v) => `${v}%`} />
                <Legend wrapperStyle={{ color: "#94a3b8", fontSize: "12px" }} />
                <Bar dataKey="Complete" stackId="a" fill="#4da447" />
                <Bar dataKey="N/A" stackId="a" fill="#78716c" />
                <Bar dataKey="Pending" stackId="a" fill="#334155" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Upcoming milestones */}
          {milestones.length > 0 && (
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: isMobile ? "16px" : "24px", marginBottom: "24px" }}>
              <h3 style={{ color: "#f1f5f9", margin: "0 0 16px", fontSize: "15px", fontWeight: "600" }}>Upcoming Milestones</h3>
              <div style={{ display: "grid", gap: "8px" }}>
                {milestones.map((m) => {
                  const daysUntil = Math.ceil((new Date(m.date + "T00:00:00") - new Date()) / 86400000);
                  const isAlert = daysUntil <= m.days_before_alert;
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#0f172a", borderRadius: "8px", border: `1px solid ${isAlert ? "#f59e0b" : "#334155"}`, flexWrap: "wrap", gap: "6px" }}>
                      <div>
                        <span style={{ color: "#f1f5f9", fontSize: "14px", fontWeight: "600" }}>{m.name}</span>
                        <span style={{ color: "#64748b", fontSize: "12px", marginLeft: "10px" }}>{m.project?.name}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {isAlert && <span style={{ fontSize: "11px", color: "#f59e0b", background: "#451a03", padding: "2px 8px", borderRadius: "20px" }}>⚠ {daysUntil}d</span>}
                        <span style={{ color: "#94a3b8", fontSize: "13px" }}>{new Date(m.date + "T00:00:00").toLocaleDateString()}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-project breakdown */}
          <h3 style={{ color: "#f1f5f9", fontSize: "15px", fontWeight: "600", margin: "0 0 16px" }}>Per-Project Breakdown</h3>
          <div style={{ display: "grid", gap: "12px" }}>
            {projects.map((p) => {
              const s = stats[p.id] || {};
              const total = s.total || 0;
              const pct = total ? Math.round(((s.complete + s.na) / total) * 100) : 0;
              const isExp = expanded === p.id;
              const catSt = categoryStats[p.id] || {};
              return (
                <div key={p.id} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", overflow: "hidden" }}>
                  <div onClick={() => setExpanded(isExp ? null : p.id)} style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                    <div>
                      <h4 style={{ color: "#f1f5f9", margin: "0 0 4px", fontSize: "15px" }}>{p.name}</h4>
                      <p style={{ color: "#94a3b8", margin: 0, fontSize: "12px" }}>{s.complete || 0} done · {s.na || 0} N/A · {s.pending || 0} pending</p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ color: pct === 100 ? "#7ecb7b" : "#f1f5f9", fontSize: "22px", fontWeight: "700" }}>{pct}%</span>
                      <span style={{ color: "#64748b", fontSize: "12px" }}>{isExp ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  <div style={{ height: "4px", background: "#0f172a", margin: "0 20px 16px" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#4da447" : "#0095da", borderRadius: "2px" }} />
                  </div>
                  {isExp && (
                    <div style={{ padding: "4px 20px 20px", borderTop: "1px solid #334155" }}>
                      <div style={{ display: "grid", gap: "8px", marginTop: "16px" }}>
                        {CATEGORIES.filter((cat) => catSt[cat.id]).map((cat) => {
                          const cs = catSt[cat.id];
                          const catPct = cs.total ? Math.round((cs.done / cs.total) * 100) : 0;
                          return (
                            <div key={cat.id}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                <span style={{ color: "#94a3b8", fontSize: "13px" }}>{cat.label}</span>
                                <span style={{ color: catPct === 100 ? "#7ecb7b" : "#94a3b8", fontSize: "12px", fontWeight: "600" }}>{catPct}% ({cs.done}/{cs.total})</span>
                              </div>
                              <div style={{ height: "4px", background: "#0f172a", borderRadius: "2px" }}>
                                <div style={{ height: "100%", width: `${catPct}%`, background: catPct === 100 ? "#4da447" : "#0095da", borderRadius: "2px" }} />
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
        </>
      )}
    </div>
  );
}
