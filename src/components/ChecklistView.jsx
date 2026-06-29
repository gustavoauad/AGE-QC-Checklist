import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { CATEGORIES } from "../checklistTemplate";
import { useIsMobile } from "../useIsMobile";
import AgeLogo from "./AgeLogo";
import NotificationBell from "./NotificationBell";

export default function ChecklistView({ project, userRole, session, onBack, onSignOut, onGoToProjects, onOpenSetup }) {
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
  const [filterStatus, setFilterStatus] = useState("all"); // all | pending | complete | na | in_progress
  const [filterMilestoneId, setFilterMilestoneId] = useState("all");
  const [filterApplicable, setFilterApplicable] = useState(false);
  const [helpPopover, setHelpPopover] = useState(null); // item.id
  const [itemMsIdMap, setItemMsIdMap] = useState({}); // itemId → [milestoneId, ...]
  const [qaqcAlerts, setQaqcAlerts] = useState([]); // flagged comments
  const [qaqcAlertsLoaded, setQaqcAlertsLoaded] = useState(false);
  const [dashReplyText, setDashReplyText] = useState({}); // { [itemId]: string }
  const [dashReplying, setDashReplying] = useState(null); // itemId

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
  const [commentMeta, setCommentMeta] = useState({}); // itemId → { count, hasQaqc }
  const [itemDeps, setItemDeps] = useState({}); // itemId → Set<parentId>

  const fetchAll = async () => {
    setLoading(true);
    const [checklistRes, configRes, memberRes, milestoneRes] = await Promise.all([
      supabase.from("checklists").select("*").eq("project_id", project.id).order("category").order("sort_order", { nullsFirst: false }).order("item_id"),
      supabase.from("project_checklist_config").select("*").eq("project_id", project.id),
      supabase.from("project_members").select("user_id").eq("project_id", project.id),
      supabase.from("project_milestones").select("*").eq("project_id", project.id).order("date"),
    ]);
    const items = checklistRes.data || [];
    if (!checklistRes.error) setChecklists(items);

    // Fetch comment metadata (count + QAQC flag) for all items upfront
    if (items.length > 0) {
      const { data: cmData } = await supabase
        .from("checklist_comments")
        .select("checklist_item_id, is_qaqc_flagged")
        .in("checklist_item_id", items.map((c) => c.id));
      const meta = {};
      (cmData || []).forEach((c) => {
        if (!meta[c.checklist_item_id]) meta[c.checklist_item_id] = { count: 0, hasQaqc: false };
        meta[c.checklist_item_id].count++;
        if (c.is_qaqc_flagged) meta[c.checklist_item_id].hasQaqc = true;
      });
      setCommentMeta(meta);
    }
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
      const imIdMap = {};
      (miData || []).forEach(({ milestone_id, checklist_item_id }) => {
        if (!imIdMap[checklist_item_id]) imIdMap[checklist_item_id] = [];
        imIdMap[checklist_item_id].push(milestone_id);
      });
      setItemMsIdMap(imIdMap);
    }
    // Load item dependencies
    if (items.length > 0) {
      const { data: depsData } = await supabase
        .from("checklist_item_dependencies")
        .select("item_id, depends_on_item_id")
        .in("item_id", items.map((c) => c.id));
      const dMap = {};
      (depsData || []).forEach(({ item_id, depends_on_item_id }) => {
        if (!dMap[item_id]) dMap[item_id] = new Set();
        dMap[item_id].add(depends_on_item_id);
      });
      setItemDeps(dMap);
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
    if (userRole === "qaqc") return true;
    if (userRole === "engineer") return category !== "drafting";
    if (userRole === "drafter") return category === "drafting";
    return false;
  };

  const getItemDueDate = (item) => {
    if (!item.days_before_milestone) return null;
    const msIds = itemMsIdMap[item.id] || [];
    if (!msIds.length) return null;
    const dates = msIds.map((id) => {
      const m = milestones.find((x) => x.id === id);
      if (!m?.date) return null;
      const msDate = new Date(m.date + "T00:00:00");
      return new Date(msDate.getTime() - item.days_before_milestone * 86400000);
    }).filter(Boolean);
    return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  };

  // Returns all items that (transitively) depend on itemId (children + grandchildren…)
  const getDescendants = (itemId) => {
    const reverseDeps = {};
    Object.entries(itemDeps).forEach(([childId, parentSet]) => {
      parentSet.forEach((pid) => {
        if (!reverseDeps[pid]) reverseDeps[pid] = [];
        reverseDeps[pid].push(childId);
      });
    });
    const result = [];
    const stack = reverseDeps[itemId] || [];
    const visited = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      result.push(id);
      (reverseDeps[id] || []).forEach((c) => stack.push(c));
    }
    return result;
  };

  const handleStatusChange = async (item, newStatus) => {
    if (!canEdit(item.category)) return;

    // Block completion if any parent dependency is not yet complete
    if (newStatus === "complete") {
      const parentIds = [...(itemDeps[item.id] || new Set())];
      const incomplete = checklists.filter((c) => parentIds.includes(c.id) && c.status !== "complete" && c.status !== "na");
      if (incomplete.length > 0) {
        alert(
          `Cannot mark as complete — the following ${incomplete.length === 1 ? "dependency" : "dependencies"} must be completed first:\n\n` +
          incomplete.map((c) => `• ${refCodes[c.id] ? refCodes[c.id] + "  " : ""}${c.item_text}`).join("\n")
        );
        return;
      }
    }

    // N/A cascade: if marking N/A, auto-cascade to all dependent children
    if (newStatus === "na") {
      const descendantIds = getDescendants(item.id);
      const toNa = checklists.filter((c) => descendantIds.includes(c.id) && c.status !== "na");
      if (toNa.length > 0) {
        const ok = window.confirm(
          `Marking this item as N/A will also mark ${toNa.length} dependent item${toNa.length > 1 ? "s" : ""} as N/A:\n\n` +
          toNa.map((c) => `• ${refCodes[c.id] ? refCodes[c.id] + "  " : ""}${c.item_text}`).join("\n") +
          "\n\nProceed?"
        );
        if (!ok) return;
        const naUpdates = { status: "na", completed_by: null, completed_at: null, in_progress_by: null, in_progress_at: null };
        await Promise.all(toNa.map((c) => supabase.from("checklists").update(naUpdates).eq("id", c.id)));
        setChecklists((prev) => prev.map((c) => toNa.find((x) => x.id === c.id) ? { ...c, ...naUpdates } : c));
      }
    }

    setUpdating(item.id);
    const now = new Date().toISOString();
    const updates = {
      status: newStatus,
      completed_by: newStatus === "complete" ? session.user.id : null,
      completed_at: newStatus === "complete" ? now : null,
      in_progress_by: newStatus === "in_progress" ? session.user.id : null,
      in_progress_at: newStatus === "in_progress" ? now : null,
    };
    const { error } = await supabase.from("checklists").update(updates).eq("id", item.id);
    if (error) console.error("Status update failed:", error.message);
    else setChecklists((prev) => prev.map((c) => c.id === item.id ? { ...c, ...updates } : c));
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
      is_qaqc_flagged: userRole === "qaqc",
    }).select().single();
    if (!error && data) {
      setCommentsCache((prev) => ({ ...prev, [itemId]: [...(prev[itemId] || []), data] }));
      setCommentMeta((prev) => {
        const cur = prev[itemId] || { count: 0, hasQaqc: false };
        return { ...prev, [itemId]: { count: cur.count + 1, hasQaqc: cur.hasQaqc || !!data.is_qaqc_flagged } };
      });
      setQaqcAlertsLoaded(false); // refresh dashboard alerts on next open
      setCommentText("");
    }
    setAddingComment(false);
  };

  const loadQaqcAlerts = async () => {
    if (qaqcAlertsLoaded) return;
    const itemIds = checklists.map((c) => c.id);
    if (!itemIds.length) { setQaqcAlertsLoaded(true); return; }
    const { data } = await supabase
      .from("checklist_comments")
      .select("*, checklist:checklists(id, item_text, category)")
      .eq("is_qaqc_flagged", true)
      .in("checklist_item_id", itemIds)
      .order("created_at", { ascending: false });
    const alerts = (data || []).map((c) => ({
      ...c,
      authorName: profilesMap[c.user_id]?.full_name || "QAQC",
      itemText: c.checklist?.item_text || "",
      itemCategory: c.checklist?.category || null,
    }));
    setQaqcAlerts(alerts);
    setQaqcAlertsLoaded(true);
  };

  const submitDashReply = async (itemId) => {
    const text = (dashReplyText[itemId] || "").trim();
    if (!text) return;
    setDashReplying(itemId);
    const { data, error } = await supabase.from("checklist_comments").insert({
      checklist_item_id: itemId, user_id: session.user.id, comment: text,
      is_qaqc_flagged: userRole === "qaqc",
    }).select().single();
    if (!error && data) {
      setCommentsCache((prev) => ({ ...prev, [itemId]: [...(prev[itemId] || []), data] }));
      setCommentMeta((prev) => {
        const cur = prev[itemId] || { count: 0, hasQaqc: false };
        return { ...prev, [itemId]: { count: cur.count + 1, hasQaqc: cur.hasQaqc || !!data.is_qaqc_flagged } };
      });
      setDashReplyText((prev) => ({ ...prev, [itemId]: "" }));
      setQaqcAlertsLoaded(false);
      await loadQaqcAlerts();
    }
    setDashReplying(null);
  };

  const goToItem = (itemId, category) => {
    setViewMode("category");
    setActiveCategory(category);
    setOpenComments(itemId);
    fetchComments(itemId);
  };

  const deleteComment = async (itemId, commentId) => {
    const deletedComment = (commentsCache[itemId] || []).find((c) => c.id === commentId);
    const { error } = await supabase.from("checklist_comments").delete().eq("id", commentId);
    if (!error) {
      const remaining = (commentsCache[itemId] || []).filter((c) => c.id !== commentId);
      setCommentsCache((prev) => ({ ...prev, [itemId]: remaining }));
      setCommentMeta((prev) => {
        const cur = prev[itemId] || { count: 0, hasQaqc: false };
        const newCount = Math.max(0, cur.count - 1);
        const stillHasQaqc = remaining.some((c) => c.is_qaqc_flagged);
        return { ...prev, [itemId]: { count: newCount, hasQaqc: stillHasQaqc } };
      });
      if (deletedComment?.is_qaqc_flagged) setQaqcAlertsLoaded(false);
    }
  };

  const getCategoryStats = (categoryId) => {
    const items = checklists.filter((c) => c.category === categoryId);
    const done = items.filter((c) => c.status === "complete").length;
    const na = items.filter((c) => c.status === "na").length;
    const applicable = items.length - na;
    const pct = applicable ? Math.round((done / applicable) * 100) : 0;
    return { done, na, applicable, total: items.length, pct };
  };

  // keep alias for legacy callers
  const getCategoryProgress = (categoryId) => getCategoryStats(categoryId).pct;

  const getMilestoneStats = (milestoneId) => {
    const ids = milestoneItemsCache[milestoneId];
    if (!ids || ids.size === 0) return { done: 0, applicable: 0, pct: 0 };
    const items = checklists.filter((c) => ids.has(c.id));
    const done = items.filter((c) => c.status === "complete").length;
    const na = items.filter((c) => c.status === "na").length;
    const applicable = items.length - na;
    return { done, applicable, pct: applicable ? Math.round((done / applicable) * 100) : 0 };
  };

  const getMilestoneProgress = (milestoneId) => getMilestoneStats(milestoneId).pct;

  const totalItems = checklists.length;
  const completedItems = checklists.filter((c) => c.status === "complete").length;
  const naItems = checklists.filter((c) => c.status === "na").length;
  const pendingItems = checklists.filter((c) => c.status === "pending").length;
  const applicableItems = totalItems - naItems;
  const overallProgress = applicableItems ? Math.round((completedItems / applicableItems) * 100) : 0;

  const statusColors = {
    complete:    { bg: "var(--c-ok-bg)", border: "var(--c-ok)", color: "var(--c-ok-text)", label: "Complete" },
    in_progress: { bg: "var(--c-purple-bg)", border: "var(--c-purple)", color: "var(--c-purple)", label: "In Progress" },
    na:          { bg: "var(--c-neutral-bg)", border: "var(--c-neutral)", color: "var(--c-neutral-text)", label: "N/A" },
    pending:     { bg: "var(--c-surface-alt)", border: "var(--c-border)", color: "var(--c-text-2)", label: "Pending" },
  };

  const formatDate = (iso) => iso
    ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";

  const filterMilestoneSet = filterMilestoneId !== "all" ? (milestoneItemsCache[filterMilestoneId] || null) : null;

  const applyFilters = (items) => items.filter((item) => {
    if (filterApplicable && (item.status || "pending") === "na") return false;
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
    const inProgressByName = item.in_progress_by ? (profilesMap[item.in_progress_by]?.full_name || "Unknown") : null;
    const comments = commentsCache[item.id] || [];
    const isCommentsOpen = openComments === item.id;
    const meta = commentMeta[item.id] || { count: 0, hasQaqc: false };
    const sc = statusColors[status] || statusColors.pending;
    const msList = itemMsMap[item.id] || [];
    const dueDate = getItemDueDate(item);
    const today = new Date(); today.setHours(0,0,0,0);
    const dueDaysLeft = dueDate ? Math.ceil((dueDate - today) / 86400000) : null;
    const isPastDue = dueDate && dueDate < today && status !== "complete" && status !== "na";
    const isDueSoon = dueDate && dueDaysLeft >= 0 && dueDaysLeft <= 7 && status !== "complete" && status !== "na";
    const isHelpOpen = helpPopover === item.id;

    return (
      <div key={item.id} style={{
        borderBottom: idx < totalInGroup - 1 ? "1px solid #1e293b" : "none",
        background: "var(--c-bg)",
      }}>
        <div style={{ padding: isMobile ? "10px 12px" : "12px 16px" }}>

          {/* Row 1: ID · current status badge · spacer · status buttons · comment */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
            {refCodes[item.id] && (
              <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--c-border)", fontFamily: "monospace", letterSpacing: "0.05em", background: "var(--c-surface)", border: "1px solid #243044", borderRadius: "4px", padding: "2px 6px", flexShrink: 0 }}>
                {refCodes[item.id]}
              </span>
            )}
            {/* Current status as read badge */}
            <span style={{ fontSize: "10px", fontWeight: "700", color: sc.color, background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: "20px", padding: "2px 10px", flexShrink: 0 }}>
              {sc.label}
            </span>
            {item.is_custom && <span style={{ fontSize: "10px", color: "var(--c-purple)", background: "var(--c-purple-bg)", padding: "2px 7px", borderRadius: "20px" }}>custom</span>}
            {item.edited_by_pm && <span style={{ fontSize: "10px", color: "var(--c-warn)", background: "var(--c-warn-bg)", padding: "2px 7px", borderRadius: "20px" }}>✏ edited</span>}
            {meta.hasQaqc && (
              <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--c-warn)", background: "var(--c-warn-bg)", border: "1px solid var(--c-warn)", padding: "2px 8px", borderRadius: "20px", letterSpacing: "0.03em" }}>
                🚩 QA/QC
              </span>
            )}
            {!meta.hasQaqc && meta.count > 0 && (
              <span style={{ fontSize: "10px", fontWeight: "600", color: "var(--c-accent-lt)", background: "var(--c-accent-dk)", border: "1px solid #0095da", padding: "2px 8px", borderRadius: "20px" }}>
                💬 {meta.count}
              </span>
            )}
            {/* Dependency chips */}
            {[...(itemDeps[item.id] || new Set())].map((parentId) => {
              const parent = checklists.find((c) => c.id === parentId);
              if (!parent) return null;
              const parentDone = parent.status === "complete" || parent.status === "na";
              return (
                <span key={parentId} title={`Depends on: ${parent.item_text}`}
                  style={{ fontSize: "10px", fontWeight: "600", color: parentDone ? "var(--c-ok-text)" : "var(--c-warn)", background: parentDone ? "var(--c-ok-bg)" : "var(--c-warn-bg)", border: `1px solid ${parentDone ? "var(--c-ok)" : "var(--c-warn)"}`, padding: "2px 8px", borderRadius: "20px", cursor: "default", whiteSpace: "nowrap" }}>
                  ⛓ {refCodes[parentId] || "dep"}
                </span>
              );
            })}

            {/* Push status buttons and comment to the right */}
            <div style={{ flex: 1 }} />

            {/* Status action buttons — toggle on/off, pending is implicit default */}
            {editable && (
              <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                {[
                  { s: "complete",    label: "✓",   title: "Complete" },
                  { s: "in_progress", label: "▶",   title: "In Progress" },
                  { s: "na",          label: "N/A", title: "N/A" },
                ].map(({ s, label, title }) => {
                  const btn = statusColors[s];
                  const isActive = status === s;
                  return (
                    <button key={s}
                      onClick={() => !isUpdating && handleStatusChange(item, isActive ? "pending" : s)}
                      disabled={isUpdating}
                      title={isActive ? `Remove ${title}` : `Mark ${title}`}
                      style={{
                        padding: isMobile ? "4px 7px" : "4px 10px",
                        border: `1px solid ${isActive ? btn.border : "var(--c-border)"}`,
                        borderRadius: "6px", fontSize: "11px", fontWeight: "600",
                        background: isActive ? btn.bg : "transparent",
                        color: isActive ? btn.color : "var(--c-text-4)",
                        cursor: isUpdating ? "not-allowed" : "pointer",
                        transition: "all 0.1s",
                      }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {!editable && (
              <span style={{ fontSize: "11px", color: "var(--c-text-4)", fontStyle: "italic", flexShrink: 0 }}>view only</span>
            )}

            {/* Comment button */}
            <button onClick={() => toggleComments(item.id)} style={{
              flexShrink: 0,
              background: isCommentsOpen ? "var(--c-accent-dk)" : meta.hasQaqc ? "var(--c-warn-bg)" : "transparent",
              border: `1px solid ${isCommentsOpen ? "var(--c-accent)" : meta.hasQaqc ? "var(--c-warn)" : "var(--c-border)"}`,
              color: isCommentsOpen ? "var(--c-accent-lt)" : meta.hasQaqc ? "var(--c-warn)" : "var(--c-text-3)",
              borderRadius: "6px", padding: "4px 10px",
              fontSize: "11px", cursor: "pointer", whiteSpace: "nowrap", fontWeight: meta.hasQaqc ? "700" : "400",
            }}>
              💬{meta.count > 0 ? ` ${meta.count}` : ""}
            </button>

            {/* Help popover button */}
            {item.help_text && (
              <div style={{ position: "relative", flexShrink: 0 }}>
                <button onClick={() => setHelpPopover(isHelpOpen ? null : item.id)} title="More info" style={{
                  background: isHelpOpen ? "var(--c-accent-dk)" : "transparent",
                  border: `1px solid ${isHelpOpen ? "var(--c-accent)" : "var(--c-border)"}`,
                  color: isHelpOpen ? "var(--c-accent-lt)" : "var(--c-text-3)",
                  borderRadius: "6px", padding: "4px 8px", fontSize: "13px", cursor: "pointer",
                }}>ⓘ</button>
                {isHelpOpen && (
                  <div style={{
                    position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 100,
                    background: "var(--c-surface)", border: "1px solid var(--c-accent)", borderRadius: "8px",
                    padding: "10px 14px", width: "260px", fontSize: "12px", lineHeight: "1.5",
                    color: "var(--c-text-2)", boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                  }}>
                    {item.help_text}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Row 2: Item description */}
          <p style={{
            margin: "0 0 8px", fontSize: isMobile ? "13px" : "14px", lineHeight: "1.6",
            color: status === "na" ? "var(--c-text-4)" : "var(--c-text)",
            textDecoration: status === "na" ? "line-through" : "none",
          }}>
            {item.item_text}
          </p>

          {/* Row 3: Attribution + due date + milestones */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
            {status === "complete" && completedByName && (
              <span style={{ fontSize: "11px", color: "var(--c-ok-text)", flexShrink: 0 }}>
                ✓ {completedByName} · {formatDate(item.completed_at)}
              </span>
            )}
            {status === "in_progress" && inProgressByName && (
              <span style={{ fontSize: "11px", color: "var(--c-purple)", flexShrink: 0 }}>
                ▶ {inProgressByName} · {formatDate(item.in_progress_at)}
              </span>
            )}
            {dueDate && status !== "complete" && status !== "na" && (
              <span style={{
                fontSize: "10px", fontWeight: "700", flexShrink: 0,
                color: isPastDue ? "var(--c-err)" : isDueSoon ? "var(--c-warn)" : "var(--c-text-3)",
                background: isPastDue ? "var(--c-err-bg)" : isDueSoon ? "var(--c-warn-bg)" : "transparent",
                border: `1px solid ${isPastDue ? "#7f1d1d" : isDueSoon ? "var(--c-warn)" : "var(--c-border)"}`,
                borderRadius: "3px", padding: "2px 7px",
              }}>
                {isPastDue ? "⚠ PAST DUE" : isDueSoon ? `⚠ due in ${dueDaysLeft}d` : `due ${formatDate(dueDate.toISOString())}`}
              </span>
            )}
            {milestones.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px" }}>
                <span style={{ fontSize: "10px", color: "var(--c-text-4)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>Milestones:</span>
                {msList.length > 0
                  ? msList.map((name) => (
                      <span key={name} style={{ fontSize: "10px", background: "var(--c-accent-dk)", color: "var(--c-accent-lt)", border: "1px solid #0095da", borderRadius: "3px", padding: "2px 7px" }}>{name}</span>
                    ))
                  : <span style={{ fontSize: "10px", color: "var(--c-err)", background: "var(--c-err-bg)", border: "1px solid #7f1d1d", borderRadius: "3px", padding: "2px 7px" }}>⚠ not assigned</span>
                }
              </div>
            )}
          </div>
        </div>

        {/* Comments panel */}
        {isCommentsOpen && (
          <div style={{ borderTop: "1px solid #1e293b", padding: "12px 16px 14px", background: "var(--c-surface-deep)" }}>
            {comments.length === 0 ? (
              <p style={{ color: "var(--c-text-3)", fontSize: "13px", margin: "0 0 10px" }}>No comments yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "8px", marginBottom: "12px" }}>
                {comments.map((c) => (
                  <div key={c.id} style={{ background: "var(--c-surface)", borderRadius: "8px", padding: "10px 12px", border: c.is_qaqc_flagged ? "1px solid var(--c-warn)" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "12px", color: "var(--c-accent-lt)", fontWeight: "600" }}>
                          {profilesMap[c.user_id]?.full_name || "Unknown"}
                        </span>
                        {c.is_qaqc_flagged && (
                          <span style={{ fontSize: "10px", color: "var(--c-warn)", background: "var(--c-warn-bg)", border: "1px solid var(--c-warn)", borderRadius: "20px", padding: "1px 7px", fontWeight: "700" }}>
                            QA/QC
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "11px", color: "var(--c-text-3)" }}>{formatDate(c.created_at)}</span>
                        {c.user_id === session.user.id && (
                          <button onClick={() => deleteComment(item.id, c.id)}
                            style={{ background: "none", border: "none", color: "var(--c-text-3)", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: 0 }}
                            onMouseEnter={(e) => e.currentTarget.style.color = "var(--c-err)"}
                            onMouseLeave={(e) => e.currentTarget.style.color = "var(--c-text-3)"}>×</button>
                        )}
                      </div>
                    </div>
                    <p style={{ color: "var(--c-text)", fontSize: "13px", margin: 0, lineHeight: "1.5" }}>{c.comment}</p>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <input value={commentText} onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitComment(item.id)}
                placeholder="Add a comment… (Enter to send)"
                style={{ flex: 1, padding: "8px 12px", background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "6px", color: "var(--c-text)", fontSize: "13px" }}
              />
              <button onClick={() => submitComment(item.id)} disabled={addingComment || !commentText.trim()}
                style={{ padding: "8px 14px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--c-surface-alt)", borderLeft: "3px solid #0095da", padding: "8px 16px", marginBottom: "2px", borderRadius: "0 8px 0 0" }}>
            {sectionRef && (
              <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--c-accent)", fontFamily: "monospace", letterSpacing: "0.05em", background: "var(--c-accent-dk)", border: "1px solid #0095da", borderRadius: "4px", padding: "2px 7px", flexShrink: 0 }}>
                {sectionRef}
              </span>
            )}
            <span style={{ flex: 1, textAlign: "center", color: "var(--c-text)", fontSize: isMobile ? "12px" : "13px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {subSection}
            </span>
            <span style={{ fontSize: "10px", color: "var(--c-text-4)", flexShrink: 0 }}>{items.length} items</span>
          </div>
        )}
        <div style={{ borderRadius: isGeneral ? "10px" : "0 0 10px 10px", border: "1px solid #1e293b", borderTop: isGeneral ? undefined : "none", overflow: "hidden", display: "grid", gap: "1px", background: "var(--c-surface)" }}>
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
      <div style={{ overflowX: "auto", display: "flex", gap: "8px", padding: "10px 16px", background: "var(--c-surface)", borderBottom: "1px solid #334155" }}>
        {items.map((item) => (
          <button key={item.id} onClick={item.onClick} style={{
            flexShrink: 0, padding: "6px 12px", border: "none", borderRadius: "20px",
            background: item.active ? "var(--c-accent)" : "var(--c-bg)",
            color: item.active ? "white" : "var(--c-text-2)",
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
    <div style={{ minHeight: "100vh", background: "var(--c-bg)", fontFamily: "Manrope, sans-serif", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ background: "var(--c-surface)", borderBottom: "1px solid #334155", padding: isMobile ? "12px 16px" : "16px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            <button onClick={onBack} style={{ background: "var(--c-border)", color: "var(--c-text)", border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", fontSize: "13px", flexShrink: 0 }}>
              ←
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                {!isMobile && <AgeLogo height={18} />}
                <h1 style={{ margin: 0, fontSize: isMobile ? "15px" : "16px", fontWeight: "700", color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {project.name}
                </h1>
              </div>
              <p style={{ margin: 0, fontSize: "11px", color: "var(--c-text-2)" }}>
                <span style={{ color: overallProgress === 100 ? "var(--c-ok-text)" : "var(--c-text-2)" }}>
                  {completedItems} / {applicableItems} done ({overallProgress}%)
                </span>
                {" · "}{pendingItems} pending{naItems > 0 ? ` · ${naItems} N/A` : ""}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {!isMobile && (
              <span style={{ fontSize: "11px", color: "var(--c-text-3)", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "20px", padding: "2px 8px" }}>
                {userRole === "project_manager" ? "PM" : userRole.replace("_", " ")}
              </span>
            )}
            {userRole === "project_manager" && onOpenSetup && (
              <button onClick={onOpenSetup} title="Project Setup" style={{
                padding: "6px 10px", background: "transparent", border: "1px solid var(--c-border)",
                color: "var(--c-text-2)", borderRadius: "6px", cursor: "pointer", fontSize: "14px", lineHeight: 1,
              }}>⚙</button>
            )}
            <NotificationBell userId={session.user.id} onGoToProjects={onGoToProjects} />
            <button onClick={onSignOut} style={{ padding: "6px 12px", background: "var(--c-err)", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
              {isMobile ? "↩" : "Sign Out"}
            </button>
          </div>
        </div>
      </div>

      {/* View mode toggle */}
      <div style={{ background: "var(--c-surface)", borderBottom: "1px solid #334155", padding: "0 16px", display: "flex" }}>
        {[
          { id: "category",  label: "By Category" },
          { id: "milestone", label: "By Milestone" },
          { id: "dashboard", label: "📊 Dashboard" },
        ].map(({ id, label }) => (
          <button key={id} onClick={async () => {
            if (id === "dashboard") { setViewMode("dashboard"); await loadQaqcAlerts(); }
            else handleViewModeToggle(id);
          }} style={{
            padding: "10px 16px", border: "none", background: "transparent", cursor: "pointer",
            fontSize: "13px", fontWeight: viewMode === id ? "600" : "400",
            color: viewMode === id ? "var(--c-accent)" : "var(--c-text-3)",
            borderBottom: `2px solid ${viewMode === id ? "var(--c-accent)" : "transparent"}`,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div style={{ background: "var(--c-bg)", borderBottom: "1px solid #243044", padding: isMobile ? "8px 12px" : "8px 20px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: "11px", color: "var(--c-text-3)", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: "4px" }}>Filter:</span>

        {/* Milestone filter */}
        {milestones.length > 0 && (<>
          <button onClick={() => setFilterMilestone("all")} style={{
            padding: isMobile ? "4px 10px" : "4px 12px", borderRadius: "20px", border: "1px solid",
            fontSize: "12px", fontWeight: "600", cursor: "pointer",
            background: filterMilestoneId === "all" ? "var(--c-accent-dk)" : "transparent",
            borderColor: filterMilestoneId === "all" ? "var(--c-accent)" : "var(--c-border)",
            color: filterMilestoneId === "all" ? "var(--c-accent-lt)" : "var(--c-text-3)",
          }}>All Milestones</button>
          {milestones.map((m) => (
            <button key={m.id} onClick={() => setFilterMilestone(m.id)} style={{
              padding: isMobile ? "4px 10px" : "4px 12px", borderRadius: "20px", border: "1px solid",
              fontSize: "12px", fontWeight: "600", cursor: "pointer",
              background: filterMilestoneId === m.id ? "var(--c-accent-dk)" : "transparent",
              borderColor: filterMilestoneId === m.id ? "var(--c-accent)" : "var(--c-border)",
              color: filterMilestoneId === m.id ? "var(--c-accent-lt)" : "var(--c-text-3)",
              maxWidth: isMobile ? "120px" : "180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{m.name}</button>
          ))}
          <div style={{ width: "1px", height: "16px", background: "var(--c-border)", margin: "0 4px" }} />
        </>)}

        {/* Applicable filter */}
        <button onClick={() => setFilterApplicable((v) => !v)} style={{
          padding: isMobile ? "4px 10px" : "4px 12px", borderRadius: "20px", border: "1px solid",
          fontSize: "12px", fontWeight: "600", cursor: "pointer",
          background: filterApplicable ? "var(--c-accent-2)" : "transparent",
          borderColor: filterApplicable ? "var(--c-accent-lt)" : "var(--c-border)",
          color: filterApplicable ? "var(--c-accent-lt)" : "var(--c-text-3)",
        }}>Applicable</button>
        <div style={{ width: "1px", height: "16px", background: "var(--c-border)", margin: "0 4px" }} />

        {/* Status filter */}
        {[
          { id: "all",         label: "All Status" },
          { id: "pending",     label: "Pending" },
          { id: "in_progress", label: "In Progress" },
          { id: "complete",    label: "Complete" },
          { id: "na",          label: "N/A" },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setFilterStatus(id)} style={{
            padding: isMobile ? "4px 10px" : "4px 12px", borderRadius: "20px", border: "1px solid",
            fontSize: "12px", fontWeight: "600", cursor: "pointer",
            background: filterStatus === id ? (id === "complete" ? "var(--c-ok-bg)" : id === "pending" ? "var(--c-surface-alt)" : id === "na" ? "var(--c-neutral-bg)" : "var(--c-surface)") : "transparent",
            borderColor: filterStatus === id ? (id === "complete" ? "var(--c-ok)" : id === "pending" ? "var(--c-accent)" : id === "na" ? "var(--c-neutral)" : "var(--c-border)") : "var(--c-border)",
            color: filterStatus === id ? (id === "complete" ? "var(--c-ok-text)" : id === "pending" ? "var(--c-accent-lt)" : id === "na" ? "var(--c-neutral-text)" : "var(--c-text)") : "var(--c-text-3)",
          }}>
            {label}
          </button>
        ))}

        {/* Clear filters */}
        {(filterMilestoneId !== "all" || filterStatus !== "all" || filterApplicable) && (
          <button onClick={() => { setFilterMilestoneId("all"); setFilterStatus("all"); setFilterApplicable(false); }} style={{
            padding: "4px 10px", borderRadius: "20px", border: "1px solid #ef4444",
            fontSize: "11px", fontWeight: "600", cursor: "pointer",
            background: "transparent", color: "var(--c-err)", marginLeft: "4px",
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
          <div style={{ width: "220px", background: "var(--c-surface)", borderRight: "1px solid #334155", overflowY: "auto", padding: "12px" }}>
            {viewMode === "dashboard" ? (() => {
              const today = new Date(); today.setHours(0,0,0,0);
              const inProgCount = checklists.filter((c) => c.status === "in_progress").length;
              const withDue = checklists
                .filter((c) => c.days_before_milestone && c.status !== "complete" && c.status !== "na")
                .map((c) => ({ id: c.id, dueDate: getItemDueDate(c) }))
                .filter((c) => c.dueDate);
              const pastDueCount = withDue.filter((c) => c.dueDate < today).length;
              const dueSoonCount = withDue.filter((c) => { const d = Math.ceil((c.dueDate - today) / 86400000); return d >= 0 && d <= 7; }).length;
              const sections = [
                { label: "QA/QC Alerts",  icon: "🚩", count: qaqcAlerts.length,  color: "var(--c-warn)" },
                { label: "Past Due",       icon: "⚠",  count: pastDueCount,       color: "var(--c-err)" },
                { label: "Due Soon",       icon: "⏰", count: dueSoonCount,       color: "var(--c-warn)" },
                { label: "In Progress",    icon: "▶",  count: inProgCount,        color: "var(--c-purple)" },
              ];
              return (
                <>
                  <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "4px 0 12px 4px" }}>Overview</p>
                  {sections.map(({ label, icon, count, color }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: "8px", marginBottom: "4px", background: count > 0 ? "transparent" : "transparent" }}>
                      <span style={{ fontSize: "13px", color: count > 0 ? "var(--c-text)" : "var(--c-text-4)" }}>{icon} {label}</span>
                      <span style={{ fontSize: "12px", fontWeight: "700", color: count > 0 ? color : "var(--c-text-4)",
                        background: count > 0 ? undefined : "transparent",
                        minWidth: "20px", textAlign: "right" }}>
                        {count > 0 ? count : "—"}
                      </span>
                    </div>
                  ))}
                  <div style={{ borderTop: "1px solid var(--c-border)", margin: "12px 0" }} />
                  <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px 4px" }}>Progress</p>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "12px", color: "var(--c-text-2)" }}>Overall</span>
                      <span style={{ fontSize: "12px", fontWeight: "700", color: overallProgress === 100 ? "var(--c-ok-text)" : "var(--c-accent)" }}>{overallProgress}%</span>
                    </div>
                    <div style={{ height: "6px", background: "var(--c-border)", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${overallProgress}%`, background: overallProgress === 100 ? "var(--c-ok)" : "var(--c-accent)", borderRadius: "3px", transition: "width 0.3s" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "11px", color: "var(--c-text-3)" }}>
                      <span>✓ {completedItems}</span>
                      <span>▶ {inProgCount}</span>
                      <span>— {pendingItems}</span>
                    </div>
                  </div>
                </>
              );
            })() : viewMode === "category" ? (
              enabledCategories.map((cat) => {
                const { done, applicable, pct } = getCategoryStats(cat.id);
                const isActive = activeCategory === cat.id;
                const isDone = applicable > 0 && done === applicable;
                return (
                  <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
                    width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 10px", marginBottom: "4px", border: "none", borderRadius: "8px",
                    background: isActive ? "var(--c-accent)" : "transparent",
                    color: isActive ? "white" : canEdit(cat.id) ? "var(--c-text)" : "var(--c-text-3)",
                    cursor: "pointer", fontSize: "13px", textAlign: "left",
                  }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                    <span style={{ fontSize: "10px", fontWeight: "600", flexShrink: 0, marginLeft: "6px",
                      color: isActive ? "rgba(255,255,255,0.85)" : isDone ? "var(--c-ok-text)" : "var(--c-text-3)",
                      whiteSpace: "nowrap" }}>
                      {done}/{applicable} · {pct}%
                    </span>
                  </button>
                );
              })
            ) : (
              milestones.length === 0 ? (
                <p style={{ color: "var(--c-text-3)", fontSize: "12px", padding: "8px" }}>No milestones set up.</p>
              ) : (

                milestones.map((m) => {
                  const isActive = activeMilestoneId === m.id;
                  const daysUntil = Math.ceil((new Date(m.date + "T00:00:00") - new Date()) / (1000 * 60 * 60 * 24));
                  const isAlert = daysUntil >= 0 && daysUntil <= m.days_before_alert;
                  return (
                    <button key={m.id} onClick={() => switchToMilestone(m.id)} style={{
                      width: "100%", padding: "10px", marginBottom: "6px", border: "none", borderRadius: "8px",
                      background: isActive ? "var(--c-accent)" : "transparent",
                      color: isActive ? "white" : "var(--c-text)", cursor: "pointer", textAlign: "left",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                        <span style={{ fontSize: "13px", fontWeight: "600" }}>{m.name}</span>
                        {milestoneItemsCache[m.id] ? (() => {
                          const ms = getMilestoneStats(m.id);
                          return (
                            <span style={{ fontSize: "10px", fontWeight: "600", whiteSpace: "nowrap",
                              color: isActive ? "rgba(255,255,255,0.85)" : ms.done === ms.applicable && ms.applicable > 0 ? "var(--c-ok-text)" : "var(--c-text-3)" }}>
                              {ms.done}/{ms.applicable} · {ms.pct}%
                            </span>
                          );
                        })() : null}
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span style={{ fontSize: "11px", color: isActive ? "rgba(255,255,255,0.7)" : "var(--c-text-3)" }}>
                          {new Date(m.date + "T00:00:00").toLocaleDateString()}
                        </span>
                        {isAlert && !isActive && <span style={{ fontSize: "10px", color: "var(--c-warn)" }}>⚠</span>}
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
            <p style={{ color: "var(--c-text-2)" }}>Loading checklist...</p>
          ) : viewMode === "dashboard" ? (() => {
            const today = new Date(); today.setHours(0,0,0,0);
            const inProgressItems = checklists.filter((c) => c.status === "in_progress");
            const itemsWithDue = checklists
              .filter((c) => c.days_before_milestone && c.status !== "complete" && c.status !== "na")
              .map((c) => ({ ...c, dueDate: getItemDueDate(c) }))
              .filter((c) => c.dueDate);
            const pastDueItems = itemsWithDue.filter((c) => c.dueDate < today);
            const dueSoonItems = itemsWithDue.filter((c) => {
              const diff = Math.ceil((c.dueDate - today) / 86400000);
              return diff >= 0 && diff <= 7;
            });
            const statCard = (label, value, color) => (
              <div key={label} style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "10px", padding: "16px 20px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", fontWeight: "800", color: color || "var(--c-text)" }}>{value}</div>
                <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "4px" }}>{label}</div>
              </div>
            );
            const DueList = ({ items, title, color }) => items.length === 0 ? null : (
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: color, margin: "0 0 10px", fontSize: "14px", fontWeight: "700" }}>{title}</h3>
                <div style={{ display: "grid", gap: "6px" }}>
                  {items.map((c) => {
                    const dLeft = Math.ceil((c.dueDate - today) / 86400000);
                    return (
                      <div key={c.id} style={{ background: "var(--c-surface)", border: `1px solid ${color}`, borderRadius: "8px", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: "10px", color: "var(--c-text-4)", fontFamily: "monospace" }}>{refCodes[c.id]} </span>
                          <span style={{ fontSize: "13px", color: "var(--c-text)" }}>{c.item_text}</span>
                        </div>
                        <span style={{ fontSize: "10px", fontWeight: "700", color, flexShrink: 0 }}>
                          {dLeft < 0 ? `${Math.abs(dLeft)}d overdue` : dLeft === 0 ? "due today" : `${dLeft}d left`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
            // Build milestoneId → Set<itemId> from itemMsIdMap
            const milestoneItemIds = {};
            Object.entries(itemMsIdMap).forEach(([itemId, msIds]) => {
              msIds.forEach((msId) => {
                if (!milestoneItemIds[msId]) milestoneItemIds[msId] = new Set();
                milestoneItemIds[msId].add(itemId);
              });
            });
            const getMsProgress = (msId) => {
              const ids = [...(milestoneItemIds[msId] || new Set())];
              const msItems = ids.map((id) => checklists.find((c) => c.id === id)).filter(Boolean);
              const done = msItems.filter((c) => c.status === "complete").length;
              const applicable = msItems.filter((c) => c.status !== "na").length;
              return { items: msItems, done, applicable, pct: applicable ? Math.round(done / applicable * 100) : 0 };
            };
            const upcomingMs = milestones
              .map((m) => ({ ...m, dateObj: new Date(m.date + "T12:00:00") }))
              .sort((a, b) => a.dateObj - b.dateObj);
            const nextMs = upcomingMs.find((m) => m.dateObj >= today) || null;

            // Status donut chart helpers
            const CIRC = 2 * Math.PI * 54;
            const inProgressCount = inProgressItems.length;
            const donutSegments = [
              { pct: totalItems ? completedItems / totalItems : 0, color: "#22c55e", label: "Complete" },
              { pct: totalItems ? inProgressCount / totalItems : 0, color: "#a855f7", label: "In Progress" },
              { pct: totalItems ? naItems / totalItems : 0, color: "#475569", label: "N/A" },
              { pct: totalItems ? pendingItems / totalItems : 0, color: "#334155", label: "Pending" },
            ];

            return (
              <>
                <h2 style={{ color: "var(--c-text)", margin: "0 0 20px", fontSize: "18px" }}>Project Dashboard</h2>

                {/* Current / Next Milestone Banner */}
                {nextMs && (() => {
                  const dLeft = Math.ceil((nextMs.dateObj - today) / 86400000);
                  const { done, applicable, pct } = getMsProgress(nextMs.id);
                  return (
                    <div style={{ background: "var(--c-accent-dk)", border: "1px solid var(--c-accent)", borderRadius: "12px", padding: "16px 20px", marginBottom: "24px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: "10px", fontWeight: "700", color: "var(--c-accent-lt)", textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 4px" }}>Next Milestone</p>
                          <h3 style={{ margin: "0 0 2px", color: "var(--c-text)", fontSize: "18px", fontWeight: "800", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nextMs.name}</h3>
                          <p style={{ margin: 0, fontSize: "12px", color: "var(--c-text-3)" }}>{formatDate(nextMs.date + "T12:00:00")}</p>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <span style={{ fontSize: "36px", fontWeight: "800", color: dLeft <= 7 ? "var(--c-warn)" : "var(--c-accent-lt)", lineHeight: 1 }}>{dLeft}</span>
                          <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--c-text-3)" }}>day{dLeft !== 1 ? "s" : ""} left</p>
                        </div>
                      </div>
                      {applicable > 0 && (
                        <div style={{ marginTop: "14px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                            <span style={{ fontSize: "11px", color: "var(--c-text-3)" }}>{done}/{applicable} items complete</span>
                            <span style={{ fontSize: "11px", fontWeight: "700", color: pct === 100 ? "#22c55e" : "var(--c-accent-lt)" }}>{pct}%</span>
                          </div>
                          <div style={{ height: "6px", background: "rgba(0,0,0,0.35)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#22c55e" : "var(--c-accent-lt)", borderRadius: "3px", transition: "width 0.3s" }} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* QA/QC flagged comments — top priority banner */}
                {qaqcAlerts.length > 0 && (
                  <div style={{ marginBottom: "24px", background: "var(--c-warn-bg)", border: "2px solid var(--c-warn)", borderRadius: "10px", padding: "14px 16px" }}>
                    <h3 style={{ color: "var(--c-warn)", margin: "0 0 12px", fontSize: "14px", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                      🚩 QA/QC Comments Requiring Response
                      <span style={{ background: "var(--c-warn)", color: "white", borderRadius: "20px", padding: "1px 9px", fontSize: "12px" }}>{qaqcAlerts.length}</span>
                    </h3>
                    <div style={{ display: "grid", gap: "10px" }}>
                      {qaqcAlerts.map((c) => (
                        <div key={c.id} style={{ background: "var(--c-surface)", borderRadius: "8px", borderLeft: "3px solid var(--c-warn)", overflow: "hidden" }}>
                          {/* Checklist item context */}
                          <div style={{ background: "var(--c-surface-alt)", padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontSize: "12px", color: "var(--c-text-2)", flex: 1 }}>📋 {c.itemText}</span>
                            {c.itemCategory && (
                              <button onClick={() => goToItem(c.checklist_item_id, c.itemCategory)}
                                style={{ flexShrink: 0, fontSize: "11px", fontWeight: "600", color: "var(--c-accent-lt)", background: "var(--c-accent-dk)", border: "1px solid #0095da", borderRadius: "6px", padding: "3px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                                Go to item →
                              </button>
                            )}
                          </div>
                          {/* Comment */}
                          <div style={{ padding: "10px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", flexWrap: "wrap", gap: "6px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-warn)", background: "var(--c-warn-bg)", border: "1px solid var(--c-warn)", borderRadius: "20px", padding: "1px 8px" }}>QA/QC</span>
                                <span style={{ fontSize: "12px", color: "var(--c-text)", fontWeight: "600" }}>{c.authorName}</span>
                              </div>
                              <span style={{ fontSize: "11px", color: "var(--c-text-3)" }}>{formatDate(c.created_at)}</span>
                            </div>
                            <p style={{ margin: "0 0 10px", fontSize: "13px", color: "var(--c-text)", lineHeight: "1.5" }}>{c.comment}</p>
                            {/* Inline reply */}
                            <div style={{ display: "flex", gap: "6px" }}>
                              <input
                                value={dashReplyText[c.checklist_item_id] || ""}
                                onChange={(e) => setDashReplyText((prev) => ({ ...prev, [c.checklist_item_id]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitDashReply(c.checklist_item_id)}
                                placeholder="Reply…"
                                style={{ flex: 1, padding: "6px 10px", background: "var(--c-bg)", border: "1px solid var(--c-border)", borderRadius: "6px", color: "var(--c-text)", fontSize: "12px" }}
                              />
                              <button
                                onClick={() => submitDashReply(c.checklist_item_id)}
                                disabled={dashReplying === c.checklist_item_id || !(dashReplyText[c.checklist_item_id] || "").trim()}
                                style={{ padding: "6px 12px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>
                                {dashReplying === c.checklist_item_id ? "…" : "Reply"}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "10px", marginBottom: "28px" }}>
                  {statCard("Total", totalItems, "var(--c-text)")}
                  {statCard("Complete", completedItems, "var(--c-ok-text)")}
                  {statCard("In Progress", inProgressItems.length, "var(--c-purple)")}
                  {statCard("Pending", pendingItems, "var(--c-text-2)")}
                  {statCard("N/A", naItems, "var(--c-text-4)")}
                  {statCard("Progress", `${overallProgress}%`, overallProgress === 100 ? "var(--c-ok-text)" : "var(--c-accent)")}
                </div>
                {/* Charts row */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "auto 1fr", gap: "16px", marginBottom: "28px", alignItems: "start" }}>
                  {/* Status donut chart */}
                  <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "12px", padding: "16px 20px" }}>
                    <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 14px" }}>Status Breakdown</p>
                    <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
                      <svg viewBox="0 0 160 160" width="130" height="130" style={{ flexShrink: 0 }}>
                        <circle cx="80" cy="80" r="54" fill="none" stroke="var(--c-border)" strokeWidth="22" />
                        {totalItems > 0 && (() => {
                          let offset = 0;
                          return donutSegments.filter((s) => s.pct > 0).map((s) => {
                            const dash = s.pct * CIRC;
                            const el = (
                              <circle key={s.label} cx="80" cy="80" r="54" fill="none"
                                stroke={s.color} strokeWidth="22"
                                strokeDasharray={`${dash} ${CIRC}`}
                                strokeDashoffset={-(offset * CIRC)}
                                transform="rotate(-90 80 80)"
                                style={{ transition: "stroke-dasharray 0.4s" }}
                              />
                            );
                            offset += s.pct;
                            return el;
                          });
                        })()}
                        <text x="80" y="76" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--c-text)">{overallProgress}%</text>
                        <text x="80" y="94" textAnchor="middle" fontSize="10" fill="var(--c-text-4)">complete</text>
                      </svg>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {[
                          { label: "Complete",    count: completedItems,    color: "#22c55e" },
                          { label: "In Progress", count: inProgressCount,   color: "#a855f7" },
                          { label: "Pending",     count: pendingItems,      color: "var(--c-text-4)" },
                          { label: "N/A",         count: naItems,           color: "#475569" },
                        ].map(({ label, count, color }) => (
                          <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: color, flexShrink: 0 }} />
                            <span style={{ fontSize: "12px", color: "var(--c-text-3)", minWidth: "70px" }}>{label}</span>
                            <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--c-text)" }}>{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Per-category progress bars */}
                  <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "12px", padding: "16px 20px" }}>
                    <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 14px" }}>Progress by Checklist</p>
                    <div style={{ display: "grid", gap: "10px" }}>
                      {enabledCategories.map((cat) => {
                        const { done, applicable, pct } = getCategoryStats(cat.id);
                        if (applicable === 0) return null;
                        return (
                          <div key={cat.id}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                              <span style={{ fontSize: "12px", color: "var(--c-text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: "8px" }}>{getCatLabel(cat.id)}</span>
                              <span style={{ fontSize: "11px", color: pct === 100 ? "#22c55e" : "var(--c-text-4)", fontWeight: "600", flexShrink: 0 }}>{done}/{applicable} · {pct}%</span>
                            </div>
                            <div style={{ height: "5px", background: "var(--c-border)", borderRadius: "3px", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#22c55e" : "var(--c-accent)", borderRadius: "3px", transition: "width 0.4s" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Milestone timeline */}
                {milestones.length > 0 && (
                  <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "12px", padding: "16px 20px", marginBottom: "28px" }}>
                    <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 16px" }}>Milestone Timeline</p>
                    {upcomingMs.map((m, idx) => {
                      const dLeft = Math.ceil((m.dateObj - today) / 86400000);
                      const isPast = dLeft < 0;
                      const isNext = !isPast && nextMs?.id === m.id;
                      const { done, applicable, pct } = getMsProgress(m.id);
                      const dotColor = isPast ? "#22c55e" : isNext ? "var(--c-accent)" : "var(--c-border)";
                      return (
                        <div key={m.id} style={{ display: "flex", gap: "14px" }}>
                          {/* Timeline spine */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "14px", flexShrink: 0 }}>
                            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: dotColor, border: `2px solid ${isNext ? "var(--c-accent)" : dotColor}`, boxShadow: isNext ? "0 0 0 3px var(--c-accent-dk)" : "none", marginTop: "3px", flexShrink: 0 }} />
                            {idx < upcomingMs.length - 1 && <div style={{ width: "2px", flex: 1, background: "var(--c-border)", margin: "4px 0" }} />}
                          </div>
                          {/* Milestone card */}
                          <div style={{ flex: 1, paddingBottom: idx < upcomingMs.length - 1 ? "16px" : "0" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "2px", gap: "8px" }}>
                              <span style={{ fontSize: "13px", fontWeight: isNext ? "700" : "600", color: isNext ? "var(--c-accent-lt)" : isPast ? "var(--c-text-4)" : "var(--c-text)" }}>{m.name}</span>
                              <span style={{ fontSize: "11px", fontWeight: "600", color: isPast ? "#22c55e" : dLeft <= 7 ? "var(--c-warn)" : "var(--c-text-4)", flexShrink: 0 }}>
                                {isPast ? `✓ ${Math.abs(dLeft)}d ago` : dLeft === 0 ? "Today" : `${dLeft}d`}
                              </span>
                            </div>
                            <span style={{ fontSize: "10px", color: "var(--c-text-4)" }}>{formatDate(m.date + "T12:00:00")}</span>
                            {applicable > 0 && (
                              <div style={{ marginTop: "6px" }}>
                                <div style={{ height: "4px", background: "var(--c-border)", borderRadius: "2px", overflow: "hidden", marginBottom: "3px" }}>
                                  <div style={{ height: "100%", width: `${pct}%`, background: pct === 100 ? "#22c55e" : "var(--c-accent)", borderRadius: "2px", transition: "width 0.4s" }} />
                                </div>
                                <span style={{ fontSize: "10px", color: "var(--c-text-4)" }}>{done}/{applicable} items · {pct}%</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Past due */}
                <DueList items={pastDueItems} title={`⚠ Past Due (${pastDueItems.length})`} color="var(--c-err)" />
                {/* Due soon */}
                <DueList items={dueSoonItems} title={`⏰ Due Soon — next 7 days (${dueSoonItems.length})`} color="var(--c-warn)" />
                {/* In progress */}
                {inProgressItems.length > 0 && (
                  <div style={{ marginBottom: "24px" }}>
                    <h3 style={{ color: "var(--c-purple)", margin: "0 0 10px", fontSize: "14px", fontWeight: "700" }}>▶ In Progress ({inProgressItems.length})</h3>
                    <div style={{ display: "grid", gap: "6px" }}>
                      {inProgressItems.map((c) => (
                        <div key={c.id} style={{ background: "var(--c-surface)", border: "1px solid var(--c-purple)", borderRadius: "8px", padding: "10px 14px" }}>
                          <span style={{ fontSize: "10px", color: "var(--c-text-4)", fontFamily: "monospace" }}>{refCodes[c.id]} </span>
                          <span style={{ fontSize: "13px", color: "var(--c-text)" }}>{c.item_text}</span>
                          {c.in_progress_by && (
                            <div style={{ fontSize: "11px", color: "var(--c-purple)", marginTop: "4px" }}>
                              ▶ {profilesMap[c.in_progress_by]?.full_name || "Unknown"} · {formatDate(c.in_progress_at)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {qaqcAlerts.length === 0 && pastDueItems.length === 0 && dueSoonItems.length === 0 && inProgressItems.length === 0 && (
                  <p style={{ color: "var(--c-text-3)", textAlign: "center", paddingTop: "20px" }}>No alerts — all clear! 🎉</p>
                )}
              </>
            );
          })() : viewMode === "category" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
                <h2 style={{ color: "var(--c-text)", margin: 0, fontSize: isMobile ? "16px" : "20px" }}>
                  {getCatLabel(activeCategory)}
                </h2>
                {activeCategory && !canEdit(activeCategory) && (
                  <span style={{ fontSize: "11px", color: "var(--c-warn)", background: "var(--c-warn-bg)", padding: "4px 10px", borderRadius: "20px", border: "1px solid #f59e0b" }}>
                    View only
                  </span>
                )}
              </div>
              {Object.entries(groupedCategoryItems).map(([sub, items]) => renderSection(sub, items))}
            </>
          ) : (
            milestones.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <p style={{ color: "var(--c-text-2)", fontSize: "16px" }}>No milestones set up.</p>
                <p style={{ color: "var(--c-text-3)", fontSize: "14px" }}>Go to Project Setup → Milestones.</p>
              </div>
            ) : milestoneLoading || activeMilestoneItemIds === null ? (
              <p style={{ color: "var(--c-text-2)" }}>Loading milestone items...</p>
            ) : activeMilestoneItemIds.size === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0" }}>
                <p style={{ color: "var(--c-text-2)", fontSize: "16px" }}>No items assigned to this milestone.</p>
                <p style={{ color: "var(--c-text-3)", fontSize: "14px" }}>Go to Project Setup → Milestones → Assign Items.</p>
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
                        <h2 style={{ color: "var(--c-text)", margin: "0 0 4px", fontSize: isMobile ? "16px" : "20px" }}>{m?.name}</h2>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ color: "var(--c-text-2)", fontSize: "13px" }}>{m && new Date(m.date + "T00:00:00").toLocaleDateString()}</span>
                          {isAlert && <span style={{ fontSize: "12px", color: "var(--c-warn)", background: "var(--c-warn-bg)", padding: "2px 10px", borderRadius: "20px" }}>⚠ {daysUntil}d remaining</span>}
                        </div>
                      </div>
                      <span style={{ color: pct === 100 ? "var(--c-ok-text)" : "var(--c-text)", fontSize: "28px", fontWeight: "700" }}>{pct}%</span>
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
