import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { CATEGORIES } from "../checklistTemplate";
import { useIsMobile } from "../useIsMobile";
import AgeLogo from "./AgeLogo";
import NotificationBell from "./NotificationBell";

export default function ChecklistView({ project, userRole, session, onBack, onSignOut, onGoToProjects }) {
  const isMobile = useIsMobile();
  const [checklists, setChecklists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState(null);
  const [updating, setUpdating] = useState(null);
  const [categoryConfig, setCategoryConfig] = useState({}); // { [catKey]: { enabled, label } }
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
  const [filterStatus, setFilterStatus] = useState("all"); // all | pending | complete | na
  const [filterMilestoneId, setFilterMilestoneId] = useState("all");

  useEffect(() => { fetchAll(); }, []);

  // Real-time: update checklist items as other users make changes
  useEffect(() => {
    const ch = supabase
      .channel(`checklist-${project.id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "checklists",
        filter: `project_id=eq.${project.id}`,
      }, (payload) => {
        setChecklists((prev) =>
          prev.map((c) => c.id === payload.new.id ? { ...c, ...payload.new } : c)
        );
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [project.id]);

  const [itemMsMap, setItemMsMap] = useState({}); // itemId → [milestoneName, ...]

  const fetchAll = async () => {
    setLoading(true);
    const [checklistRes, configRes, memberRes, milestoneRes] = await Promise.all([
      supabase.from("checklists").select("*").eq("project_id", project.id).order("category").order("sort_order", { nullsFirst: false }).order("item_id"),
      supabase.from("project_checklist_config").select("*").eq("project_id", project.id),
      supabase.from("project_members").select("user_id").eq("project_id", project.id),
      supabase.from("project_milestones").select("*").eq("project_id", project.id).order("date"),
    ]);
    if (!checklistRes.error) setChecklists(checklistRes.data || []);
    const cfgMap = {};
    (configRes.data || []).forEach((r) => { cfgMap[r.category] = { enabled: r.enabled, label: r.label }; });
    setCategoryConfig(cfgMap);
    const ms = milestoneRes.data || [];
    setMilestones(ms);
    if (ms.length > 0) {
      setActiveMilestoneId(ms[0].id);
      // Build itemId → [milestoneName] map for display
      const msIds = ms.map((m) => m.id);
      const { data: miData } = await supabase.from("milestone_items")
        .select("milestone_id, checklist_item_id").in("milestone_id", msIds);
      const imMap = {};
      (miData || []).forEach(({ milestone_id, checklist_item_id }) => {
        if (!imMap[checklist_item_id]) imMap[checklist_item_id] = [];
        const msName = ms.find((m) => m.id === milestone_id)?.name;
        if (msName) imMap[checklist_item_id].push(msName);
      });
      setItemMsMap(imMap);
    }
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

  const setFilterMilestone = async (milestoneId) => {
    setFilterMilestoneId(milestoneId);
    if (milestoneId !== "all") await fetchMilestoneItems(milestoneId);
  };

  const handleViewModeToggle = async (mode) => {
    setViewMode(mode);
    if (mode === "milestone" && activeMilestoneId) await fetchMilestoneItems(activeMilestoneId);
  };

  const standardCatIds = new Set(CATEGORIES.map((c) => c.id));
  const customCats = Object.entries(categoryConfig)
    .filter(([key, val]) => !standardCatIds.has(key) && val?.label)
    .map(([key, val]) => ({ id: key, label: val.label }));
  const allCategories = [...CATEGORIES, ...customCats];
  const enabledCategories = allCategories.filter((cat) => categoryConfig[cat.id]?.enabled !== false);

  const getCatLabel = (catId) =>
    categoryConfig[catId]?.label || CATEGORIES.find((c) => c.id === catId)?.label || catId;

  // Build reference codes: itemId → "PREFIX-S.I"
  const refCodes = (() => {
    const codes = {};
    enabledCategories.forEach((cat) => {
      const label = getCatLabel(cat.id);
      const prefix = label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
      const catItems = [...checklists.filter((c) => c.category === cat.id)]
        .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.item_id.localeCompare(b.item_id));
      // Ordered unique sections
      const seenSections = [];
      catItems.forEach((item) => {
        const s = item.sub_section || null;
        if (!seenSections.includes(s)) seenSections.push(s);
      });
      seenSections.forEach((section, sIdx) => {
        const sNum = sIdx + 1;
        catItems.filter((i) => (i.sub_section || null) === section)
          .forEach((item, iIdx) => { codes[item.id] = `${prefix}-${sNum}.${iIdx + 1}`; });
      });
    });
    return codes;
  })();

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
    complete: { bg: "#1a3318", border: "#4da447", color: "#7ecb7b", label: isMobile ? "✓" : "Complete" },
    na:       { bg: "#1c1917", border: "#78716c", color: "#a8a29e", label: "N/A" },
    pending:  { bg: "#0c1a2e", border: "#334155", color: "#94a3b8", label: isMobile ? "—" : "Pending" },
  };

  const formatDate = (iso) => iso
    ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";

  const filterMilestoneSet = filterMilestoneId !== "all" ? (milestoneItemsCache[filterMilestoneId] || null) : null;

  const applyFilters = (items) => items.filter((item) => {
    if (filterStatus !== "all" && (item.status || "pending") !== filterStatus) return false;
    if (filterMilestoneSet && !filterMilestoneSet.has(item.id)) return false;
    return true;
  });

  const categoryItems = applyFilters(checklists.filter((c) => c.category === activeCategory));
  const groupedCategoryItems = categoryItems.reduce((acc, item) => {
    const key = item.sub_section || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const activeMilestoneItemIds = activeMilestoneId ? (milestoneItemsCache[activeMilestoneId] || null) : null;
  const milestoneItems = activeMilestoneItemIds ? applyFilters(checklists.filter((c) => activeMilestoneItemIds.has(c.id))) : [];
  const groupedMilestoneItems = milestoneItems.reduce((acc, item) => {
    const catLabel = getCatLabel(item.category);
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
    const sc = statusColors[status];
    const msList = itemMsMap[item.id] || [];

    return (
      <div key={item.id} style={{
        borderBottom: idx < totalInGroup - 1 ? "1px solid #1e293b" : "none",
        background: "#0f172a",
      }}>
        <div style={{ padding: isMobile ? "10px 12px" : "12px 16px" }}>

          {/* Row 1: ID · current status badge · spacer · status buttons · comment */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
            {refCodes[item.id] && (
              <span style={{ fontSize: "10px", fontWeight: "700", color: "#334155", fontFamily: "monospace", letterSpacing: "0.05em", background: "#1e293b", border: "1px solid #243044", borderRadius: "4px", padding: "2px 6px", flexShrink: 0 }}>
                {refCodes[item.id]}
              </span>
            )}
            {/* Current status as read badge */}
            <span style={{ fontSize: "10px", fontWeight: "700", color: sc.color, background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: "20px", padding: "2px 10px", flexShrink: 0 }}>
              {status === "complete" ? "Complete" : status === "na" ? "N/A" : "Pending"}
            </span>
            {item.is_custom && <span style={{ fontSize: "10px", color: "#a78bfa", background: "#2e1065", padding: "2px 7px", borderRadius: "20px" }}>custom</span>}
            {item.edited_by_pm && <span style={{ fontSize: "10px", color: "#f59e0b", background: "#451a03", padding: "2px 7px", borderRadius: "20px" }}>✏ edited</span>}

            {/* Push status buttons and comment to the right */}
            <div style={{ flex: 1 }} />

            {/* Status action buttons */}
            {editable && (
              <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                {["complete", "na", "pending"].map((s) => {
                  const btn = statusColors[s];
                  const isActive = status === s;
                  return (
                    <button key={s}
                      onClick={() => !isUpdating && handleStatusChange(item, s)}
                      disabled={isUpdating}
                      title={s === "complete" ? "Mark Complete" : s === "na" ? "Mark N/A" : "Mark Pending"}
                      style={{
                        padding: isMobile ? "4px 8px" : "4px 12px",
                        border: `1px solid ${isActive ? btn.border : "#334155"}`,
                        borderRadius: "6px", fontSize: "11px", fontWeight: "600",
                        background: isActive ? btn.bg : "transparent",
                        color: isActive ? btn.color : "#475569",
                        cursor: isUpdating ? "not-allowed" : "pointer",
                        transition: "all 0.1s",
                      }}>
                      {s === "complete" ? "✓" : s === "na" ? "N/A" : "—"}
                    </button>
                  );
                })}
              </div>
            )}
            {!editable && (
              <span style={{ fontSize: "11px", color: "#475569", fontStyle: "italic", flexShrink: 0 }}>view only</span>
            )}

            {/* Comment button */}
            <button onClick={() => toggleComments(item.id)} style={{
              flexShrink: 0,
              background: isCommentsOpen ? "#012d5a" : "transparent",
              border: `1px solid ${isCommentsOpen ? "#0095da" : "#334155"}`,
              color: isCommentsOpen ? "#33bdef" : "#64748b",
              borderRadius: "6px", padding: "4px 10px",
              fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap",
            }}>
              💬{comments.length > 0 ? ` ${comments.length}` : ""}
            </button>
          </div>

          {/* Row 2: Item description */}
          <p style={{
            margin: "0 0 8px", fontSize: isMobile ? "13px" : "14px", lineHeight: "1.6",
            color: status === "na" ? "#475569" : "#e2e8f0",
            textDecoration: status === "na" ? "line-through" : "none",
          }}>
            {item.item_text}
          </p>

          {/* Row 3: Completed by + milestones */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            {status === "complete" && completedByName && (
              <span style={{ fontSize: "11px", color: "#7ecb7b", flexShrink: 0 }}>
                ✓ {completedByName} · {formatDate(item.completed_at)}
              </span>
            )}
            {milestones.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px" }}>
                <span style={{ fontSize: "10px", color: "#475569", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>Milestones:</span>
                {msList.length > 0
                  ? msList.map((name) => (
                      <span key={name} style={{ fontSize: "10px", background: "#012d5a", color: "#33bdef", border: "1px solid #0095da", borderRadius: "3px", padding: "2px 7px" }}>{name}</span>
                    ))
                  : <span style={{ fontSize: "10px", color: "#ef4444", background: "#2d0a0a", border: "1px solid #7f1d1d", borderRadius: "3px", padding: "2px 7px" }}>⚠ not assigned</span>
                }
              </div>
            )}
          </div>
        </div>

        {/* Comments panel */}
        {isCommentsOpen && (
          <div style={{ borderTop: "1px solid #1e293b", padding: "12px 16px 14px", background: "#060d1a" }}>
            {comments.length === 0 ? (
              <p style={{ color: "#64748b", fontSize: "13px", margin: "0 0 10px" }}>No comments yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "8px", marginBottom: "12px" }}>
                {comments.map((c) => (
                  <div key={c.id} style={{ background: "#1e293b", borderRadius: "8px", padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", color: "#33bdef", fontWeight: "600" }}>
                        {profilesMap[c.user_id]?.full_name || "Unknown"}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{formatDate(c.created_at)}</span>
                        {c.user_id === session.user.id && (
                          <button onClick={() => deleteComment(item.id, c.id)}
                            style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: 0 }}
                            onMouseEnter={(e) => e.currentTarget.style.color = "#ef4444"}
                            onMouseLeave={(e) => e.currentTarget.style.color = "#64748b"}>×</button>
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
                style={{ padding: "8px 14px", background: "#0095da", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSection = (subSection, items) => {
    // Derive section ref: find the first item's code and take the section part (e.g. "ARCH-2")
    const firstCode = items[0] ? refCodes[items[0].id] : null;
    const sectionRef = firstCode ? firstCode.replace(/\.\d+$/, "") : null;
    const isGeneral = subSection === "General";
    return (
      <div key={subSection} style={{ marginBottom: "16px" }}>
        {!isGeneral && (
          <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#0c1a2e", borderLeft: "3px solid #0095da", padding: "8px 16px", marginBottom: "2px", borderRadius: "0 8px 0 0" }}>
            {sectionRef && (
              <span style={{ fontSize: "10px", fontWeight: "700", color: "#0095da", fontFamily: "monospace", letterSpacing: "0.05em", background: "#012d5a", border: "1px solid #0095da", borderRadius: "4px", padding: "2px 7px", flexShrink: 0 }}>
                {sectionRef}
              </span>
            )}
            <span style={{ flex: 1, textAlign: "center", color: "#f1f5f9", fontSize: isMobile ? "12px" : "13px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {subSection}
            </span>
            <span style={{ fontSize: "10px", color: "#475569", flexShrink: 0 }}>{items.length} items</span>
          </div>
        )}
        <div style={{ borderRadius: isGeneral ? "10px" : "0 0 10px 10px", border: "1px solid #1e293b", borderTop: isGeneral ? undefined : "none", overflow: "hidden", display: "grid", gap: "1px", background: "#1e293b" }}>
          {items.map((item, idx) => renderItem(item, idx, items.length))}
        </div>
      </div>
    );
  };

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
            background: item.active ? "#0095da" : "#0f172a",
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
    <div style={{ minHeight: "100vh", background: "#0f172a", fontFamily: "Manrope, sans-serif", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ background: "#1e293b", borderBottom: "1px solid #334155", padding: isMobile ? "12px 16px" : "16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <button onClick={onBack} style={{ background: "#334155", color: "#f1f5f9", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "13px", flexShrink: 0 }}>
              ←
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {!isMobile && <AgeLogo height={18} />}
                <h1 style={{ margin: 0, fontSize: isMobile ? "15px" : "16px", fontWeight: "700", color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {project.name}
                </h1>
              </div>
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
            <NotificationBell userId={session.user.id} onGoToProjects={onGoToProjects} />
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
            color: viewMode === id ? "#0095da" : "#64748b",
            borderBottom: `2px solid ${viewMode === id ? "#0095da" : "transparent"}`,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ background: "#0f172a", borderBottom: "1px solid #243044", padding: isMobile ? "8px 12px" : "8px 20px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: "4px" }}>Filter:</span>

        {/* Milestone filter */}
        {milestones.length > 0 && (<>
          <button onClick={() => setFilterMilestone("all")} style={{
            padding: isMobile ? "4px 10px" : "4px 12px", borderRadius: "20px", border: "1px solid",
            fontSize: "12px", fontWeight: "600", cursor: "pointer",
            background: filterMilestoneId === "all" ? "#012d5a" : "transparent",
            borderColor: filterMilestoneId === "all" ? "#0095da" : "#334155",
            color: filterMilestoneId === "all" ? "#33bdef" : "#64748b",
          }}>All Milestones</button>
          {milestones.map((m) => (
            <button key={m.id} onClick={() => setFilterMilestone(m.id)} style={{
              padding: isMobile ? "4px 10px" : "4px 12px", borderRadius: "20px", border: "1px solid",
              fontSize: "12px", fontWeight: "600", cursor: "pointer",
              background: filterMilestoneId === m.id ? "#012d5a" : "transparent",
              borderColor: filterMilestoneId === m.id ? "#0095da" : "#334155",
              color: filterMilestoneId === m.id ? "#33bdef" : "#64748b",
              maxWidth: isMobile ? "120px" : "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{m.name}</button>
          ))}
          <div style={{ width: "1px", height: "16px", background: "#334155", margin: "0 4px" }} />
        </>)}

        {/* Status filter */}
        {[
          { id: "all", label: "All Status" },
          { id: "pending", label: "Pending" },
          { id: "complete", label: "Complete" },
          { id: "na", label: "N/A" },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setFilterStatus(id)} style={{
            padding: isMobile ? "4px 10px" : "4px 12px", borderRadius: "20px", border: "1px solid",
            fontSize: "12px", fontWeight: "600", cursor: "pointer",
            background: filterStatus === id ? (id === "complete" ? "#1a3318" : id === "pending" ? "#0c1a2e" : id === "na" ? "#1c1917" : "#1e293b") : "transparent",
            borderColor: filterStatus === id ? (id === "complete" ? "#4da447" : id === "pending" ? "#0095da" : id === "na" ? "#78716c" : "#334155") : "#334155",
            color: filterStatus === id ? (id === "complete" ? "#7ecb7b" : id === "pending" ? "#33bdef" : id === "na" ? "#a8a29e" : "#f1f5f9") : "#64748b",
          }}>
            {label}
          </button>
        ))}

        {/* Clear filters */}
        {(filterMilestoneId !== "all" || filterStatus !== "all") && (
          <button onClick={() => { setFilterMilestoneId("all"); setFilterStatus("all"); }} style={{
            padding: "4px 10px", borderRadius: "20px", border: "1px solid #ef4444",
            fontSize: "11px", fontWeight: "600", cursor: "pointer",
            background: "transparent", color: "#ef4444", marginLeft: "4px",
          }}>
            ✕ Clear
          </button>
        )}
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
                    background: isActive ? "#0095da" : "transparent",
                    color: isActive ? "white" : canEdit(cat.id) ? "#f1f5f9" : "#64748b",
                    cursor: "pointer", fontSize: "13px", textAlign: "left",
                  }}>
                    <span style={{ flex: 1 }}>{cat.label}</span>
                    <span style={{ fontSize: "11px", fontWeight: "600", color: isActive ? "white" : progress === 100 ? "#7ecb7b" : "#94a3b8" }}>
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
                      background: isActive ? "#0095da" : "transparent",
                      color: isActive ? "white" : "#f1f5f9", cursor: "pointer", textAlign: "left",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                        <span style={{ fontSize: "13px", fontWeight: "600" }}>{m.name}</span>
                        <span style={{ fontSize: "11px", fontWeight: "600", color: isActive ? "white" : progress === 100 ? "#7ecb7b" : "#94a3b8" }}>
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
                  {getCatLabel(activeCategory)}
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
                      <span style={{ color: pct === 100 ? "#7ecb7b" : "#f1f5f9", fontSize: "28px", fontWeight: "700" }}>{pct}%</span>
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
