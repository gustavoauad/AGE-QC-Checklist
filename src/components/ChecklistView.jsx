import { useState, useEffect, useRef } from "react";
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
  const [viewMode, setViewMode] = useState("dashboard");
  const [milestones, setMilestones] = useState([]);
  const [activeMilestoneId, setActiveMilestoneId] = useState(null);
  const [milestoneItemsCache, setMilestoneItemsCache] = useState({});
  const [milestoneLoading, setMilestoneLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all"); // all | pending | complete | na | in_progress
  const [filterMilestoneId, setFilterMilestoneId] = useState("all");
  const [filterApplicable, setFilterApplicable] = useState(false);
  const [helpPopover, setHelpPopover] = useState(null); // item.id
  const [itemMsIdMap, setItemMsIdMap] = useState({}); // itemId → [milestoneId, ...]
  const [qaqcThreads, setQaqcThreads] = useState([]);         // open: items with unresolved QA/QC flags
  const [resolvedQaqcThreads, setResolvedQaqcThreads] = useState([]); // items where all QA/QC flags resolved
  const [qaqcAlertsLoaded, setQaqcAlertsLoaded] = useState(false);
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const [dashReplyText, setDashReplyText] = useState({}); // { [itemId]: string }
  const [dashReplying, setDashReplying] = useState(null); // itemId
  const [savedItemIds, setSavedItemIds] = useState(new Set()); // this user's To-Do saves — private, never shared
  const [savingItem, setSavingItem] = useState(null); // itemId currently being saved/removed

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

  // checklist_comments has no project_id column, so the realtime filter can't scope by
  // project server-side — every row is checked client-side against this project's items.
  // Refs keep these callbacks (set up once per project) reading current data instead of
  // whatever was in scope the moment the subscription was created.
  const checklistsRef = useRef(checklists);
  useEffect(() => { checklistsRef.current = checklists; });
  const loadQaqcAlertsRef = useRef(null);
  useEffect(() => { loadQaqcAlertsRef.current = loadQaqcAlerts; });
  // Comment ids this client just inserted itself — the realtime echo for our own insert
  // would otherwise double-append it on top of the optimistic local update.
  const recentlyInsertedCommentIds = useRef(new Set());

  // Real-time: reflect comments (and QA/QC flag/resolve changes) from other users instantly,
  // matching how checklist status updates already appear live instead of only after a reload.
  useEffect(() => {
    const ch = supabase
      .channel(`comments-${project.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "checklist_comments" }, (payload) => {
        const c = payload.new;
        if (!checklistsRef.current.some((item) => item.id === c.checklist_item_id)) return;
        if (recentlyInsertedCommentIds.current.has(c.id)) {
          recentlyInsertedCommentIds.current.delete(c.id);
          return;
        }
        setCommentsCache((prev) => {
          const existing = prev[c.checklist_item_id];
          if (!existing) return prev; // thread not open/loaded yet — fetchComments will pick it up
          if (existing.some((x) => x.id === c.id)) return prev;
          return { ...prev, [c.checklist_item_id]: [...existing, c] };
        });
        setCommentMeta((prev) => {
          const cur = prev[c.checklist_item_id] || { count: 0, hasQaqc: false };
          return { ...prev, [c.checklist_item_id]: { count: cur.count + 1, hasQaqc: cur.hasQaqc || !!c.is_qaqc_flagged } };
        });
        if (c.is_qaqc_flagged) loadQaqcAlertsRef.current?.(true);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "checklist_comments" }, (payload) => {
        const c = payload.new;
        if (!checklistsRef.current.some((item) => item.id === c.checklist_item_id)) return;
        setCommentsCache((prev) => {
          const existing = prev[c.checklist_item_id];
          if (!existing) return prev;
          return { ...prev, [c.checklist_item_id]: existing.map((x) => x.id === c.id ? { ...x, ...c } : x) };
        });
        if (c.is_qaqc_flagged || payload.old?.is_qaqc_flagged) loadQaqcAlertsRef.current?.(true);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [project.id]);

  const [itemMsMap, setItemMsMap] = useState({}); // itemId → [milestoneName, ...]
  const [itemMsDaysMap, setItemMsDaysMap] = useState({}); // itemId → { [milestoneId]: days_before }
  const [itemMsCompletedMap, setItemMsCompletedMap] = useState({}); // itemId → { [milestoneId]: { completedAt, completedBy } | null }
  const [commentMeta, setCommentMeta] = useState({}); // itemId → { count, hasQaqc }
  const [itemDeps, setItemDeps] = useState({}); // itemId → Set<parentId>
  const [milestoneCompletePopup, setMilestoneCompletePopup] = useState(null); // { item, selected: Set<milestoneId> }

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
    (configRes.data || []).forEach((r) => { cfgMap[r.category] = { enabled: r.enabled, label: r.label, abbreviation: r.abbreviation }; });
    setCategoryConfig(cfgMap);
    const ms = milestoneRes.data || [];
    setMilestones(ms);
    let imIdMap = {};
    let imCompletedMap = {}; // itemId → { [milestoneId]: { completedAt, completedBy } | null }
    if (ms.length > 0) {
      setActiveMilestoneId(ms[0].id);
      // Build itemId → [milestoneName] map for display
      const msIds = ms.map((m) => m.id);
      const { data: miData } = await supabase.from("milestone_items")
        .select("milestone_id, checklist_item_id, days_before, completed_at, completed_by").in("milestone_id", msIds);
      const imMap = {};
      const imDaysMap = {}; // itemId → { [milestoneId]: days_before }
      (miData || []).forEach(({ milestone_id, checklist_item_id, days_before, completed_at, completed_by }) => {
        if (!imMap[checklist_item_id]) imMap[checklist_item_id] = [];
        const msName = ms.find((m) => m.id === milestone_id)?.name;
        if (msName) imMap[checklist_item_id].push(msName);
        if (!imIdMap[checklist_item_id]) imIdMap[checklist_item_id] = [];
        imIdMap[checklist_item_id].push(milestone_id);
        if (days_before != null) {
          if (!imDaysMap[checklist_item_id]) imDaysMap[checklist_item_id] = {};
          imDaysMap[checklist_item_id][milestone_id] = days_before;
        }
        if (!imCompletedMap[checklist_item_id]) imCompletedMap[checklist_item_id] = {};
        imCompletedMap[checklist_item_id][milestone_id] = completed_at ? { completedAt: completed_at, completedBy: completed_by } : null;
      });
      setItemMsMap(imMap);
      setItemMsIdMap(imIdMap);
      setItemMsDaysMap(imDaysMap);
      setItemMsCompletedMap(imCompletedMap);
    } else {
      setItemMsMap({});
      setItemMsIdMap({});
      setItemMsDaysMap({});
      setItemMsCompletedMap({});
    }

    // Reconcile milestone-driven status: once a check has entered the milestone flow
    // (complete/in_progress), its status must track whichever milestones are CURRENTLY
    // assigned to it — milestones can be added, removed, or become newly due (a later
    // milestone unlocks once the previous one's date has passed) after a user last set
    // the status, so the stored value can go stale without this pass.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const reconciled = [];
    items.forEach((item) => {
      if (item.status !== "complete" && item.status !== "in_progress") return;
      const assignedIds = imIdMap[item.id] || [];
      const completedMap = imCompletedMap[item.id] || {};
      const assignedMs = assignedIds.map((id) => ms.find((m) => m.id === id)).filter(Boolean);
      const dated = assignedMs.filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
      const undated = assignedMs.filter((m) => !m.date);
      const available = [];
      for (let i = 0; i < dated.length; i++) {
        const prev = i > 0 ? dated[i - 1] : null;
        if (prev && today < new Date(prev.date + "T00:00:00")) break;
        available.push(dated[i]);
      }
      available.push(...undated);
      const effective = available.length > 0 && available.every((m) => completedMap[m.id]) ? "complete" : "in_progress";
      if (effective !== item.status) reconciled.push({ item, effective });
    });
    if (reconciled.length > 0) {
      const now = new Date().toISOString();
      await Promise.all(reconciled.map(({ item, effective }) => {
        const updates = effective === "complete"
          ? { status: "complete", completed_by: null, completed_at: now, in_progress_by: null, in_progress_at: null }
          : { status: "in_progress", completed_by: null, completed_at: null, in_progress_by: null, in_progress_at: null };
        Object.assign(item, updates);
        return supabase.from("checklists").update(updates).eq("id", item.id);
      }));
      setChecklists([...items]);
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

    // Load this user's own To-Do saves (private — never queries other users' rows).
    // A save that has since been self-completed is stale (rule: completing a saved
    // check removes it from the To-Do list), so drop those here too, in case they were
    // completed from a different device/session and this client never got to react live.
    const { data: savedRows } = await supabase
      .from("checklist_saved_items")
      .select("checklist_item_id")
      .eq("project_id", project.id)
      .eq("user_id", session.user.id);
    const savedIds = new Set((savedRows || []).map((r) => r.checklist_item_id));
    const staleSelfCompleted = [...savedIds].filter((id) => {
      const item = items.find((c) => c.id === id);
      return item && item.status === "complete" && item.completed_by === session.user.id;
    });
    if (staleSelfCompleted.length > 0) {
      await supabase.from("checklist_saved_items").delete().eq("user_id", session.user.id).in("checklist_item_id", staleSelfCompleted);
      staleSelfCompleted.forEach((id) => savedIds.delete(id));
    }
    setSavedItemIds(savedIds);

    setLoading(false);
  };

  // Bookmarks/un-bookmarks an item on this user's private To-Do list — purely personal,
  // never touches or is visible to any other user's list.
  const toggleSaveItem = async (item) => {
    if (savingItem) return;
    setSavingItem(item.id);
    const isSaved = savedItemIds.has(item.id);
    if (isSaved) {
      await supabase.from("checklist_saved_items").delete().eq("user_id", session.user.id).eq("checklist_item_id", item.id);
      setSavedItemIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    } else {
      const { error } = await supabase.from("checklist_saved_items")
        .insert({ user_id: session.user.id, checklist_item_id: item.id, project_id: project.id });
      if (!error) setSavedItemIds((prev) => new Set(prev).add(item.id));
    }
    setSavingItem(null);
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

  // Custom abbreviation (set by the PM in Project Setup) overrides the auto-derived
  // 4-char prefix; kept in sync with the same logic in ProjectSetupModal.jsx.
  const getCatAbbr = (catId) => {
    const custom = categoryConfig[catId]?.abbreviation?.trim();
    if (custom) return custom.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 3);
    return getCatLabel(catId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
  };

  // Build reference codes: itemId → "PREFIX-S.I"
  const refCodes = (() => {
    const codes = {};
    enabledCategories.forEach((cat) => {
      const prefix = getCatAbbr(cat.id);
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
    if (enabledCategories.length === 0) return;
    const stillEnabled = activeCategory && enabledCategories.some((cat) => cat.id === activeCategory);
    if (!stillEnabled) setActiveCategory(enabledCategories[0].id);
  }, [categoryConfig, loading]);

  // Gates ✓/▶/N/A status buttons — QAQC cannot change status
  const canChangeStatus = (category) => {
    if (userRole === "project_manager") return true;
    if (userRole === "engineer") return category !== "drafting";
    if (userRole === "drafter") return category === "drafting";
    return false;
  };

  // Gates sidebar dimming and "View only" banner — QAQC can comment + manage items
  const canInteract = (category) => {
    if (userRole === "project_manager" || userRole === "qaqc") return true;
    if (userRole === "engineer") return category !== "drafting";
    if (userRole === "drafter") return category === "drafting";
    return false;
  };

  // Returns array of { milestoneId, milestoneName, msDate, dueDate, daysLeft, noDeadline, usesMsDateDefault, completed }
  // for every milestone assigned to this item, sorted soonest-due first (no-deadline entries last).
  // When no days_before is configured for the pair, the milestone's own date is used as the
  // deadline (usesMsDateDefault: true) — noDeadline only remains true if the milestone itself
  // has no date set (a data-integrity edge case, not the normal "not configured yet" case).
  // `completed` is { completedAt, completedBy } | null — per-milestone completion, independent of
  // the item's overall status (an item can be done for SD but still outstanding for DD).
  const getItemDueInfo = (itemId) => {
    const daysMap = itemMsDaysMap[itemId] || {};
    const msIds = itemMsIdMap[itemId] || [];
    const completedMap = itemMsCompletedMap[itemId] || {};
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return msIds
      .map((msId) => {
        const m = milestones.find((x) => x.id === msId);
        if (!m) return null;
        const completed = completedMap[msId] || null;
        if (!m.date) {
          return { milestoneId: msId, milestoneName: m.name, msDate: null, dueDate: null, daysLeft: null, noDeadline: true, usesMsDateDefault: false, completed };
        }
        const days = daysMap[msId];
        const usesMsDateDefault = days == null;
        const msDate = new Date(m.date + "T00:00:00");
        const dueDate = new Date(msDate.getTime() - (days ?? 0) * 86400000);
        const daysLeft = Math.ceil((dueDate - today) / 86400000);
        return { milestoneId: msId, milestoneName: m.name, msDate, dueDate, daysLeft, noDeadline: false, usesMsDateDefault, completed };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.noDeadline && b.noDeadline) return 0;
        if (a.noDeadline) return 1;
        if (b.noDeadline) return -1;
        return a.dueDate - b.dueDate;
      });
  };

  // Milestones assigned to an item, sorted chronologically by the milestone's own date —
  // used to enforce "complete the earlier deadline first" in the completion popup.
  const getSortedAssignedMilestones = (itemId) => {
    const ids = itemMsIdMap[itemId] || [];
    return ids
      .map((id) => milestones.find((m) => m.id === id))
      .filter((m) => m?.date)
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  // Earliest due date among milestones this item is still outstanding for
  // (has a deadline, not yet completed for that specific milestone).
  const getItemDueDate = (item) => {
    const outstanding = getItemDueInfo(item.id).filter((d) => !d.noDeadline && !d.completed);
    if (!outstanding.length) return null;
    return outstanding.sort((a, b) => a.dueDate - b.dueDate)[0].dueDate;
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

  // Returns all items itemId (transitively) depends on (parents + grandparents…) — the
  // mirror of getDescendants, used to check whether any ancestor is currently N/A.
  const getAncestors = (itemId) => {
    const result = [];
    const stack = [...(itemDeps[itemId] || new Set())];
    const visited = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      result.push(id);
      (itemDeps[id] || new Set()).forEach((p) => stack.push(p));
    }
    return result;
  };

  // An item stays locked as N/A for as long as any of its dependencies (direct or
  // transitive) is itself N/A — it shouldn't be editable independently of the parent,
  // and it should automatically revert once no ancestor is N/A anymore.
  const isNaLockedByParent = (itemId) => {
    const ancestorIds = getAncestors(itemId);
    if (!ancestorIds.length) return false;
    return checklists.some((c) => ancestorIds.includes(c.id) && c.status === "na");
  };

  // Stamps or clears completed_at/completed_by on milestone_items rows for one item.
  // selectedIds === null means "all assigned milestones" (used by the simple 0/1-milestone path).
  const syncMilestoneCompletion = async (itemId, msDone, selectedIds = null) => {
    const assignedMsIds = itemMsIdMap[itemId] || [];
    if (!assignedMsIds.length) return;
    const now = new Date().toISOString();
    await Promise.all(assignedMsIds.map((msId) => {
      const isDone = msDone && (selectedIds === null || selectedIds.has(msId));
      return supabase.from("milestone_items")
        .update({ completed_at: isDone ? now : null, completed_by: isDone ? session.user.id : null })
        .eq("checklist_item_id", itemId).eq("milestone_id", msId);
    }));
    setItemMsCompletedMap((prev) => {
      const next = { ...prev, [itemId]: { ...(prev[itemId] || {}) } };
      assignedMsIds.forEach((msId) => {
        const isDone = msDone && (selectedIds === null || selectedIds.has(msId));
        next[itemId][msId] = isDone ? { completedAt: now, completedBy: session.user.id } : null;
      });
      return next;
    });
  };

  // Rule: completing a check removes it from the completing user's own To-Do list.
  const removeSavedItemOnSelfComplete = async (itemId) => {
    if (!savedItemIds.has(itemId)) return;
    await supabase.from("checklist_saved_items").delete().eq("user_id", session.user.id).eq("checklist_item_id", itemId);
    setSavedItemIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
  };

  const handleStatusChange = async (item, newStatus) => {
    if (!canChangeStatus(item.category)) return;

    // Locked as N/A by a dependency — must not be editable independently; it can only
    // change once the ancestor itself is no longer N/A (which reverts it automatically).
    if (isNaLockedByParent(item.id)) {
      const ancestorIds = getAncestors(item.id);
      const blocker = checklists.find((c) => ancestorIds.includes(c.id) && c.status === "na");
      alert(
        `This item is locked as N/A because it depends on "${blocker ? (refCodes[blocker.id] ? refCodes[blocker.id] + " " : "") + blocker.item_text : "another item"}", which is marked N/A.\n\nIt will revert automatically once that dependency is no longer N/A.`
      );
      return;
    }

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
        await Promise.all(toNa.map((c) => syncMilestoneCompletion(c.id, false)));
      }
    }

    // Reverse cascade: un-marking N/A on an item that had cascaded its dependents should
    // release them too — but only the ones with no OTHER currently-N/A ancestor, since a
    // descendant with two N/A dependencies must stay locked until both clear.
    if (item.status === "na" && newStatus !== "na") {
      const descendantIds = getDescendants(item.id);
      const toRevert = checklists.filter((c) => {
        if (!descendantIds.includes(c.id) || c.status !== "na") return false;
        const otherAncestorIds = getAncestors(c.id).filter((id) => id !== item.id);
        const stillLocked = checklists.some((a) => otherAncestorIds.includes(a.id) && a.status === "na");
        return !stillLocked;
      });
      if (toRevert.length > 0) {
        const revertUpdates = { status: "pending", completed_by: null, completed_at: null, in_progress_by: null, in_progress_at: null };
        await Promise.all(toRevert.map((c) => supabase.from("checklists").update(revertUpdates).eq("id", c.id)));
        setChecklists((prev) => prev.map((c) => toRevert.find((x) => x.id === c.id) ? { ...c, ...revertUpdates } : c));
        await Promise.all(toRevert.map((c) => syncMilestoneCompletion(c.id, false)));
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
    if (error) { console.error("Status update failed:", error.message); setUpdating(null); return; }
    setChecklists((prev) => prev.map((c) => c.id === item.id ? { ...c, ...updates } : c));
    // Direct button clicks are all-or-nothing: mirror the resulting status onto every
    // assigned milestone. Partial (some-milestones-done) state can only be produced
    // via the multi-milestone completion popup.
    await syncMilestoneCompletion(item.id, newStatus === "complete");
    if (newStatus === "complete") await removeSavedItemOnSelfComplete(item.id);
    setUpdating(null);
  };

  // Opens the popup for items assigned to 2+ milestones, letting the user pick which
  // specific deadline(s) this completion applies to instead of an all-or-nothing toggle.
  const openMilestoneCompletePopup = (item) => {
    if (isNaLockedByParent(item.id)) return;
    const completedMap = itemMsCompletedMap[item.id] || {};
    const sortedMs = getSortedAssignedMilestones(item.id);
    const selected = new Set(sortedMs.filter((m) => completedMap[m.id]).map((m) => m.id));
    if (item.status !== "complete" && item.status !== "in_progress" && selected.size === 0) {
      // Convenience default: pre-check every milestone that's currently eligible
      // (its turn has come — the previous deadline's date has already passed),
      // stopping at the first one that isn't yet reached.
      const today = new Date(); today.setHours(0, 0, 0, 0);
      for (const m of sortedMs) {
        const idx = sortedMs.indexOf(m);
        const prev = idx > 0 ? sortedMs[idx - 1] : null;
        const dateOk = !prev || today >= new Date(prev.date + "T00:00:00");
        if (!dateOk) break;
        selected.add(m.id);
      }
    }
    setMilestoneCompletePopup({ item, selected });
  };

  // Applies the popup's milestone selection: overall status is derived from how many of
  // the assigned milestones are selected — all → complete, some → in_progress, none → pending.
  const applyMilestoneCompletion = async (item, selectedIds) => {
    const assignedMsIds = itemMsIdMap[item.id] || [];
    const allSelected = assignedMsIds.length > 0 && selectedIds.size === assignedMsIds.length;

    // Defense in depth: reject a selection that skips ahead of an earlier, not-yet-due
    // deadline, even though the popup's checkboxes already prevent this in normal use.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const sortedMs = getSortedAssignedMilestones(item.id);
    for (let i = 0; i < sortedMs.length; i++) {
      if (!selectedIds.has(sortedMs[i].id)) continue;
      const prev = i > 0 ? sortedMs[i - 1] : null;
      const dateOk = !prev || today >= new Date(prev.date + "T00:00:00");
      const orderOk = i === 0 || selectedIds.has(sortedMs[i - 1].id);
      if (!dateOk || !orderOk) {
        alert(`Cannot mark "${sortedMs[i].name}" complete before "${prev.name}" (${prev.date}) is completed and its date has passed.`);
        return;
      }
    }

    if (allSelected) {
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

    const newStatus = allSelected ? "complete" : selectedIds.size > 0 ? "in_progress" : "pending";
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
    if (error) { console.error("Milestone completion update failed:", error.message); setUpdating(null); return; }
    setChecklists((prev) => prev.map((c) => c.id === item.id ? { ...c, ...updates } : c));
    await syncMilestoneCompletion(item.id, true, selectedIds);
    if (newStatus === "complete") await removeSavedItemOnSelfComplete(item.id);
    setUpdating(null);
    setMilestoneCompletePopup(null);
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
      recentlyInsertedCommentIds.current.add(data.id);
      setCommentsCache((prev) => ({ ...prev, [itemId]: [...(prev[itemId] || []), data] }));
      setCommentMeta((prev) => {
        const cur = prev[itemId] || { count: 0, hasQaqc: false };
        return { ...prev, [itemId]: { count: cur.count + 1, hasQaqc: cur.hasQaqc || !!data.is_qaqc_flagged } };
      });
      // Refresh the dashboard's QA/QC alerts right away instead of waiting for the
      // next time the Dashboard tab happens to be opened.
      if (data.is_qaqc_flagged) { setQaqcAlertsLoaded(false); loadQaqcAlerts(true); }
      else setQaqcAlertsLoaded(false);
      setCommentText("");
    }
    setAddingComment(false);
  };

  const loadQaqcAlerts = async (force = false) => {
    if (!force && qaqcAlertsLoaded) return;
    const itemIds = checklists.map((c) => c.id);
    if (!itemIds.length) { setQaqcAlertsLoaded(true); return; }

    // Find all items that have at least one qaqc-flagged comment
    const { data: flagged } = await supabase
      .from("checklist_comments")
      .select("checklist_item_id")
      .eq("is_qaqc_flagged", true)
      .in("checklist_item_id", itemIds);
    const alertItemIds = [...new Set((flagged || []).map((c) => c.checklist_item_id))];
    if (!alertItemIds.length) {
      setQaqcThreads([]); setResolvedQaqcThreads([]); setQaqcAlertsLoaded(true); return;
    }

    // Fetch full comment threads for those items
    const { data: allComments } = await supabase
      .from("checklist_comments")
      .select("*")
      .in("checklist_item_id", alertItemIds)
      .order("created_at");

    const itemsById = Object.fromEntries(checklists.map((c) => [c.id, c]));
    const threadsMap = {};
    alertItemIds.forEach((id) => {
      const item = itemsById[id];
      threadsMap[id] = { itemId: id, itemText: item?.item_text || "", itemCategory: item?.category || null, comments: [] };
    });
    (allComments || []).forEach((c) => {
      if (threadsMap[c.checklist_item_id]) {
        threadsMap[c.checklist_item_id].comments.push({ ...c, authorName: profilesMap[c.user_id]?.full_name || "Unknown" });
      }
    });

    const open = [], resolved = [];
    Object.values(threadsMap).forEach((t) => {
      const hasOpen = t.comments.some((c) => c.is_qaqc_flagged && !c.is_resolved);
      if (hasOpen) open.push(t); else resolved.push(t);
    });
    open.sort((a, b) => {
      const latest = (t) => Math.max(...t.comments.filter((c) => c.is_qaqc_flagged && !c.is_resolved).map((c) => new Date(c.created_at).getTime()));
      return latest(b) - latest(a);
    });
    setQaqcThreads(open);
    setResolvedQaqcThreads(resolved);
    setQaqcAlertsLoaded(true);
  };

  const resolveAlert = async (commentId) => {
    const { error } = await supabase
      .from("checklist_comments")
      .update({ is_resolved: true, resolved_at: new Date().toISOString(), resolved_by: session.user.id })
      .eq("id", commentId);
    if (!error) { setQaqcAlertsLoaded(false); await loadQaqcAlerts(true); }
  };

  const unresolveAlert = async (commentId) => {
    const { error } = await supabase
      .from("checklist_comments")
      .update({ is_resolved: false, resolved_at: null, resolved_by: null })
      .eq("id", commentId);
    if (!error) { setQaqcAlertsLoaded(false); await loadQaqcAlerts(true); }
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
      recentlyInsertedCommentIds.current.add(data.id);
      setCommentsCache((prev) => ({ ...prev, [itemId]: [...(prev[itemId] || []), data] }));
      setCommentMeta((prev) => {
        const cur = prev[itemId] || { count: 0, hasQaqc: false };
        return { ...prev, [itemId]: { count: cur.count + 1, hasQaqc: cur.hasQaqc || !!data.is_qaqc_flagged } };
      });
      setDashReplyText((prev) => ({ ...prev, [itemId]: "" }));
      // Reload in place (force=true) without clearing the current lists first — clearing
      // them made the "No alerts — all clear!" empty state flash on screen until the
      // refetch finished, even though nothing had actually been resolved.
      await loadQaqcAlerts(true);
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
    const items = enabledChecklists.filter((c) => ids.has(c.id));
    const done = items.filter((c) => c.status === "complete").length;
    const na = items.filter((c) => c.status === "na").length;
    const applicable = items.length - na;
    return { done, applicable, pct: applicable ? Math.round((done / applicable) * 100) : 0 };
  };

  const getMilestoneProgress = (milestoneId) => getMilestoneStats(milestoneId).pct;

  // Items whose checklist (category) has been turned off for this project must be
  // completely excluded from counts, stats, and the "By Milestone" tab — not just
  // hidden from the category sidebar.
  const isCategoryEnabled = (catId) => categoryConfig[catId]?.enabled !== false;
  const enabledChecklists = checklists.filter((c) => isCategoryEnabled(c.category));

  const totalItems = enabledChecklists.length;
  const completedItems = enabledChecklists.filter((c) => c.status === "complete").length;
  const naItems = enabledChecklists.filter((c) => c.status === "na").length;
  const pendingItems = enabledChecklists.filter((c) => c.status === "pending").length;
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
  const milestoneItemsRaw = activeMilestoneItemIds ? applyFilters(enabledChecklists.filter((c) => activeMilestoneItemIds.has(c.id))) : [];
  // Order to match the "By Category" tab: category order follows enabledCategories
  // (the curated list), not the raw DB fetch order (alphabetical by category key).
  const categoryOrderIndex = {};
  enabledCategories.forEach((cat, idx) => { categoryOrderIndex[cat.id] = idx; });
  const milestoneItems = [...milestoneItemsRaw].sort((a, b) => {
    const ca = categoryOrderIndex[a.category] ?? 9999;
    const cb = categoryOrderIndex[b.category] ?? 9999;
    if (ca !== cb) return ca - cb;
    return (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.item_id.localeCompare(b.item_id);
  });
  const groupedMilestoneItems = milestoneItems.reduce((acc, item) => {
    const catLabel = getCatLabel(item.category);
    const key = item.sub_section ? `${catLabel} — ${item.sub_section}` : catLabel;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  // ── To-Do (this user's saved items) ─────────────────────────────────────────
  // A saved item whose check the saving user themselves completed is removed the
  // moment that happens (see removeSavedItemOnSelfComplete) — it should never reach
  // here. A check someone ELSE completed stays saved, but moves to its own
  // "Completed by someone else" subsection with a manual remove action, since the
  // saving user may still want a record of it until they clear it themselves.
  const savedItemsAll = enabledChecklists.filter((c) => savedItemIds.has(c.id));
  const todoActiveItems = applyFilters(savedItemsAll.filter((c) => !(c.status === "complete" && c.completed_by === session.user.id)))
    .filter((c) => c.status !== "complete")
    .sort((a, b) => {
      const ca = categoryOrderIndex[a.category] ?? 9999;
      const cb = categoryOrderIndex[b.category] ?? 9999;
      if (ca !== cb) return ca - cb;
      return (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.item_id.localeCompare(b.item_id);
    });
  const todoCompletedByOthers = savedItemsAll.filter((c) => c.status === "complete" && c.completed_by !== session.user.id);
  const groupedTodoItems = todoActiveItems.reduce((acc, item) => {
    const catLabel = getCatLabel(item.category);
    const key = item.sub_section ? `${catLabel} — ${item.sub_section}` : catLabel;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  // ── Item renderer ──────────────────────────────────────────────────────────
  const renderItem = (item, idx, totalInGroup) => {
    const editable = canChangeStatus(item.category);
    const naLocked = isNaLockedByParent(item.id);
    const status = item.status || "pending";
    const isUpdating = updating === item.id;
    const completedByName = item.completed_by ? (profilesMap[item.completed_by]?.full_name || "Unknown") : null;
    const inProgressByName = item.in_progress_by ? (profilesMap[item.in_progress_by]?.full_name || "Unknown") : null;
    const comments = commentsCache[item.id] || [];
    const isCommentsOpen = openComments === item.id;
    const meta = commentMeta[item.id] || { count: 0, hasQaqc: false };
    const sc = statusColors[status] || statusColors.pending;
    const msList = itemMsMap[item.id] || [];
    const isHelpOpen = helpPopover === item.id;
    const isSaved = savedItemIds.has(item.id);

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
            {naLocked && (
              <span title="Locked N/A — a dependency is marked N/A; this will revert automatically once that clears" style={{ fontSize: "10px", fontWeight: "600", color: "var(--c-neutral-text)", background: "var(--c-neutral-bg)", border: "1px solid var(--c-neutral)", borderRadius: "20px", padding: "2px 8px", flexShrink: 0 }}>
                🔒 locked
              </span>
            )}
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
                  const assignedMsIds = itemMsIdMap[item.id] || [];
                  const useMsPopup = s === "complete" && assignedMsIds.length >= 2;
                  return (
                    <button key={s}
                      onClick={() => {
                        if (isUpdating || naLocked) return;
                        if (useMsPopup) { openMilestoneCompletePopup(item); return; }
                        handleStatusChange(item, isActive ? "pending" : s);
                      }}
                      disabled={isUpdating || naLocked}
                      title={naLocked ? "Locked — a dependency is marked N/A" : useMsPopup ? "Choose which deadline(s) this is complete for" : isActive ? `Remove ${title}` : `Mark ${title}`}
                      style={{
                        padding: isMobile ? "4px 7px" : "4px 10px",
                        border: `1px solid ${isActive ? btn.border : "var(--c-border)"}`,
                        borderRadius: "6px", fontSize: "11px", fontWeight: "600",
                        background: isActive ? btn.bg : "transparent",
                        color: isActive ? btn.color : "var(--c-text-4)",
                        cursor: isUpdating || naLocked ? "not-allowed" : "pointer",
                        opacity: naLocked ? 0.45 : 1,
                        transition: "all 0.1s",
                      }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {!editable && !canInteract(item.category) && (
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

            {/* Save Item button — bookmarks this check to the current user's private To-Do list */}
            <button onClick={() => toggleSaveItem(item)} disabled={savingItem === item.id}
              title={isSaved ? "Remove from To-Do" : "Save to To-Do"} style={{
              flexShrink: 0,
              background: isSaved ? "var(--c-accent-dk)" : "transparent",
              border: `1px solid ${isSaved ? "var(--c-accent)" : "var(--c-border)"}`,
              color: isSaved ? "var(--c-accent-lt)" : "var(--c-text-3)",
              borderRadius: "6px", padding: "4px 10px", fontSize: "13px",
              cursor: savingItem === item.id ? "not-allowed" : "pointer",
              opacity: savingItem === item.id ? 0.6 : 1,
            }}>
              🔖
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

          {/* Row 3: Attribution + per-milestone due dates / completion */}
          {(() => {
            const dueInfos = getItemDueInfo(item.id);
            const msIds = itemMsIdMap[item.id] || [];
            const hasAny = (status === "complete" && completedByName) ||
              (status === "in_progress" && inProgressByName) ||
              msIds.length > 0 ||
              (milestones.length > 0 && msIds.length === 0);
            if (!hasAny) return null;
            return (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                {status === "complete" && completedByName && (
                  <span style={{ fontSize: "11px", color: "var(--c-ok-text)", flexShrink: 0, marginRight: "2px" }}>
                    ✓ {completedByName} · {formatDate(item.completed_at)}
                  </span>
                )}
                {status === "in_progress" && inProgressByName && (
                  <span style={{ fontSize: "11px", color: "var(--c-purple)", flexShrink: 0, marginRight: "2px" }}>
                    ▶ {inProgressByName} · {formatDate(item.in_progress_at)}
                  </span>
                )}
                {milestones.length > 0 && msIds.length === 0 && (
                  <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--c-warn)", background: "var(--c-warn-bg)", border: "1px solid var(--c-warn)", borderRadius: "4px", padding: "2px 8px", whiteSpace: "nowrap" }}>
                    ⚠ No deadline set
                  </span>
                )}
                {status !== "na" && dueInfos.map((info) => {
                  const msId = info.milestoneId;
                  const ms = milestones.find((m) => m.id === msId);
                  if (!ms) return null;

                  if (info.completed) {
                    const doneStr = new Date(info.completed.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                    return (
                      <span key={msId} title={`Marked complete for ${ms.name} on ${doneStr}`}
                        style={{ fontSize: "10px", fontWeight: "600", color: "var(--c-ok-text)", background: "var(--c-ok-bg)", border: "1px solid var(--c-ok)", borderRadius: "4px", padding: "2px 8px", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span>✓ {ms.name}</span>
                        <span style={{ opacity: 0.5 }}>·</span>
                        <span>done {doneStr}</span>
                      </span>
                    );
                  }

                  if (info.noDeadline) {
                    return (
                      <span key={msId} title={`${ms.name} has no days-before value set in Project Setup — no due date computed`}
                        style={{ fontSize: "10px", fontWeight: "600", color: "var(--c-warn)", background: "var(--c-warn-bg)", border: "1px solid var(--c-warn)", borderRadius: "4px", padding: "2px 8px", whiteSpace: "nowrap" }}>
                        ⚠ {ms.name} · no deadline
                      </span>
                    );
                  }

                  const isPast = info.daysLeft < 0;
                  const isSoon = info.daysLeft === 0;
                  const color = isPast ? "var(--c-err)" : isSoon ? "var(--c-warn)" : "var(--c-text-3)";
                  const bg = isPast ? "var(--c-err-bg)" : isSoon ? "var(--c-warn-bg)" : "transparent";
                  const border = isPast ? "#7f1d1d" : isSoon ? "var(--c-warn)" : "var(--c-border)";
                  const dueStr = info.dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  const dayLabel = isPast ? `${Math.abs(info.daysLeft)}d overdue` : info.daysLeft === 0 ? "today" : `${info.daysLeft}d left`;
                  const titleSuffix = info.usesMsDateDefault
                    ? ` — no days-before set, using ${ms.name}'s own date (${ms.date}) as the deadline`
                    : ` (${info.daysLeft >= 0 ? info.daysLeft + "d before" : Math.abs(info.daysLeft) + "d past"} ${ms.name} on ${ms.date})`;
                  return (
                    <span key={msId}
                      title={`Due ${dueStr}${titleSuffix}`}
                      style={{ fontSize: "10px", fontWeight: isPast || isSoon ? "600" : "400", color, background: bg, border: `1px solid ${border}`, borderRadius: "4px", padding: "2px 8px", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontWeight: "700" }}>{isPast ? "⚠ " : isSoon ? "⏰ " : ""}{ms.name}</span>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span>{dueStr}{info.usesMsDateDefault && <span style={{ opacity: 0.6 }}>*</span>}</span>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span style={{ fontWeight: "700" }}>{dayLabel}</span>
                    </span>
                  );
                })}
              </div>
            );
          })()}
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
      : viewMode === "milestone"
      ? milestones.map((m) => ({
          id: m.id,
          label: m.name,
          progress: milestoneItemsCache[m.id] ? getMilestoneProgress(m.id) : null,
          active: activeMilestoneId === m.id,
          onClick: () => switchToMilestone(m.id),
        }))
      : [];

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
          { id: "dashboard", label: "📊 Dashboard" },
          { id: "category",  label: "By Category" },
          { id: "milestone", label: "By Milestone" },
          { id: "todo",      label: "🔖 To-Do" },
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

      {/* Filter bar — not relevant to the dashboard overview */}
      {viewMode !== "dashboard" && (
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
      )}

      {/* Mobile: horizontal pill selector */}
      {isMobile && <MobilePills />}

      {/* Desktop: sidebar + content / Mobile: just content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Sidebar (desktop only) */}
        {!isMobile && (
          <div style={{ width: "220px", background: "var(--c-surface)", borderRight: "1px solid #334155", overflowY: "auto", padding: "12px" }}>
            {viewMode === "dashboard" ? (() => {
              const today = new Date(); today.setHours(0,0,0,0);
              const inProgCount = enabledChecklists.filter((c) => c.status === "in_progress").length;
              const withDue = enabledChecklists
                .filter((c) => c.status !== "complete" && c.status !== "na")
                .map((c) => ({ id: c.id, dueDate: getItemDueDate(c) }))
                .filter((c) => c.dueDate);
              const pastDueCount = withDue.filter((c) => c.dueDate < today).length;
              const dueSoonCount = withDue.filter((c) => { const d = Math.ceil((c.dueDate - today) / 86400000); return d === 0; }).length;
              const sections = [
                { label: "QA/QC Alerts",  icon: "🚩", count: qaqcThreads.length,  color: "var(--c-warn)" },
                { label: "Past Due",       icon: "⚠",  count: pastDueCount,       color: "var(--c-err)" },
                { label: "Due Today",      icon: "⏰", count: dueSoonCount,       color: "var(--c-warn)" },
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
                const todayCat = new Date(); todayCat.setHours(0, 0, 0, 0);
                const catAlerts = checklists.filter((c) => {
                  if (c.category !== cat.id || c.status === "complete" || c.status === "na") return false;
                  const dd = getItemDueDate(c);
                  if (!dd) return false;
                  return Math.ceil((dd - todayCat) / 86400000) <= 0;
                });
                return (
                  <button key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{
                    width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 10px", marginBottom: "4px", border: "none", borderRadius: "8px",
                    background: isActive ? "var(--c-accent)" : "transparent",
                    color: isActive ? "white" : canInteract(cat.id) ? "var(--c-text)" : "var(--c-text-3)",
                    cursor: "pointer", fontSize: "13px", textAlign: "left",
                  }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
                    {catAlerts.length > 0 && !isActive && (
                      <span title={`${catAlerts.length} item${catAlerts.length > 1 ? "s" : ""} due today or overdue`}
                        style={{ fontSize: "9px", fontWeight: "700", color: "var(--c-warn)", marginLeft: "4px", flexShrink: 0 }}>
                        ⏰{catAlerts.length}
                      </span>
                    )}
                    <span style={{ fontSize: "10px", fontWeight: "600", flexShrink: 0, marginLeft: "6px",
                      color: isActive ? "rgba(255,255,255,0.85)" : isDone ? "var(--c-ok-text)" : "var(--c-text-3)",
                      whiteSpace: "nowrap" }}>
                      {done}/{applicable} · {pct}%
                    </span>
                  </button>
                );
              })
            ) : viewMode === "milestone" ? (
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
            ) : (
              <>
                <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "4px 0 12px 4px" }}>Your To-Do</p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "13px", color: "var(--c-text)" }}>🔖 Saved</span>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--c-accent)" }}>{todoActiveItems.length}</span>
                </div>
                {todoCompletedByOthers.length > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: "8px" }}>
                    <span style={{ fontSize: "13px", color: "var(--c-text)" }}>✓ Completed by others</span>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--c-ok-text)" }}>{todoCompletedByOthers.length}</span>
                  </div>
                )}
                <p style={{ fontSize: "11px", color: "var(--c-text-4)", margin: "12px 4px 0", lineHeight: "1.5" }}>
                  Private to you — bookmark a check with 🔖 to add it here.
                </p>
              </>
            )}
          </div>
        )}

        {/* Main content */}
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : "24px" }}>
          {loading ? (
            <p style={{ color: "var(--c-text-2)" }}>Loading checklist...</p>
          ) : viewMode === "dashboard" ? (() => {
            const today = new Date(); today.setHours(0,0,0,0);
            const inProgressItems = enabledChecklists.filter((c) => c.status === "in_progress");
            const itemsWithDue = enabledChecklists
              .filter((c) => c.status !== "complete" && c.status !== "na")
              .map((c) => ({ ...c, dueDate: getItemDueDate(c) }))
              .filter((c) => c.dueDate);
            const pastDueItems = itemsWithDue.filter((c) => c.dueDate < today);
            const dueSoonItems = itemsWithDue.filter((c) => {
              const diff = Math.ceil((c.dueDate - today) / 86400000);
              return diff === 0;
            });
            const statCard = (label, value, color) => (
              <div key={label} style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "10px", padding: "16px 20px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", fontWeight: "800", color: color || "var(--c-text)" }}>{value}</div>
                <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "4px" }}>{label}</div>
              </div>
            );
            // Groups items by category + section (same order as "By Category") so
            // Past Due / Due Today lists show clear context instead of a flat list.
            const groupItemsByCategory = (list) => {
              const sorted = [...list].sort((a, b) => {
                const ca = categoryOrderIndex[a.category] ?? 9999;
                const cb = categoryOrderIndex[b.category] ?? 9999;
                if (ca !== cb) return ca - cb;
                return (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.item_id.localeCompare(b.item_id);
              });
              const groups = [];
              const byKey = {};
              sorted.forEach((item) => {
                const catLabel = getCatLabel(item.category);
                const key = item.sub_section ? `${catLabel} — ${item.sub_section}` : catLabel;
                if (!byKey[key]) { byKey[key] = { key, items: [] }; groups.push(byKey[key]); }
                byKey[key].items.push(item);
              });
              return groups;
            };
            const DueList = ({ items, title, color }) => items.length === 0 ? null : (
              <div style={{ marginBottom: "24px" }}>
                <h3 style={{ color: color, margin: "0 0 10px", fontSize: "14px", fontWeight: "700" }}>{title}</h3>
                <div style={{ display: "grid", gap: "14px" }}>
                  {groupItemsByCategory(items).map((g) => (
                    <div key={g.key}>
                      <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 6px" }}>{g.key}</p>
                      <div style={{ display: "grid", gap: "6px" }}>
                        {g.items.map((c) => {
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
                  ))}
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
              const msItems = ids.map((id) => enabledChecklists.find((c) => c.id === id)).filter(Boolean);
              const done = msItems.filter((c) => c.status === "complete").length;
              const applicable = msItems.filter((c) => c.status !== "na").length;
              return { items: msItems, done, applicable, pct: applicable ? Math.round(done / applicable * 100) : 0 };
            };
            const upcomingMs = milestones
              .map((m) => ({ ...m, dateObj: new Date(m.date + "T12:00:00") }))
              .sort((a, b) => a.dateObj - b.dateObj);
            const nextMs = upcomingMs.find((m) => m.dateObj >= today) || null;

            // Status donut chart helpers — N/A excluded; percentages over applicable items only
            const CIRC = 2 * Math.PI * 54;
            const inProgressCount = inProgressItems.length;
            const donutBase = applicableItems; // total - na
            const donutSegments = [
              { pct: donutBase ? completedItems / donutBase : 0, color: "#22c55e", label: "Complete", count: completedItems },
              { pct: donutBase ? inProgressCount / donutBase : 0, color: "#a855f7", label: "In Progress", count: inProgressCount },
              { pct: donutBase ? pendingItems / donutBase : 0, color: "#334155", label: "Pending", count: pendingItems },
            ];

            // Helper: render one QAQC thread card
            const renderQaqcThread = (thread, isResolved) => (
              <div key={thread.itemId} style={{
                background: "var(--c-surface)", borderRadius: "10px", overflow: "hidden",
                border: `1px solid ${isResolved ? "var(--c-border)" : "var(--c-warn)"}`,
                borderLeft: `4px solid ${isResolved ? "var(--c-ok)" : "var(--c-warn)"}`,
              }}>
                {/* Thread header */}
                <div style={{ background: "var(--c-surface-alt)", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isResolved && <span style={{ fontSize: "10px", fontWeight: "700", color: "var(--c-ok-text)", background: "var(--c-ok-bg)", border: "1px solid var(--c-ok)", borderRadius: "20px", padding: "1px 8px", marginRight: "8px" }}>✓ Resolved</span>}
                    <span style={{ fontSize: "12px", color: "var(--c-text-2)", fontWeight: "500" }}>📋 {thread.itemText}</span>
                  </div>
                  {thread.itemCategory && (
                    <button onClick={() => goToItem(thread.itemId, thread.itemCategory)}
                      style={{ flexShrink: 0, fontSize: "11px", fontWeight: "600", color: "var(--c-accent-lt)", background: "var(--c-accent-dk)", border: "1px solid #0095da", borderRadius: "6px", padding: "3px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                      View in checklist →
                    </button>
                  )}
                </div>
                {/* Full comment thread */}
                <div style={{ padding: "12px 14px", display: "grid", gap: "8px" }}>
                  {thread.comments.map((c) => {
                    const isFlag = c.is_qaqc_flagged;
                    const isFlagResolved = isFlag && c.is_resolved;
                    return (
                      <div key={c.id} style={{
                        background: isFlag ? (isFlagResolved ? "var(--c-surface-alt)" : "var(--c-warn-bg)") : "var(--c-surface-alt)",
                        borderRadius: "8px", padding: "9px 12px",
                        borderLeft: isFlag ? `3px solid ${isFlagResolved ? "var(--c-ok)" : "var(--c-warn)"}` : "3px solid var(--c-border)",
                        opacity: isFlagResolved ? 0.75 : 1,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px", flexWrap: "wrap", gap: "6px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                            {isFlag && (
                              <span style={{ fontSize: "10px", fontWeight: "700", color: isFlagResolved ? "var(--c-ok-text)" : "var(--c-warn)", background: isFlagResolved ? "var(--c-ok-bg)" : "var(--c-warn-bg)", border: `1px solid ${isFlagResolved ? "var(--c-ok)" : "var(--c-warn)"}`, borderRadius: "20px", padding: "1px 7px" }}>
                                {isFlagResolved ? "✓ QA/QC" : "🚩 QA/QC"}
                              </span>
                            )}
                            <span style={{ fontSize: "12px", color: "var(--c-text)", fontWeight: "600" }}>{c.authorName}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "11px", color: "var(--c-text-3)" }}>{formatDate(c.created_at)}</span>
                            {isFlag && !isFlagResolved && (
                              <button onClick={() => resolveAlert(c.id)}
                                style={{ fontSize: "11px", fontWeight: "600", color: "var(--c-ok-text)", background: "var(--c-ok-bg)", border: "1px solid var(--c-ok)", borderRadius: "6px", padding: "2px 9px", cursor: "pointer", whiteSpace: "nowrap" }}>
                                ✓ Resolve
                              </button>
                            )}
                            {isFlag && isFlagResolved && (
                              <button onClick={() => unresolveAlert(c.id)}
                                style={{ fontSize: "11px", fontWeight: "600", color: "var(--c-warn)", background: "var(--c-warn-bg)", border: "1px solid var(--c-warn)", borderRadius: "6px", padding: "2px 9px", cursor: "pointer", whiteSpace: "nowrap" }}>
                                ↩ Reopen
                              </button>
                            )}
                          </div>
                        </div>
                        <p style={{ margin: 0, fontSize: "13px", color: "var(--c-text)", lineHeight: "1.55" }}>{c.comment}</p>
                        {isFlagResolved && c.resolved_at && (
                          <p style={{ margin: "5px 0 0", fontSize: "10px", color: "var(--c-text-4)" }}>
                            Resolved {formatDate(c.resolved_at)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Reply input (open threads only) */}
                {!isResolved && (
                  <div style={{ padding: "0 14px 12px", display: "flex", gap: "6px" }}>
                    <input
                      value={dashReplyText[thread.itemId] || ""}
                      onChange={(e) => setDashReplyText((prev) => ({ ...prev, [thread.itemId]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitDashReply(thread.itemId)}
                      placeholder="Reply to this thread…"
                      style={{ flex: 1, padding: "7px 11px", background: "var(--c-bg)", border: "1px solid var(--c-border)", borderRadius: "6px", color: "var(--c-text)", fontSize: "12px" }}
                    />
                    <button
                      onClick={() => submitDashReply(thread.itemId)}
                      disabled={dashReplying === thread.itemId || !(dashReplyText[thread.itemId] || "").trim()}
                      style={{ padding: "7px 14px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>
                      {dashReplying === thread.itemId ? "…" : "Send"}
                    </button>
                  </div>
                )}
              </div>
            );

            return (
              <>
                {/* ── 1. Header ─────────────────────────────────────── */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "20px", gap: "12px", flexWrap: "wrap" }}>
                  <h2 style={{ color: "var(--c-text)", margin: 0, fontSize: "18px" }}>Project Dashboard</h2>
                  <span style={{ fontSize: "12px", color: "var(--c-text-3)" }}>{new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
                </div>

                {/* ── 2. Next Milestone Banner ───────────────────────── */}
                {nextMs && (() => {
                  const dLeft = Math.ceil((nextMs.dateObj - today) / 86400000);
                  const { done, applicable, pct } = getMsProgress(nextMs.id);
                  return (
                    <div style={{ background: "var(--c-accent-dk)", border: "1px solid var(--c-accent)", borderRadius: "12px", padding: "16px 20px", marginBottom: "20px" }}>
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

                {/* ── 3. Stats + Charts ──────────────────────────────── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "8px", marginBottom: "16px" }}>
                  {statCard("Total", totalItems, "var(--c-text)")}
                  {statCard("Complete", completedItems, "var(--c-ok-text)")}
                  {statCard("In Progress", inProgressItems.length, "var(--c-purple)")}
                  {statCard("Pending", pendingItems, "var(--c-text-2)")}
                  {statCard("N/A", naItems, "var(--c-text-4)")}
                  {statCard("Progress", `${overallProgress}%`, overallProgress === 100 ? "var(--c-ok-text)" : "var(--c-accent)")}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "auto 1fr", gap: "14px", marginBottom: "24px", alignItems: "start" }}>
                  {/* Donut */}
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
                        <text x="80" y="94" textAnchor="middle" fontSize="10" fill="var(--c-text-4)">{completedItems}/{applicableItems}</text>
                      </svg>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {donutSegments.map(({ label, count, color }) => (
                          <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: color, flexShrink: 0 }} />
                            <span style={{ fontSize: "12px", color: "var(--c-text-3)", minWidth: "70px" }}>{label}</span>
                            <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--c-text)" }}>{count}</span>
                          </div>
                        ))}
                        {naItems > 0 && (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", opacity: 0.6 }}>
                            <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#475569", flexShrink: 0 }} />
                            <span style={{ fontSize: "12px", color: "var(--c-text-3)", minWidth: "70px" }}>N/A</span>
                            <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--c-text)" }}>{naItems}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Category bars */}
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

                {/* ── 4. Milestone Timeline ──────────────────────────── */}
                {milestones.length > 0 && (
                  <div style={{ background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "12px", padding: "16px 20px", marginBottom: "24px" }}>
                    <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 16px" }}>Milestone Timeline</p>
                    {upcomingMs.map((m, idx) => {
                      const dLeft = Math.ceil((m.dateObj - today) / 86400000);
                      const isPast = dLeft < 0;
                      const isNext = !isPast && nextMs?.id === m.id;
                      const { done, applicable, pct } = getMsProgress(m.id);
                      const dotColor = isPast ? "#22c55e" : isNext ? "var(--c-accent)" : "var(--c-border)";
                      return (
                        <div key={m.id} style={{ display: "flex", gap: "14px" }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "14px", flexShrink: 0 }}>
                            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: dotColor, border: `2px solid ${isNext ? "var(--c-accent)" : dotColor}`, boxShadow: isNext ? "0 0 0 3px var(--c-accent-dk)" : "none", marginTop: "3px", flexShrink: 0 }} />
                            {idx < upcomingMs.length - 1 && <div style={{ width: "2px", flex: 1, background: "var(--c-border)", margin: "4px 0" }} />}
                          </div>
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

                {/* ── 5. QA/QC Open Issues ───────────────────────────── */}
                {qaqcThreads.length > 0 && (
                  <div style={{ marginBottom: "24px" }}>
                    <h3 style={{ color: "var(--c-warn)", margin: "0 0 12px", fontSize: "14px", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px" }}>
                      🚩 QA/QC — Open Issues
                      <span style={{ background: "var(--c-warn)", color: "white", borderRadius: "20px", padding: "1px 9px", fontSize: "12px" }}>{qaqcThreads.length}</span>
                    </h3>
                    <div style={{ display: "grid", gap: "12px" }}>
                      {qaqcThreads.map((t) => renderQaqcThread(t, false))}
                    </div>
                  </div>
                )}

                {/* ── 6. Past Due / Due Today / In Progress ──────────── */}
                <DueList items={pastDueItems} title={`⚠ Past Due (${pastDueItems.length})`} color="var(--c-err)" />
                <DueList items={dueSoonItems} title={`⏰ Due Today (${dueSoonItems.length})`} color="var(--c-warn)" />
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

                {/* ── 7. Resolved QA/QC (collapsed history) ─────────── */}
                {resolvedQaqcThreads.length > 0 && (
                  <div style={{ marginBottom: "24px" }}>
                    <button onClick={() => setResolvedExpanded((v) => !v)}
                      style={{ display: "flex", alignItems: "center", gap: "8px", background: "none", border: "none", cursor: "pointer", padding: "0", marginBottom: resolvedExpanded ? "12px" : "0" }}>
                      <span style={{ fontSize: "14px", fontWeight: "700", color: "var(--c-ok-text)" }}>✓ Resolved QA/QC</span>
                      <span style={{ fontSize: "12px", color: "var(--c-text-4)", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "20px", padding: "1px 9px" }}>{resolvedQaqcThreads.length}</span>
                      <span style={{ fontSize: "12px", color: "var(--c-text-4)" }}>{resolvedExpanded ? "▲" : "▼"}</span>
                    </button>
                    {resolvedExpanded && (
                      <div style={{ display: "grid", gap: "12px" }}>
                        {resolvedQaqcThreads.map((t) => renderQaqcThread(t, true))}
                      </div>
                    )}
                  </div>
                )}

                {/* All clear */}
                {qaqcThreads.length === 0 && pastDueItems.length === 0 && dueSoonItems.length === 0 && inProgressItems.length === 0 && (
                  <p style={{ color: "var(--c-text-3)", textAlign: "center", paddingTop: "20px" }}>No alerts — all clear! 🎉</p>
                )}
              </>
            );
          })() : viewMode === "category" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                <h2 style={{ color: "var(--c-text)", margin: 0, fontSize: isMobile ? "16px" : "20px" }}>
                  {getCatLabel(activeCategory)}
                </h2>
                {activeCategory && !canInteract(activeCategory) && (
                  <span style={{ fontSize: "11px", color: "var(--c-warn)", background: "var(--c-warn-bg)", padding: "4px 10px", borderRadius: "20px", border: "1px solid #f59e0b" }}>
                    View only
                  </span>
                )}
              </div>
              {(() => {
                const todayCv = new Date(); todayCv.setHours(0, 0, 0, 0);
                const catDue = checklists
                  .filter((c) => c.category === activeCategory && c.status !== "complete" && c.status !== "na")
                  .map((c) => ({ ...c, _dueDate: getItemDueDate(c) }))
                  .filter((c) => c._dueDate);
                const pastDue = catDue.filter((c) => c._dueDate < todayCv);
                const dueSoon = catDue.filter((c) => { const d = Math.ceil((c._dueDate - todayCv) / 86400000); return d === 0; });
                if (pastDue.length === 0 && dueSoon.length === 0) return null;
                return (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                    {pastDue.length > 0 && (
                      <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--c-err)", background: "var(--c-err-bg)", border: "1px solid #7f1d1d", borderRadius: "6px", padding: "4px 10px" }}>
                        ⚠ {pastDue.length} item{pastDue.length > 1 ? "s" : ""} past due
                      </span>
                    )}
                    {dueSoon.length > 0 && (
                      <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--c-warn)", background: "var(--c-warn-bg)", border: "1px solid var(--c-warn)", borderRadius: "6px", padding: "4px 10px" }}>
                        ⏰ {dueSoon.length} item{dueSoon.length > 1 ? "s" : ""} due today
                      </span>
                    )}
                  </div>
                );
              })()}
              {Object.entries(groupedCategoryItems).map(([sub, items]) => renderSection(sub, items))}
            </>
          ) : viewMode === "milestone" ? (
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
          ) : (
            <>
              <h2 style={{ color: "var(--c-text)", margin: "0 0 4px", fontSize: isMobile ? "16px" : "20px" }}>🔖 To-Do</h2>
              <p style={{ color: "var(--c-text-3)", fontSize: "12px", margin: "0 0 20px" }}>
                Private to you — only checks you've bookmarked appear here.
              </p>
              {todoActiveItems.length === 0 && todoCompletedByOthers.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                  <p style={{ color: "var(--c-text-2)", fontSize: "16px" }}>Nothing saved yet.</p>
                  <p style={{ color: "var(--c-text-3)", fontSize: "14px" }}>Tap 🔖 on any check to add it to your To-Do list.</p>
                </div>
              ) : (
                <>
                  {Object.entries(groupedTodoItems).map(([sub, items]) => renderSection(sub, items))}
                  {todoCompletedByOthers.length > 0 && (
                    <div style={{ marginTop: "24px" }}>
                      <h3 style={{ color: "var(--c-ok-text)", margin: "0 0 12px", fontSize: "14px", fontWeight: "700" }}>
                        ✓ Completed by someone else ({todoCompletedByOthers.length})
                      </h3>
                      <div style={{ display: "grid", gap: "8px" }}>
                        {todoCompletedByOthers.map((c) => (
                          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", background: "var(--c-surface)", border: "1px solid var(--c-ok)", borderRadius: "8px", padding: "10px 14px" }}>
                            <div style={{ minWidth: 0 }}>
                              <span style={{ fontSize: "10px", color: "var(--c-text-4)", fontFamily: "monospace" }}>{refCodes[c.id]} </span>
                              <span style={{ fontSize: "13px", color: "var(--c-text)" }}>{c.item_text}</span>
                              <div style={{ fontSize: "11px", color: "var(--c-ok-text)", marginTop: "4px" }}>
                                ✓ {c.completed_by ? (profilesMap[c.completed_by]?.full_name || "Unknown") : "Completed automatically"} · {formatDate(c.completed_at)}
                              </div>
                            </div>
                            <button onClick={() => toggleSaveItem(c)} disabled={savingItem === c.id} style={{
                              flexShrink: 0, padding: "5px 12px", background: "transparent", border: "1px solid var(--c-border)",
                              color: "var(--c-text-2)", borderRadius: "6px", cursor: savingItem === c.id ? "not-allowed" : "pointer", fontSize: "12px",
                            }}>
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Multi-milestone completion picker */}
      {milestoneCompletePopup && (() => {
        const { item, selected } = milestoneCompletePopup;
        const sortedMs = getSortedAssignedMilestones(item.id);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        // Milestone at index i is checkable only once the previous one's date has
        // passed (its turn has "come up") AND every earlier milestone is selected —
        // deadlines must be completed in order, earliest first.
        const eligibility = sortedMs.map((m, idx) => {
          const prev = idx > 0 ? sortedMs[idx - 1] : null;
          const dateOk = !prev || today >= new Date(prev.date + "T00:00:00");
          const orderOk = idx === 0 || selected.has(sortedMs[idx - 1].id);
          return { ...m, eligible: dateOk && orderOk, dateOk, prev };
        });
        const toggleMs = (msId, eligible) => {
          setMilestoneCompletePopup((prev) => {
            const nextSel = new Set(prev.selected);
            if (nextSel.has(msId)) {
              // Unchecking an earlier deadline must also clear any later ones that
              // depend on it, so the selection never ends up out of order.
              const idx = sortedMs.findIndex((m) => m.id === msId);
              sortedMs.slice(idx).forEach((m) => nextSel.delete(m.id));
            } else if (eligible) {
              nextSel.add(msId);
            }
            return { ...prev, selected: nextSel };
          });
        };
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: "16px" }}
            onClick={() => setMilestoneCompletePopup(null)}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--c-surface)", borderRadius: "12px", padding: "20px 22px", width: "380px", maxWidth: "100%", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: "15px", color: "var(--c-text)" }}>Complete for which deadline(s)?</h3>
              <p style={{ margin: "0 0 14px", fontSize: "12px", color: "var(--c-text-3)", lineHeight: "1.5" }}>{item.item_text}</p>
              <div style={{ display: "grid", gap: "8px", marginBottom: "18px", maxHeight: "50vh", overflowY: "auto" }}>
                {eligibility.map((ms) => {
                  const isChecked = selected.has(ms.id);
                  const disabled = !isChecked && !ms.eligible;
                  const reason = !ms.dateOk
                    ? `Not yet current — becomes available once "${ms.prev.name}" (${ms.prev.date}) has passed`
                    : !isChecked && !ms.eligible
                      ? `Complete "${ms.prev.name}" first`
                      : null;
                  return (
                    <label key={ms.id} title={reason || undefined}
                      style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", background: "var(--c-bg)", borderRadius: "8px", border: `1px solid ${isChecked ? "var(--c-ok)" : "var(--c-border)"}`, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>
                      <input type="checkbox" checked={isChecked} disabled={disabled} onChange={() => toggleMs(ms.id, ms.eligible)} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: "13px", color: "var(--c-text)", fontWeight: "600" }}>{ms.name}</div>
                        <div style={{ fontSize: "11px", color: "var(--c-text-3)" }}>{new Date(ms.date + "T00:00:00").toLocaleDateString()}</div>
                        {reason && <div style={{ fontSize: "10px", color: "var(--c-warn)", marginTop: "2px" }}>{reason}</div>}
                      </div>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button onClick={() => setMilestoneCompletePopup(null)} disabled={updating === item.id} style={{ padding: "7px 14px", background: "transparent", border: "1px solid var(--c-border)", color: "var(--c-text-2)", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
                  Cancel
                </button>
                <button onClick={() => applyMilestoneCompletion(item, selected)} disabled={updating === item.id} style={{ padding: "7px 16px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "6px", cursor: updating === item.id ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: "600" }}>
                  {updating === item.id ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
