import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { CATEGORIES } from "../checklistTemplate";
import { useIsMobile } from "../useIsMobile";

export default function ChecklistView({ project, userRole, session, onBack, onSignOut }) {
  const isMobile = useIsMobile();
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [categoryConfig, setCategoryConfig] = useState({});
  const [profilesMap, setProfilesMap] = useState({});
  const [openComments, setOpenComments] = useState(null);
  const [commentsCache, setCommentsCache] = useState({});
  const [commentText, setCommentText] = useState("");
  const [addingComment, setAddingComment] = useState(false);
  const [viewMode, setViewMode] = useState("category");
  const [milestones, setMilestones] = useState([]);
  const [activeMilestoneId, setActiveMilestoneId] = useState(null);
  const [milestoneItemsCache, setMilestoneItemsCache] = useState({});
  const [milestoneLoading, setMilestoneLoading] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [checklistRes, configRes, memberRes, milestoneRes] = await Promise.all([
      supabase.from("checklists").select("*").eq("project_id", project.id).order("category").order("item_id"),
      supabase.from("project_checklist_config").select("*").eq("project_id", project.id),
      supabase.from("project_members").select("user_id").eq("project_id", project.id),
      supabase.from("project_milestones").select("*").eq("project_id", project.id).order("date"),
    ]);
    if (!checklistRes.error) setChecklists(checklistRes.data || []);
    const cfgMap = {};
    (configRes.data || []).forEach((r) => { cfgMap[r.category] = r.enabled; });
    setCategoryConfig(cfgMap);
    const ms = milestoneRes.data || [];
    setMilestones(ms);
    if (ms.length > 0) setActiveMilestoneId(ms[0].id);
    const userIds = (memberRes.data || []).map((r) => r.user_id);
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
      const pMap = {};
      (profiles || []).forEach((p) => { pMap[p.id] = p; });
      const { data: myProfile } = await supabase.from("profiles").select("id, full_name").eq("id", session.user.id).single();
      if (myProfile) pMap[myProfile.id] = myProfile;
      setProfilesMap(pMap);
    }
    setLoading(false);
  };

  const fetchMilestoneItems = async (milestoneId) => {
    if (milestoneItemsCache[milestoneId]) return;
    setMilestoneLoading(true);
    const { data } = await supabase.from("milestone_items").select("checklist_item_id").eq("milestone_id", milestoneId);
    const ids = new Set((data || []).map((r) => r.checklist_item_id));
    setMilestoneItemsCache((prev) => ({ ...prev, [milestoneId]: ids }));
    setMilestoneLoading(false);
  };

  const switchToMilestone = async (milestoneId) => {
    setActiveMilestoneId(milestoneId);
    await fetchMilestoneItems(milestoneId);
  };

  const handleViewModeToggle = async (mode) => {
    setViewMode(mode);
    if (mode === "milestone" && activeMilestoneId) await fetchMilestoneItems(activeMilestoneId);
  };

  const enabledCategories = CATEGORIES.filter((cat) => categoryConfig[cat.id] !== false);

  useEffect(() => {
    if (!activeCategory && enabledCategories.length > 0) setActiveCategory(enabledCategories[0].id);
  }, [categoryConfig, loading]);

  const canEdit = (category) => {
    if (userRole === "project_manager") return true;
    if (userRole === "engineer") return category !== "drafting";
    if (userRole === "drafter") return category === "drafting";
    return false;
  };

  const handleStatusChange = async (item, newStatus) => {
    if (!canEdit(item.category)) return;
    setUpdating(item.id);
    const updates = {
      status: newStatus,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
      completed_by: newStatus === "complete" ? session.user.id : null,
      completed_at: newStatus === "complete" ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from("checklists").update(updates).eq("id", item.id);
    if (!error) setChecklists((prev) => prev.map((c) => c.id === item.id ? { ...c, ...updates } : c));
    setUpdating(null);
  };

  const fetchComments = async (itemId) => {
    if (commentsCache[itemId]) return;
    const { data } = await supabase.from("checklist_comments").select("*").eq("checklist_item_id", itemId).order("created_at");
    const userIds = [...new Set((data || []).map((c) => c.user_id))];
    const pMap = { ...profilesMap };
    const missing = userIds.filter((id) => !pMap[id]);
    if (missing.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", missing);
      (profiles || []).forEach((p) => { pMap[p.id] = p; });
      setProfilesMap(pMap);
    }
    setCommentsCache((prev) => ({ ...prev, [itemId]: data || [] }));
  };

  const toggleComments = async (itemId) => {
    if (openComments === itemId) { setOpenComments(null); setCommentText(""); }
    else { setOpenComments(itemId); setCommentText(""); await fetchComments(itemId); }
  };

  const submitComment = async (itemId) => {
    if (!commentText.trim()) return;
    setAddingComment(true);
    const { data, error } = await supabase.from("checklist_comments").insert({
      checklist_item_id: itemId, user_id: session.user.id, comment: commentText.trim(),
    }).select().single();
    if (!error && data) {
      setCommentsCache((prev) => ({ ...prev, [itemId]: [...(prev[itemId] || []), data] }));
      setCommentText("");
    }
    setAddingComment(false);
  };

  const deleteComment = async (itemId, commentId) => {
    const { error } = await supabase.from("checklist_comments").delete().eq("id", commentId);
    if (!error) {
      setCommentsCache((prev) => ({
        ...prev,
        [itemId]: prev[itemId].filter((c) => c.id !== commentId),
      }));
    }
  };

  const getCategoryProgress = (categoryId) => {
    const items = checklists.filter((c) => c.category === categoryId);
    if (!items.length) return 0;
    return Math.round((items.filter((c) => c.status === "complete" || c.status === "na").length / items.length) * 100);
  };

  const getMilestoneProgress = (milestoneId) => {
    const ids = milestoneItemsCache[milestoneId];
    if (!ids || ids.size === 0) return 0;
    const items = checklists.filter((c) => ids.has(c.id));
    if (!items.length) return 0;
    return Math.round((items.filter((c) => c.status === "complete" || c.status === "na").length / items.length) * 100);
  };

  const totalItems = checklists.length;
  const completedItems = checklists.filter((c) => c.status === "complete").length;
  const naItems = checklists.filter((c) => c.status === "na").length;
  const pendingItems = checklists.filter((c) => c.status === "pending").length;
  const overallProgress = totalItems ? Math.round(((completedItems + naItems) / totalItems) * 100) : 0;

  const statusColors = {
    complete: { bg: "#052e16", border: "#22c55e", color: "#4ade80", label: isMobile ? "✓" : "Complete" },
    na:       { bg: "#1c1917", border: "#78716c", color: "#a8a29e", label: "N/A" },
    pending:  { bg: "#0c1a2e", border: "#334155", color: "#94a3b8", label: isMobile ? "—" : "Pending" },
  };

  const formatDate = (iso) => iso
    ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";

  const categoryItems = checklists.filter((c) => c.category === activeCategory);
  const groupedCategoryItems = categoryItems.reduce((acc, item) => {
    const key = item.sub_section || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const activeMilestoneItemIds = activeMilestoneId ? (milestoneItemsCache[activeMilestoneId] || null) : null;
  const milestoneItems = activeMilestoneItemIds ? checklists.filter((c) => activeMilestoneItemIds.has(c.id)) : [];
  const groupedMilestoneItems = milestoneItems.reduce((acc, item) => {
    const catLabel = CATEGORIES.find((c) => c.id === item.category)?.label || item.category;
    const key = item.sub_section ? `${catLabel} — ${item.sub_section}` : catLabel;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  // ── Item renderer ──────────────────────────────────────────────────────────
  const renderItem = (item, idx, totalInGroup) => {
    const editable = canEdit(item.category);
    const status = item.status || "pending";
    const isUpdating = updating === item.id;
    const completedByName = item.completed_by ? (profilesMap[item.completed_by]?.full_name || "Unknown") : null;
    const comments = commentsCache[item.id] || [];
    const isCommentsOpen = openComments === item.id;

    return (
      <div key={item.id} style={{
        borderBottom: idx < totalInGroup - 1 ? "1px solid #243044" : "none",
        background: idx % 2 === 0 ? "#1e293b" : "#172032",
      }}>
        <div style={{ padding: isMobile ? "12px" : "14px 16px", display: "flex", alignItems: "flex-start", gap: isMobile ? "8px" : "16px" }}>
          {/* Status buttons */}
          <div style={{ display: "flex", gap: isMobile ? "4px" : "6px", flexShrink: 0, paddingTop: "2px" }}>
            {["complete", "na", "pending"].map((s) => {
              const sc = statusColors[s];
              const isActive = status === s;
              return (
                <button key={s}
                  onClick={() => editable && !isUpdating && handleStatusChange(item, s)}
                  disabled={!editable || isUpdating}
                  style={{
                    padding: isMobile ? "5px 7px" : "4px 10px",
                    border: `1px solid ${isActive ? sc.border : "#334155"}`,
                    borderRadius: "6px", fontSize: isMobile ? "12px" : "11px", fontWeight: "600",
                    background: isActive ? sc.bg : "transparent",
                    color: isActive ? sc.color : "#64748b",
                    cursor: editable && !isUpdating ? "pointer" : "not-allowed",
                    minWidth: isMobile ? "32px" : undefined,
                  }}>
                  {sc.label}
                </button>
              );
            })}
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              margin: 0, fontSize: isMobile ? "13px" : "14px", lineHeight: "1.5",
              color: status === "na" ? "#64748b" : "#f1f5f9",
              textDecoration: status === "na" ? "line-through" : "none",
            }}>
              {item.item_text}
              {item.is_custom && (
                <span style={{ marginLeft: "8px", fontSize: "10px", color: "#a78bfa", background: "#2e1065", padding: "1px 6px", borderRadius: "4px" }}>custom</span>
              )}
            </p>
            {status === "complete" && completedByName && (
              <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#4ade80" }}>
                ✓ {completedByName} · {formatDate(item.completed_at)}
              </p>
            )}
          </div>

          {/* Comment toggle */}
          <button onClick={() => toggleComments(item.id)} style={{
            flexShrink: 0,
            background: isCommentsOpen ? "#1e3a5f" : "transparent",
            border: `1px solid ${isCommentsOpen ? "#3b82f6" : "#334155"}`,
            color: isCommentsOpen ? "#60a5fa" : "#64748b",
            borderRadius: "6px", padding: isMobile ? "5px 8px" : "4px 10px",
            fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap",
          }}>
            💬{comments.length > 0 ? ` ${comments.length}` : ""}
          </button>
        </div>

        {/* Comments panel */}
        {isCommentsOpen && (
          <div style={{ borderTop: "1px solid #243044", padding: "12px 16px 14px", background: "#111827" }}>
            {comments.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "13px", margin: "0 0 10px" }}>No comments yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "8px", marginBottom: "12px" }}>
                {comments.map((c) => (
                  <div key={c.id} style={{ background: "#1e293b", borderRadius: "8px", padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", color: "#60a5fa", fontWeight: "600" }}>
                        {profilesMap[c.user_id]?.full_name || "Unknown"}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{formatDate(c.created_at)}</span>
                        {c.user_id === session.user.id && (
                          <button
                            onClick={() => deleteComment(item.id, c.id)}
                            title="Delete comment"
                            style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: 0 }}
                            onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"}
                            onMouseLeave={(e) => e.currentTarget.style.color = "#64748b"}>
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                    <p style={{ color: "#f1f5f9", fontSize: "13px", margin: 0, lineHeight: "1.5" }}>{c.comment}</p>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <input value={commentText} onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitComment(item.id)}
                placeholder="Add a comment… (Enter to send)"
                style={{ flex: 1, padding: "8px 12px", background: "#1e293b", border: "1px solid #334155", borderRadius: "6px", color: "#f1f5f9", fontSize: "13px" }}
              />
              <button onClick={() => submitComment(item.id)} disabled={addingComment || !commentText.trim()}
                style={{ padding: "8px 14px", background: "#3b82f6", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSection = (subSection, items) => (
    <div key={subSection} style={{ marginBottom: "20px" }}>
      {subSection !== "General" && (
        <div style={{ background: "#1e293b", borderLeft: "3px solid #3b82f6", padding: "7px 14px", marginBottom: "8px", borderRadius: "0 6px 6px 0" }}>
          <span style={{ color: "#60a5fa", fontSize: "12px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em" }}>{subSection}</span>
        </div>
      )}
      <div style={{ background: "#1e293b", borderRadius: "12px", border: "1px solid #334155", overflow: "hidden" }}>
        {items.map((item, idx) => renderItem(item, idx, items.length))}
      </div>
    </div>
  );

  // ── Mobile selector pills ──────────────────────────────────────────────────
  const MobilePills = () => {
    const items = viewMode === "category"
      ? enabledCategories.map((cat) => ({
          id: cat.id,
          label: cat.label,
          progress: getCategoryProgress(cat.id),
          active: activeCategory === cat.id,
          onClick: () => setActiveCategory(cat.id),
        }))
      : milestones.map((m) => ({
          id: m.id,
          label: m.name,
          progress: milestoneItemsCache[m.id] ? getMilestoneProgress(m.id) : null,
          active: activeMilestoneId === m.id,
          onClick: () => switchToMilestone(m.id),
        }));

    return (
      <div style={{ overflowX: "auto", display: "flex", gap: "8px", padding: "10px 16px", background: "#1e293b", borderBottom: "1px solid #334155" }}>
        {items.map((item) => (
          <button key={item.id} onClick={item.onClick} style={{
            flexShrink: 0, padding: "6px 12px", border: "none", borderRadius: "20px",
            background: item.active ? "#3b82f6" : "#0f172a",
            color: item.active ? "white" : "#94a3b8",
            fontSize: "12px", fontWeight: item.active ? "600" : "400", cursor: "pointer",
            whiteSpace: "nowrap",
          }}>
            {item.label}{item.progress !== null ? ` · ${item.progress}%` : ""}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", fontFamily: "Inter, sans-serif", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: isMobile ? "12px 16px" : "16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <button onClick={onBack} style={{ background: "#334155", color: "#f1f5f9", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "13px", flexShrink: 0 }}>
              ←
            </button>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: isMobile ? "15px" : "18px", fontWeight: "700", color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {project.name}
              </h1>
              <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8" }}>
                {completedItems} done · {naItems} N/A · {pendingItems} pending · {overallProgress}%
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {!isMobile && (
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                Role: <strong style={{ color: "#f1f5f9" }}>{userRole.replace("_", " ")}</strong>
              </span>
            )}
            <button onClick={onSignOut} style={{ padding: "6px 12px", background: "#ef4444", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
              {isMobile ? "↩" : "Sign Out"}
            </button>
          </div>
        </div>
      </div>

      {/* View mode toggle */}
      <div style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: "0 16px", display: "flex" }}>
        {[{ id: "category", label: "By Category" }, { id: "milestone", label: "By Milestone" }].map(({ id, label }) => (
          <button key={id} onClick={() => handleViewModeToggle(id)} style={{
            padding: "10px 16px", border: "none", background: "transparent", cursor: "pointer",
            fontSize: "13px", fontWeight: viewMode === id ? "600" : "400",
            color: viewMode === id ? "#3b82f6" : "#64748b",
            borderBottom: `2px solid ${viewMode === id ? "#3b82f6" : "transparent"}`,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Mobile: horizontal pill selector */}
      {isMobile && <MobilePills />}

      {/* Desktop: sidebar + content / Mobile: just content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Sidebar (desktop only) */}
        {!isMobile && (
          <div style={{ width: "220px", background: "#1e293b", borderRight: "1px solid #334155", overflowY: "auto", padding: "12px" }}>
            {viewMode === "category" ? (
              enabledCategories.map((cat) => {
                const progress = getCategoryProgress(cat.id);
                const isActive = activeCategory === cat.id;
                return (
                  <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
                    width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 10px", marginBottom: "4px", border: "none", borderRadius: "8px",
                    background: isActive ? "#3b82f6" : "transparent",
                    color: isActive ? "white" : canEdit(cat.id) ? "#f1f5f9" : "#64748b",
                    cursor: "pointer", fontSize: "13px", textAlign: "left",
                  }}>
                    <span style={{ flex: 1 }}>{cat.label}</span>
                    <span style={{ fontSize: "11px", fontWeight: "600", color: isActive ? "white" : progress === 100 ? "#4ade80" : "#94a3b8" }}>
                      {progress}%
                    </span>
                  </button>
                );
              })
            ) : (
              milestones.length === 0 ? (
                <p style={{ color: "#64748b", fontSize: "12px", padding: "8px" }}>No milestones set up.</p>
              ) : (
                milestones.map((m) => {
                  const isActive = activeMilestoneId === m.id;
                  const progress = getMilestoneProgress(m.id);
                  const daysUntil = Math.ceil((new Date(m.date + "T00:00:00") - new Date()) / (1000 * 60 * 60 * 24));
                  const isAlert = daysUntil >= 0 && daysUntil <= m.days_before_alert;
                  return (
                    <button key={m.id} onClick={() => switchToMilestone(m.id)} style={{
                      width: "100%", padding: "10px", marginBottom: "6px", border: "none", borderRadius: "8px",
                      background: isActive ? "#3b82f6" : "transparent",
                      color: isActive ? "white" : "#f1f5f9", cursor: "pointer", textAlign: "left",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                        <span style={{ fontSize: "13px", fontWeight: "600" }}>{m.name}</span>
                        <span style={{ fontSize: "11px", fontWeight: "600", color: isActive ? "white" : progress === 100 ? "#4ade80" : "#94a3b8" }}>
                          {milestoneItemsCache[m.id] ? `${progress}%` : ""}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{ fontSize: "11px", color: isActive ? "rgba(255,255,255,0.7)" : "#64748b" }}>
                          {new Date(m.date + "T00:00:00").toLocaleDateString()}
                        </span>
                        {isAlert && !isActive && <span style={{ fontSize: "10px", color: "#f59e0b" }}>⚠</span>}
                      </div>
                    </button>
                  );
                })
              )
            )}
          </div>
        )}

        {/* Main content */}
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : "24px" }}>
          {loading ? (
            <p style={{ color: "#94a3b8" }}>Loading checklist...</p>
          ) : viewMode === "category" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
                <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: isMobile ? "16px" : "20px" }}>
                  {CATEGORIES.find((c) => c.id === activeCategory)?.label}
                </h2>
                {activeCategory && !canEdit(activeCategory) && (
                  <span style={{ fontSize: "11px", color: "#f59e0b", background: "#451a03", padding: "4px 10px", borderRadius: "20px", border: "1px solid #f59e0b" }}>
                    View only
                  </span>
                )}
              </div>
              {Object.entries(groupedCategoryItems).map(([sub, items]) => renderSection(sub, items))}
            </>
          ) : (
            milestones.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <p style={{ color: "#94a3b8", fontSize: "16px" }}>No milestones set up.</p>
                <p style={{ color: "#64748b", fontSize: "14px" }}>Go to Project Setup → Milestones.</p>
              </div>
            ) : milestoneLoading || activeMilestoneItemIds === null ? (
              <p style={{ color: "#94a3b8" }}>Loading milestone items...</p>
            ) : activeMilestoneItemIds.size === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <p style={{ color: "#94a3b8", fontSize: "16px" }}>No items assigned to this milestone.</p>
                <p style={{ color: "#64748b", fontSize: "14px" }}>Go to Project Setup → Milestones → Assign Items.</p>
              </div>
            ) : (
              <>
                {(() => {
                  const m = milestones.find((x) => x.id === activeMilestoneId);
                  const pct = getMilestoneProgress(activeMilestoneId);
                  const daysUntil = m ? Math.ceil((new Date(m.date + "T00:00:00") - new Date()) / (1000 * 60 * 60 * 24)) : null;
                  const isAlert = m && daysUntil >= 0 && daysUntil <= m.days_before_alert;
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "8px" }}>
                      <div>
                        <h2 style={{ color: "#f1f5f9", margin: "0 0 4px", fontSize: isMobile ? "16px" : "20px" }}>{m?.name}</h2>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ color: "#94a3b8", fontSize: "13px" }}>{m && new Date(m.date + "T00:00:00").toLocaleDateString()}</span>
                          {isAlert && <span style={{ fontSize: "12px", color: "#f59e0b", background: "#451a03", padding: "2px 10px", borderRadius: "20px" }}>⚠ {daysUntil}d remaining</span>}
                        </div>
                      </div>
                      <span style={{ color: pct === 100 ? "#4ade80" : "#f1f5f9", fontSize: "28px", fontWeight: "700" }}>{pct}%</span>
                    </div>
                  );
                })()}
                {Object.entries(groupedMilestoneItems).map(([sub, items]) => renderSection(sub, items))}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
