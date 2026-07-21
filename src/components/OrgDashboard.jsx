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
  const [milestoneChartData, setMilestoneChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [milestoneView, setMilestoneView] = useState("list"); // list | calendar
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });

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
    // Upcoming milestones panel — fetched without a hard cap so the calendar view
    // (which can span several months forward) has full data; list view shows the first 10.
    const { data: ms } = await supabase
      .from("project_milestones")
      .select("*, project:projects(name)")
      .in("project_id", ids)
      .gte("date", today)
      .order("date");
    setMilestones(ms || []);

    // Active milestone completion chart
    const { data: allMs } = await supabase
      .from("project_milestones")
      .select("id, project_id, name, date")
      .in("project_id", ids)
      .order("project_id").order("date");

    // Find active milestone per project
    const msByProject = {};
    (allMs || []).forEach((m) => {
      if (!msByProject[m.project_id]) msByProject[m.project_id] = [];
      msByProject[m.project_id].push(m);
    });
    const activeMsIds = [];
    const activeMsInfo = {}; // msId → { name, projectName }
    projs.forEach((p) => {
      const pMs = msByProject[p.id] || [];
      for (let i = 0; i < pMs.length; i++) {
        const prevDate = i > 0 ? pMs[i - 1].date : "0000-01-01";
        if (today > prevDate && today <= pMs[i].date) {
          activeMsIds.push(pMs[i].id);
          activeMsInfo[pMs[i].id] = { name: pMs[i].name, projectName: p.name };
          break;
        }
      }
    });

    if (activeMsIds.length > 0) {
      const { data: miRows } = await supabase
        .from("milestone_items")
        .select("milestone_id, checklist_item_id")
        .in("milestone_id", activeMsIds);
      const itemToMs = {};
      (miRows || []).forEach(({ milestone_id, checklist_item_id }) => {
        itemToMs[checklist_item_id] = milestone_id;
      });
      const allItemIds = Object.keys(itemToMs);
      let statusMap = {};
      if (allItemIds.length > 0) {
        const { data: clRows } = await supabase
          .from("checklists").select("id, status").in("id", allItemIds);
        (clRows || []).forEach((r) => { statusMap[r.id] = r.status; });
      }
      const msStats = {};
      activeMsIds.forEach((id) => { msStats[id] = { total: 0, complete: 0 }; });
      Object.entries(itemToMs).forEach(([itemId, msId]) => {
        if (!msStats[msId]) return;
        msStats[msId].total++;
        if (statusMap[itemId] === "complete") msStats[msId].complete++;
      });
      setMilestoneChartData(activeMsIds.map((id) => ({
        name: `${activeMsInfo[id].projectName} — ${activeMsInfo[id].name}`,
        Complete: msStats[id].complete,
        Remaining: msStats[id].total - msStats[id].complete,
        total: msStats[id].total,
        pct: msStats[id].total ? Math.round((msStats[id].complete / msStats[id].total) * 100) : 0,
      })).filter((d) => d.total > 0));
    }

    setLoading(false);
  };

  const overall = projects.reduce(
    (acc, p) => { const s = stats[p.id] || {}; acc.total += s.total || 0; acc.complete += s.complete || 0; acc.na += s.na || 0; acc.pending += s.pending || 0; return acc; },
    { total: 0, complete: 0, na: 0, pending: 0 }
  );
  // Progress = complete / applicable (total − na)
  const overallApplicable = overall.total - overall.na;
  const overallPct = overallApplicable ? Math.round((overall.complete / overallApplicable) * 100) : 0;

  const chartData = projects.map((p) => {
    const s = stats[p.id] || {};
    const applicable = (s.total || 0) - (s.na || 0) || 1;
    return {
      name: p.name.length > 22 ? p.name.slice(0, 20) + "…" : p.name,
      Complete: Math.round(((s.complete || 0) / applicable) * 100),
      Pending: Math.round(((s.pending || 0) / applicable) * 100),
    };
  });

  if (loading) return (
    <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--c-text-2)", fontFamily: "Manrope, sans-serif" }}>
      Loading dashboard...
    </div>
  );

  return (
    <div style={{ padding: isMobile ? "20px 16px" : "32px 28px", maxWidth: "1100px", margin: "0 auto", fontFamily: "Manrope, sans-serif" }}>
      <h2 style={{ color: "var(--c-text)", margin: "0 0 24px", fontSize: isMobile ? "18px" : "22px", fontWeight: "700" }}>
        Dashboard
      </h2>

      {projects.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--c-text-3)" }}>
          <p style={{ fontSize: "16px" }}>No active projects yet.</p>
          <p style={{ fontSize: "13px" }}>Create a project from the Projects menu.</p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: "12px", marginBottom: "24px" }}>
            {[
              { label: "Projects", value: projects.length, color: "var(--c-accent)" },
              { label: "Overall Progress", value: `${overallPct}%`, color: overallPct === 100 ? "var(--c-ok-text)" : "var(--c-text)" },
              { label: "Done", value: overall.complete, color: "var(--c-ok-text)" },
              { label: "Pending", value: overall.pending, color: overall.pending === 0 ? "var(--c-ok-text)" : "var(--c-warn)" },
            ].map((stat) => (
              <div key={stat.label} style={{ background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "12px", padding: isMobile ? "14px" : "20px" }}>
                <p style={{ margin: "0 0 6px", color: "var(--c-text-2)", fontSize: "12px" }}>{stat.label}</p>
                <p style={{ margin: 0, color: stat.color, fontSize: isMobile ? "22px" : "28px", fontWeight: "700" }}>{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          <div style={{ background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "12px", padding: isMobile ? "16px" : "24px", marginBottom: "24px" }}>
            <h3 style={{ color: "var(--c-text)", margin: "0 0 16px", fontSize: "15px", fontWeight: "600" }}>Progress by Project (%)</h3>
            <ResponsiveContainer width="100%" height={Math.max(160, projects.length * (isMobile ? 40 : 48))}>
              <BarChart data={chartData} layout="vertical" margin={{ left: isMobile ? 0 : 10, right: 30, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: "var(--c-text-2)", fontSize: isMobile ? 10 : 12 }} tickFormatter={(v) => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fill: "var(--c-text-2)", fontSize: isMobile ? 10 : 12 }} width={isMobile ? 90 : 130} />
                <Tooltip contentStyle={{ background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "8px", color: "var(--c-text)" }} formatter={(v) => `${v}%`} />
                <Legend wrapperStyle={{ color: "var(--c-text-2)", fontSize: "12px" }} />
                <Bar dataKey="Complete" stackId="a" fill="var(--c-ok)" />
                <Bar dataKey="Pending" stackId="a" fill="var(--c-border)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Active milestone completion chart */}
          {milestoneChartData.length > 0 && (
            <div style={{ background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "12px", padding: isMobile ? "16px" : "24px", marginBottom: "24px" }}>
              <h3 style={{ color: "var(--c-text)", margin: "0 0 4px", fontSize: "15px", fontWeight: "600" }}>Active Milestone Progress</h3>
              <p style={{ color: "var(--c-text-3)", fontSize: "12px", margin: "0 0 16px" }}>Completed items assigned to each project's current active milestone</p>
              <ResponsiveContainer width="100%" height={Math.max(120, milestoneChartData.length * (isMobile ? 44 : 52))}>
                <BarChart data={milestoneChartData} layout="vertical" margin={{ left: isMobile ? 0 : 10, right: 60, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--c-border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "var(--c-text-2)", fontSize: isMobile ? 10 : 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "var(--c-text-2)", fontSize: isMobile ? 9 : 11 }} width={isMobile ? 110 : 200} />
                  <Tooltip contentStyle={{ background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "8px", color: "var(--c-text)" }}
                    formatter={(val, key, props) => [`${val} items (${props.payload.pct}%)`, key]} />
                  <Legend wrapperStyle={{ color: "var(--c-text-2)", fontSize: "12px" }} />
                  <Bar dataKey="Complete" stackId="a" fill="var(--c-ok)" />
                  <Bar dataKey="Remaining" stackId="a" fill="var(--c-border)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Upcoming milestones */}
          {milestones.length > 0 && (
            <div style={{ background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "12px", padding: isMobile ? "16px" : "24px", marginBottom: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                <h3 style={{ color: "var(--c-text)", margin: 0, fontSize: "15px", fontWeight: "600" }}>Upcoming Milestones</h3>
                <div style={{ display: "flex", background: "var(--c-bg)", border: "1px solid var(--c-border)", borderRadius: "8px", padding: "2px" }}>
                  {["list", "calendar"].map((v) => (
                    <button key={v} onClick={() => setMilestoneView(v)} style={{
                      padding: "5px 12px", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600",
                      cursor: "pointer", textTransform: "capitalize",
                      background: milestoneView === v ? "var(--c-accent)" : "transparent",
                      color: milestoneView === v ? "white" : "var(--c-text-2)",
                    }}>
                      {v === "list" ? "☰ List" : "📅 Calendar"}
                    </button>
                  ))}
                </div>
              </div>

              {milestoneView === "list" ? (
                <div style={{ display: "grid", gap: "8px" }}>
                  {milestones.slice(0, 10).map((m) => {
                    const daysUntil = Math.ceil((new Date(m.date + "T00:00:00") - new Date()) / 86400000);
                    const isAlert = daysUntil <= m.days_before_alert;
                    return (
                      <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "var(--c-bg)", borderRadius: "8px", border: `1px solid ${isAlert ? "var(--c-warn)" : "var(--c-border)"}`, flexWrap: "wrap", gap: "6px" }}>
                        <div>
                          <span style={{ color: "var(--c-text)", fontSize: "14px", fontWeight: "600" }}>{m.name}</span>
                          <span style={{ color: "var(--c-text-3)", fontSize: "12px", marginLeft: "10px" }}>{m.project?.name}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {isAlert && <span style={{ fontSize: "11px", color: "var(--c-warn)", background: "var(--c-warn-bg)", padding: "2px 8px", borderRadius: "20px" }}>⚠ {daysUntil}d</span>}
                          <span style={{ color: "var(--c-text-2)", fontSize: "13px" }}>{new Date(m.date + "T00:00:00").toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                (() => {
                  const year = calMonth.getFullYear();
                  const month = calMonth.getMonth();
                  const firstOfMonth = new Date(year, month, 1);
                  const startDay = firstOfMonth.getDay(); // 0 = Sun
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const today = new Date(); today.setHours(0, 0, 0, 0);
                  const msByDate = {};
                  milestones.forEach((m) => {
                    if (!msByDate[m.date]) msByDate[m.date] = [];
                    msByDate[m.date].push(m);
                  });
                  const toDateKey = (d) => {
                    const yy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
                    return `${yy}-${mm}-${dd}`;
                  };
                  const cells = [];
                  for (let i = 0; i < startDay; i++) cells.push(null);
                  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

                  return (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                        <button onClick={() => setCalMonth(new Date(year, month - 1, 1))} style={{ background: "transparent", border: "1px solid var(--c-border)", color: "var(--c-text-2)", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "13px" }}>‹</button>
                        <span style={{ color: "var(--c-text)", fontSize: "14px", fontWeight: "600" }}>
                          {firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                        </span>
                        <button onClick={() => setCalMonth(new Date(year, month + 1, 1))} style={{ background: "transparent", border: "1px solid var(--c-border)", color: "var(--c-text-2)", borderRadius: "6px", padding: "4px 10px", cursor: "pointer", fontSize: "13px" }}>›</button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px", marginBottom: "4px" }}>
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                          <div key={d} style={{ textAlign: "center", fontSize: "11px", color: "var(--c-text-3)", fontWeight: "600", padding: "4px 0" }}>{d}</div>
                        ))}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px" }}>
                        {cells.map((day, idx) => {
                          if (day === null) return <div key={`empty-${idx}`} />;
                          const cellDate = new Date(year, month, day);
                          const dateKey = toDateKey(cellDate);
                          const dayMs = msByDate[dateKey] || [];
                          const isToday = toDateKey(today) === dateKey;
                          return (
                            <div key={dateKey} style={{
                              minHeight: isMobile ? "56px" : "76px", padding: "4px", borderRadius: "6px",
                              background: isToday ? "var(--c-accent-dk)" : "var(--c-bg)",
                              border: `1px solid ${isToday ? "var(--c-accent)" : "var(--c-border)"}`,
                              display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden",
                            }}>
                              <span style={{ fontSize: "11px", color: isToday ? "var(--c-accent-lt)" : "var(--c-text-3)", fontWeight: isToday ? "700" : "400" }}>{day}</span>
                              {dayMs.slice(0, isMobile ? 1 : 2).map((m) => (
                                <span key={m.id} title={`${m.project?.name} — ${m.name}`} style={{
                                  display: "flex", flexDirection: "column", gap: "1px",
                                  fontWeight: "600", color: "var(--c-warn)", background: "var(--c-warn-bg)",
                                  border: "1px solid var(--c-warn)", borderRadius: "3px", padding: "1px 4px",
                                  overflow: "hidden",
                                }}>
                                  <span style={{ fontSize: "9px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.project?.name}</span>
                                  <span style={{ fontSize: "8px", fontWeight: "400", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                                </span>
                              ))}
                              {dayMs.length > (isMobile ? 1 : 2) && (
                                <span style={{ fontSize: "9px", color: "var(--c-text-3)" }}>+{dayMs.length - (isMobile ? 1 : 2)} more</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          )}

          {/* Per-project breakdown */}
          <h3 style={{ color: "var(--c-text)", fontSize: "15px", fontWeight: "600", margin: "0 0 16px" }}>Per-Project Breakdown</h3>
          <div style={{ display: "grid", gap: "12px" }}>
            {projects.map((p) => {
              const s = stats[p.id] || {};
              const total = s.total || 0;
              const applicable = total - (s.na || 0);
              const pct = applicable ? Math.round((s.complete / applicable) * 100) : 0;
              const isExp = expanded === p.id;
              const catSt = categoryStats[p.id] || {};
              return (
                <div key={p.id} style={{ background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "12px", overflow: "hidden" }}>
                  <div onClick={() => setExpanded(isExp ? null : p.id)} style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                    <div>
                      <h4 style={{ color: "var(--c-text)", margin: "0 0 4px", fontSize: "15px" }}>{p.name}</h4>
                      <p style={{ color: "var(--c-text-2)", margin: 0, fontSize: "12px" }}>{s.complete || 0} done · {s.pending || 0} pending · {s.na || 0} N/A</p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ color: pct === 100 ? "var(--c-ok-text)" : "var(--c-text)", fontSize: "22px", fontWeight: "700" }}>{pct}%</span>
                      <span style={{ color: "var(--c-text-3)", fontSize: "12px" }}>{isExp ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  <div style={{ height: "4px", background: "var(--c-bg)", margin: "0 20px 16px" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "var(--c-ok)" : "var(--c-accent)", borderRadius: "2px" }} />
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
                                <span style={{ color: "var(--c-text-2)", fontSize: "13px" }}>{cat.label}</span>
                                <span style={{ color: catPct === 100 ? "var(--c-ok-text)" : "var(--c-text-2)", fontSize: "12px", fontWeight: "600" }}>{catPct}% ({cs.done}/{cs.total})</span>
                              </div>
                              <div style={{ height: "4px", background: "var(--c-bg)", borderRadius: "2px" }}>
                                <div style={{ height: "100%", width: `${catPct}%`, background: catPct === 100 ? "var(--c-ok)" : "var(--c-accent)", borderRadius: "2px" }} />
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
