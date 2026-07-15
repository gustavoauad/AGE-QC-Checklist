import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { CATEGORIES } from "../checklistTemplate";
import { useIsMobile } from "../useIsMobile";

const inputStyle = {
  width: "100%", padding: "10px 12px", background: "var(--c-bg)",
  border: "1px solid #334155", borderRadius: "8px", color: "var(--c-text)",
  fontSize: "14px", boxSizing: "border-box",
};
const labelStyle = { display: "block", color: "var(--c-text-2)", fontSize: "13px", marginBottom: "6px" };

// ── Checklists tab ─────────────────────────────────────────────────────────
function deriveSections(catItems) {
  const seen = new Set();
  const result = [];
  (catItems || []).forEach((item) => {
    if (item.sub_section && !seen.has(item.sub_section)) { seen.add(item.sub_section); result.push(item.sub_section); }
  });
  return result;
}

function buildSortOrder(catItems, sectionOrder) {
  const buckets = {};
  sectionOrder.forEach((s) => { buckets[s] = []; });
  buckets["__none__"] = [];
  catItems.forEach((item) => {
    const key = item.sub_section || "__none__";
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(item);
  });
  let idx = 0;
  const out = [];
  [...sectionOrder, "__none__"].forEach((key) => {
    (buckets[key] || []).forEach((item) => { out.push({ ...item, sort_order: idx++ }); });
  });
  return out;
}

function ChecklistsTab({ project, userRole }) {
  const isMobile = useIsMobile();
  const canEdit = userRole === "project_manager" || userRole === "qaqc";
  const [config, setConfig] = useState({});
  const [items, setItems] = useState({});
  const [sections, setSections] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editItemText, setEditItemText] = useState("");
  const [addingTo, setAddingTo] = useState(null);
  const [newItemText, setNewItemText] = useState("");
  const [addingSection, setAddingSection] = useState(null);
  const [newSectionText, setNewSectionText] = useState("");
  const [renamingSection, setRenamingSection] = useState(null);
  const [renameSectionText, setRenameSectionText] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [savingCat, setSavingCat] = useState(false);
  const [renamingCat, setRenamingCat] = useState(null);
  const [renameCatText, setRenameCatText] = useState("");
  const dragInfo = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const [milestones, setMilestones] = useState([]);
  // itemMilestones: itemId → Set<milestoneId>
  const [itemMilestones, setItemMilestones] = useState({});
  // daysPopover: { type:'cat'|'section', catId, sectionLabel?, msInputs:{ [msId]: string } }
  const [daysPopover, setDaysPopover] = useState(null);
  // editingDays: { itemId, milestoneId, val } — inline days input on a specific pill
  const [editingDays, setEditingDays] = useState(null);
  // itemDeps: { [itemId]: Set<dependsOnItemId> }
  const [itemDeps, setItemDeps] = useState({});
  // depsPickerItemId: which item's dep picker is open
  const [depsPickerItemId, setDepsPickerItemId] = useState(null);
  const [depsPickerSearch, setDepsPickerSearch] = useState("");
  // itemMilestoneDays: { [itemId]: { [milestoneId]: number } }
  const [itemMilestoneDays, setItemMilestoneDays] = useState({});

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    const [cfgRes, itemsRes, msRes] = await Promise.all([
      supabase.from("project_checklist_config").select("*").eq("project_id", project.id),
      supabase.from("checklists").select("*").eq("project_id", project.id)
        .order("category").order("sort_order", { nullsFirst: false }).order("item_id"),
      supabase.from("project_milestones").select("*").eq("project_id", project.id).order("date"),
    ]);
    const cfgMap = {};
    (cfgRes.data || []).forEach((r) => { cfgMap[r.category] = { enabled: r.enabled, label: r.label, is_custom: r.is_custom }; });
    setConfig(cfgMap);
    const itemMap = {};
    (itemsRes.data || []).forEach((row) => {
      if (!itemMap[row.category]) itemMap[row.category] = [];
      itemMap[row.category].push(row);
    });
    setItems(itemMap);
    const sectionMap = {};
    Object.entries(itemMap).forEach(([catId, catItems]) => { sectionMap[catId] = deriveSections(catItems); });
    setSections(sectionMap);
    const ms = msRes.data || [];
    setMilestones(ms);
    // Load all milestone_items for this project in one query
    if (ms.length > 0) {
      const msIds = ms.map((m) => m.id);
      const { data: miData } = await supabase.from("milestone_items")
        .select("milestone_id, checklist_item_id, days_before")
        .in("milestone_id", msIds);
      const imMap = {};
      const imdMap = {};
      (miData || []).forEach(({ milestone_id, checklist_item_id, days_before }) => {
        if (!imMap[checklist_item_id]) imMap[checklist_item_id] = new Set();
        imMap[checklist_item_id].add(milestone_id);
        if (days_before != null) {
          if (!imdMap[checklist_item_id]) imdMap[checklist_item_id] = {};
          imdMap[checklist_item_id][milestone_id] = days_before;
        }
      });
      setItemMilestones(imMap);
      setItemMilestoneDays(imdMap);
    }
    // Load item dependencies
    const allItemIds = Object.values(itemMap).flat().map((i) => i.id);
    if (allItemIds.length > 0) {
      const { data: depsData } = await supabase
        .from("checklist_item_dependencies")
        .select("item_id, depends_on_item_id")
        .in("item_id", allItemIds);
      const dMap = {};
      (depsData || []).forEach(({ item_id, depends_on_item_id }) => {
        if (!dMap[item_id]) dMap[item_id] = new Set();
        dMap[item_id].add(depends_on_item_id);
      });
      setItemDeps(dMap);
    }
    setLoading(false);
  };

  const standardCatIds = new Set(CATEGORIES.map((c) => c.id));
  const customCats = Object.entries(config)
    .filter(([key, val]) => !standardCatIds.has(key) && val?.label)
    .map(([key, val]) => ({ id: key, label: val.label, isCustom: true }));
  const allCats = [...CATEGORIES.map((c) => ({ ...c, isCustom: false })), ...customCats];
  const getLabel = (cat) => config[cat.id]?.label || cat.label;
  const mBtn = (extra = {}) => ({ padding: "3px 7px", background: "transparent", border: "1px solid #334155", color: "var(--c-text-3)", borderRadius: "4px", cursor: "pointer", fontSize: "11px", fontFamily: "Manrope, sans-serif", ...extra });

  // Reference codes: itemId → "PREFIX-S.I"
  const refCodes = (() => {
    const codes = {};
    allCats.forEach((cat) => {
      if (config[cat.id]?.enabled === false) return;
      const label = getLabel(cat);
      const prefix = label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
      const catItems = [...(items[cat.id] || [])]
        .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.item_id.localeCompare(b.item_id));
      const seenSections = [];
      catItems.forEach((item) => {
        const s = item.sub_section || null;
        if (!seenSections.includes(s)) seenSections.push(s);
      });
      seenSections.forEach((section, sIdx) => {
        catItems.filter((i) => (i.sub_section || null) === section)
          .forEach((item, iIdx) => { codes[item.id] = `${prefix}-${sIdx + 1}.${iIdx + 1}`; });
      });
    });
    return codes;
  })();

  const toggle = async (catId) => {
    if (!canEdit) return;
    const newEnabled = !(config[catId]?.enabled !== false);
    setConfig((p) => ({ ...p, [catId]: { ...p[catId], enabled: newEnabled } }));
    await supabase.from("project_checklist_config").upsert(
      { project_id: project.id, category: catId, enabled: newEnabled, label: config[catId]?.label || null },
      { onConflict: "project_id,category" }
    );
  };

  const saveRename = async (catId) => {
    if (!renameCatText.trim()) { setRenamingCat(null); return; }
    await supabase.from("project_checklist_config").upsert(
      { project_id: project.id, category: catId, label: renameCatText.trim(), enabled: config[catId]?.enabled !== false },
      { onConflict: "project_id,category" }
    );
    setConfig((p) => ({ ...p, [catId]: { ...p[catId], label: renameCatText.trim() } }));
    setRenamingCat(null);
  };

  const addCustomCategory = async () => {
    if (!newCatName.trim()) return;
    setSavingCat(true);
    const catId = `proj_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await supabase.from("project_checklist_config").insert({ project_id: project.id, category: catId, label: newCatName.trim(), enabled: true, is_custom: true });
    setConfig((p) => ({ ...p, [catId]: { enabled: true, label: newCatName.trim(), is_custom: true } }));
    setItems((p) => ({ ...p, [catId]: [] }));
    setSections((p) => ({ ...p, [catId]: [] }));
    setNewCatName(""); setAddingCat(false); setSavingCat(false);
  };

  const deleteCustomCat = async (catId) => {
    if (!window.confirm("Delete this checklist and all its items? This cannot be undone.")) return;
    await Promise.all([
      supabase.from("checklists").delete().eq("project_id", project.id).eq("category", catId),
      supabase.from("project_checklist_config").delete().eq("project_id", project.id).eq("category", catId),
    ]);
    setConfig((p) => { const n = { ...p }; delete n[catId]; return n; });
    setItems((p) => { const n = { ...p }; delete n[catId]; return n; });
    setSections((p) => { const n = { ...p }; delete n[catId]; return n; });
    if (expandedCat === catId) setExpandedCat(null);
  };

  const saveItemEdit = async (item) => {
    if (!editItemText.trim()) { setEditingItemId(null); return; }
    await supabase.from("checklists").update({ item_text: editItemText.trim(), edited_by_pm: true }).eq("id", item.id);
    setItems((p) => ({ ...p, [item.category]: p[item.category].map((i) => i.id === item.id ? { ...i, item_text: editItemText.trim(), edited_by_pm: true } : i) }));
    setEditingItemId(null);
  };

  const saveMilestoneDays = async (itemIds, milestoneId, daysStr) => {
    const days = daysStr === "" ? null : parseInt(daysStr, 10);
    if (days !== null && (isNaN(days) || days < 0)) return;
    const targets = itemIds.filter((id) => itemMilestones[id]?.has(milestoneId));
    if (!targets.length) return;
    await Promise.all(targets.map((id) =>
      supabase.from("milestone_items")
        .upsert(
          { checklist_item_id: id, milestone_id: milestoneId, days_before: days },
          { onConflict: "checklist_item_id,milestone_id" }
        )
    ));
    setItemMilestoneDays((prev) => {
      const next = { ...prev };
      targets.forEach((id) => {
        next[id] = { ...(next[id] || {}) };
        if (days == null) delete next[id][milestoneId];
        else next[id][milestoneId] = days;
      });
      return next;
    });
  };

  const wouldCreateCycle = (fromId, toId, depsMap) => {
    if (fromId === toId) return true;
    const visited = new Set();
    const stack = [...(depsMap[toId] || new Set())];
    while (stack.length) {
      const curr = stack.pop();
      if (curr === fromId) return true;
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const p of (depsMap[curr] || new Set())) stack.push(p);
    }
    return false;
  };

  const toggleDep = async (itemId, depOnId, add) => {
    if (add && wouldCreateCycle(itemId, depOnId, itemDeps)) {
      alert("Cannot add this dependency — it would create a circular dependency.");
      return;
    }
    setItemDeps((prev) => {
      const next = { ...prev };
      next[itemId] = new Set(next[itemId] || []);
      if (add) next[itemId].add(depOnId); else next[itemId].delete(depOnId);
      return next;
    });
    if (add) {
      supabase.from("checklist_item_dependencies").insert({ item_id: itemId, depends_on_item_id: depOnId });
    } else {
      supabase.from("checklist_item_dependencies").delete()
        .eq("item_id", itemId).eq("depends_on_item_id", depOnId);
    }
  };

  const openDaysPopover = (type, catId, sectionLabel) => {
    const scopeItems = (items[catId] || []).filter((i) => type === "section" ? i.sub_section === sectionLabel : true);
    const msInputs = {};
    milestones.forEach((m) => {
      const assignedItems = scopeItems.filter((i) => itemMilestones[i.id]?.has(m.id));
      if (assignedItems.length === 0) { msInputs[m.id] = ""; return; }
      const vals = assignedItems.map((i) => itemMilestoneDays[i.id]?.[m.id]).filter((v) => v != null);
      const uniq = [...new Set(vals)];
      msInputs[m.id] = uniq.length === 1 ? String(uniq[0]) : "";
    });
    setDaysPopover({ type, catId, sectionLabel, msInputs });
  };

  const applyDaysPopover = async () => {
    if (!daysPopover) return;
    const { type, catId, sectionLabel, msInputs } = daysPopover;
    const scopeItems = (items[catId] || []).filter((i) => type === "section" ? i.sub_section === sectionLabel : true);
    await Promise.all(
      Object.entries(msInputs).map(([msId, val]) => saveMilestoneDays(scopeItems.map((i) => i.id), msId, val))
    );
    setDaysPopover(null);
  };

  const removeItem = async (item) => {
    if (!window.confirm("Remove this item from the checklist?")) return;
    await supabase.from("checklists").delete().eq("id", item.id);
    setItems((p) => ({ ...p, [item.category]: p[item.category].filter((i) => i.id !== item.id) }));
  };

  const addItem = async (catId, section) => {
    if (!newItemText.trim()) return;
    const catItems = items[catId] || [];
    const maxOrder = catItems.reduce((m, i) => Math.max(m, i.sort_order ?? 0), -1);
    const { data: newItem } = await supabase.from("checklists").insert({
      project_id: project.id,
      item_id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category: catId, sub_section: section || null, item_text: newItemText.trim(),
      status: "pending", sort_order: maxOrder + 1, is_custom: true,
    }).select().single();
    if (newItem) {
      setItems((p) => ({ ...p, [catId]: [...(p[catId] || []), newItem] }));
      if (section && !(sections[catId] || []).includes(section))
        setSections((p) => ({ ...p, [catId]: [...(p[catId] || []), section] }));
    }
    setNewItemText(""); setAddingTo(null);
  };

  const addSection = (catId) => {
    if (!newSectionText.trim()) return;
    const label = newSectionText.trim();
    if (!(sections[catId] || []).includes(label))
      setSections((p) => ({ ...p, [catId]: [...(p[catId] || []), label] }));
    setNewSectionText(""); setAddingSection(null);
  };

  const renameSection = async (catId, oldLabel) => {
    const newLabel = renameSectionText.trim();
    if (!newLabel || newLabel === oldLabel) { setRenamingSection(null); return; }
    const ids = (items[catId] || []).filter((i) => i.sub_section === oldLabel).map((i) => i.id);
    if (ids.length) await supabase.from("checklists").update({ sub_section: newLabel }).in("id", ids);
    setItems((p) => ({ ...p, [catId]: (p[catId] || []).map((i) => i.sub_section === oldLabel ? { ...i, sub_section: newLabel } : i) }));
    setSections((p) => ({ ...p, [catId]: (p[catId] || []).map((s) => s === oldLabel ? newLabel : s) }));
    setRenamingSection(null);
  };

  const deleteSection = async (catId, label) => {
    if (!window.confirm(`Remove section "${label}"? Items in it will become unsectioned.`)) return;
    const ids = (items[catId] || []).filter((i) => i.sub_section === label).map((i) => i.id);
    if (ids.length) await supabase.from("checklists").update({ sub_section: null }).in("id", ids);
    setItems((p) => ({ ...p, [catId]: (p[catId] || []).map((i) => i.sub_section === label ? { ...i, sub_section: null } : i) }));
    setSections((p) => ({ ...p, [catId]: (p[catId] || []).filter((s) => s !== label) }));
  };

  const toggleItemMilestone = async (itemId, milestoneId, add) => {
    // Optimistic state update
    setItemMilestones((prev) => {
      const next = { ...prev };
      next[itemId] = new Set(next[itemId] || []);
      if (add) next[itemId].add(milestoneId); else next[itemId].delete(milestoneId);
      return next;
    });
    if (add) {
      const { error } = await supabase.from("milestone_items")
        .upsert({ milestone_id: milestoneId, checklist_item_id: itemId }, { onConflict: "milestone_id,checklist_item_id" });
      if (error) {
        console.error("milestone_items insert failed:", error);
        // Revert optimistic update
        setItemMilestones((prev) => {
          const next = { ...prev };
          next[itemId] = new Set(next[itemId] || []);
          next[itemId].delete(milestoneId);
          return next;
        });
      }
    } else {
      const { error } = await supabase.from("milestone_items").delete()
        .eq("milestone_id", milestoneId).eq("checklist_item_id", itemId);
      if (error) {
        console.error("milestone_items delete failed:", error);
        // Revert optimistic update
        setItemMilestones((prev) => {
          const next = { ...prev };
          next[itemId] = new Set(next[itemId] || []);
          next[itemId].add(milestoneId);
          return next;
        });
      }
    }
  };

  const bulkToggleMilestone = async (itemIds, milestoneId, add) => {
    // Determine which items actually need to change
    const toChange = itemIds.filter((id) => {
      const has = itemMilestones[id]?.has(milestoneId) ?? false;
      return add ? !has : has;
    });
    if (!toChange.length) return;

    // Optimistic batch state update
    setItemMilestones((prev) => {
      const next = { ...prev };
      toChange.forEach((id) => {
        next[id] = new Set(next[id] || []);
        if (add) next[id].add(milestoneId); else next[id].delete(milestoneId);
      });
      return next;
    });

    // Single batched DB call
    if (add) {
      const { error } = await supabase.from("milestone_items").upsert(
        toChange.map((id) => ({ milestone_id: milestoneId, checklist_item_id: id })),
        { onConflict: "milestone_id,checklist_item_id" }
      );
      if (error) console.error("bulk milestone insert failed:", error);
    } else {
      const { error } = await supabase.from("milestone_items").delete()
        .eq("milestone_id", milestoneId).in("checklist_item_id", toChange);
      if (error) console.error("bulk milestone delete failed:", error);
    }
  };

  const handleDragEnd = () => { dragInfo.current = null; setDragOver(null); };

  const handleSectionDragStart = (e, catId, label, fromIdx) => {
    e.stopPropagation();
    dragInfo.current = { type: "section", catId, label, fromIdx };
    e.dataTransfer.effectAllowed = "move";
  };

  const handleSectionDragOver = (e, catId, label, toIdx) => {
    e.preventDefault(); e.stopPropagation();
    if (dragInfo.current?.type === "section" && dragInfo.current?.catId === catId) setDragOver(`so:${catId}:${toIdx}`);
    else if (dragInfo.current?.type === "item" && dragInfo.current?.catId === catId) setDragOver(`sh:${catId}:${label}`);
  };

  const reorderSections = async (catId, fromLabel, toIdx) => {
    const arr = [...(sections[catId] || [])];
    const fromIdx = arr.indexOf(fromLabel);
    if (fromIdx === -1 || fromIdx === toIdx) return;
    arr.splice(fromIdx, 1); arr.splice(toIdx, 0, fromLabel);
    setSections((p) => ({ ...p, [catId]: arr }));
    const reordered = buildSortOrder(items[catId] || [], arr);
    setItems((p) => ({ ...p, [catId]: reordered }));
    await Promise.all(reordered.map((item) => supabase.from("checklists").update({ sort_order: item.sort_order }).eq("id", item.id)));
  };

  const assignItemToSection = async (catId, itemId, newSection) => {
    setItems((p) => ({ ...p, [catId]: (p[catId] || []).map((i) => i.id === itemId ? { ...i, sub_section: newSection } : i) }));
    await supabase.from("checklists").update({ sub_section: newSection }).eq("id", itemId);
  };

  const handleSectionDrop = (e, catId, label, toIdx) => {
    e.stopPropagation();
    if (dragInfo.current?.type === "section" && dragInfo.current?.catId === catId) reorderSections(catId, dragInfo.current.label, toIdx);
    else if (dragInfo.current?.type === "item" && dragInfo.current?.catId === catId) assignItemToSection(catId, dragInfo.current.itemId, label);
    dragInfo.current = null; setDragOver(null);
  };

  const handleItemDragStart = (e, catId, itemId) => {
    e.stopPropagation();
    dragInfo.current = { type: "item", catId, itemId };
    e.dataTransfer.effectAllowed = "move";
  };

  const handleItemDragOver = (e, catId, targetItemId) => {
    if (dragInfo.current?.type !== "item" || dragInfo.current?.catId !== catId) return;
    e.preventDefault(); e.stopPropagation();
    setDragOver(`item:${targetItemId}`);
  };

  const handleItemDrop = (e, catId, targetItemId, targetSection) => {
    e.stopPropagation();
    if (dragInfo.current?.type !== "item" || dragInfo.current?.catId !== catId) return;
    moveItemBefore(catId, dragInfo.current.itemId, targetItemId, targetSection);
    dragInfo.current = null; setDragOver(null);
  };

  const moveItemBefore = async (catId, draggedId, targetId, targetSection) => {
    if (draggedId === targetId) return;
    const arr = [...(items[catId] || [])];
    const fromIdx = arr.findIndex((i) => i.id === draggedId);
    if (fromIdx === -1) return;
    const [moved] = arr.splice(fromIdx, 1);
    const toIdx = arr.findIndex((i) => i.id === targetId);
    arr.splice(toIdx, 0, { ...moved, sub_section: targetSection || null });
    const reordered = arr.map((item, idx) => ({ ...item, sort_order: idx }));
    setItems((p) => ({ ...p, [catId]: reordered }));
    await Promise.all(reordered.map((item) =>
      supabase.from("checklists").update({ sort_order: item.sort_order, sub_section: item.sub_section || null }).eq("id", item.id)
    ));
  };

  const moveItemByStep = async (catId, itemId, direction) => {
    const arr = [...(items[catId] || [])];
    const idx = arr.findIndex((i) => i.id === itemId);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
    const reordered = arr.map((item, i) => ({ ...item, sort_order: i }));
    setItems((p) => ({ ...p, [catId]: reordered }));
    await Promise.all(reordered.map((item) =>
      supabase.from("checklists").update({ sort_order: item.sort_order }).eq("id", item.id)
    ));
  };

  if (loading) return <p style={{ color: "var(--c-text-2)" }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <p style={{ color: "var(--c-text-2)", fontSize: "13px", margin: 0 }}>
          {canEdit ? "Manage checklist categories, sections, and items for this project." : "View checklist items for this project. Only project managers can edit."}
        </p>
        {canEdit && (
          <button onClick={() => setAddingCat(true)} style={{ padding: "7px 14px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "7px", cursor: "pointer", fontSize: "13px", fontWeight: "600", fontFamily: "Manrope, sans-serif", flexShrink: 0 }}>
            + Add Checklist
          </button>
        )}
      </div>

      {addingCat && (
        <div style={{ background: "var(--c-bg)", border: "1px solid #0095da", borderRadius: "10px", padding: "14px 16px", marginBottom: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
          <input autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCustomCategory(); if (e.key === "Escape") { setAddingCat(false); setNewCatName(""); } }}
            placeholder="Checklist name (e.g. MEP Coordination)"
            style={{ flex: 1, padding: "8px 12px", background: "var(--c-surface)", border: "1px solid #0095da", borderRadius: "7px", color: "var(--c-text)", fontSize: "14px" }}
          />
          <button onClick={addCustomCategory} disabled={savingCat || !newCatName.trim()} style={{ padding: "8px 16px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "7px", cursor: savingCat ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: "600" }}>
            {savingCat ? "..." : "Create"}
          </button>
          <button onClick={() => { setAddingCat(false); setNewCatName(""); }} style={{ padding: "8px 12px", background: "transparent", border: "1px solid #334155", color: "var(--c-text-2)", borderRadius: "7px", cursor: "pointer", fontSize: "13px" }}>x</button>
        </div>
      )}

      <div style={{ display: "grid", gap: "8px" }}>
        {allCats.map((cat) => {
          const enabled = config[cat.id]?.enabled !== false;
          const isExpanded = expandedCat === cat.id;
          const catItems = items[cat.id] || [];
          const catSections = sections[cat.id] || [];
          const isRenamingThis = renamingCat === cat.id;
          return (
            <div key={cat.id} style={{ background: "var(--c-bg)", borderRadius: "10px", border: `1px solid ${isExpanded ? "var(--c-accent)" : enabled ? "var(--c-border)" : "var(--c-surface)"}`, overflow: "hidden", opacity: enabled ? 1 : 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px" }}>
                {canEdit && (
                  <button onClick={() => toggle(cat.id)} style={{ padding: "3px 10px", borderRadius: "20px", border: "1px solid", fontSize: "10px", fontWeight: "700", cursor: "pointer", flexShrink: 0, background: enabled ? "var(--c-ok-bg)" : "var(--c-surface)", borderColor: enabled ? "var(--c-ok)" : "var(--c-border)", color: enabled ? "var(--c-ok-text)" : "var(--c-text-3)" }}>
                    {enabled ? "ON" : "OFF"}
                  </button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isRenamingThis ? (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input autoFocus value={renameCatText} onChange={(e) => setRenameCatText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRename(cat.id); if (e.key === "Escape") setRenamingCat(null); }}
                        style={{ flex: 1, padding: "5px 8px", background: "var(--c-surface)", border: "1px solid #0095da", borderRadius: "6px", color: "var(--c-text)", fontSize: "13px" }}
                      />
                      <button onClick={() => saveRename(cat.id)} style={{ padding: "4px 10px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>Save</button>
                      <button onClick={() => setRenamingCat(null)} style={{ padding: "4px 8px", background: "transparent", border: "1px solid #334155", color: "var(--c-text-2)", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}>x</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ color: "var(--c-text)", fontSize: "14px", fontWeight: "600" }}>{getLabel(cat)}</span>
                      {cat.isCustom && <span style={{ fontSize: "10px", color: "var(--c-accent)", background: "var(--c-accent-dk)", padding: "1px 7px", borderRadius: "20px", fontWeight: "600" }}>custom</span>}
                      <span style={{ color: "var(--c-text-3)", fontSize: "11px" }}>{catItems.length} items</span>
                    </div>
                  )}
                </div>
                {canEdit && !isRenamingThis && (
                  <div style={{ display: "flex", gap: "5px", flexShrink: 0, alignItems: "center" }}>
                    {canEdit && milestones.length > 0 && (
                      <div style={{ display: "flex", gap: "3px", alignItems: "center", flexWrap: "wrap" }}>
                        {milestones.map((m) => {
                          const allItemIds = catItems.map((i) => i.id);
                          const isActive = allItemIds.length > 0 && allItemIds.every((id) => itemMilestones[id]?.has(m.id));
                          return (
                            <button key={m.id} onClick={(e) => { e.stopPropagation(); bulkToggleMilestone(allItemIds, m.id, !isActive); }}
                              style={{ padding: "2px 8px", border: `1px solid ${isActive ? "var(--c-accent)" : "var(--c-border)"}`, borderRadius: "20px", fontSize: "10px", fontWeight: "600", cursor: "pointer", background: isActive ? "var(--c-accent-dk)" : "transparent", color: isActive ? "var(--c-accent-lt)" : "var(--c-text-4)", whiteSpace: "nowrap" }}>
                              {m.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button onClick={() => { setRenamingCat(cat.id); setRenameCatText(getLabel(cat)); }} style={mBtn()}>Rename</button>
                    {cat.isCustom && <button onClick={() => deleteCustomCat(cat.id)} style={mBtn({ color: "var(--c-err)" })}>x</button>}
                    {milestones.length > 0 && (() => {
                      const isOpen = daysPopover?.type === "cat" && daysPopover?.catId === cat.id;
                      const hasAny = catItems.some((i) => Object.keys(itemMilestoneDays[i.id] || {}).length > 0);
                      if (isOpen) return (
                        <div style={{ position: "relative" }}>
                          <div style={{ position: "absolute", right: 0, top: "100%", marginTop: "4px", zIndex: 20, background: "var(--c-bg)", border: "1px solid var(--c-accent)", borderRadius: "10px", padding: "12px 14px", minWidth: "220px", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }} onClick={(e) => e.stopPropagation()}>
                            <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-2)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Days before milestone — all items</div>
                            {milestones.map((m) => (
                              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px" }}>
                                <span style={{ flex: 1, fontSize: "12px", color: "var(--c-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                                <input type="number" min="0" placeholder="—" value={daysPopover.msInputs[m.id] ?? ""}
                                  onChange={(e) => setDaysPopover((p) => ({ ...p, msInputs: { ...p.msInputs, [m.id]: e.target.value } }))}
                                  onKeyDown={(e) => { if (e.key === "Enter") applyDaysPopover(); if (e.key === "Escape") setDaysPopover(null); }}
                                  style={{ width: "52px", padding: "4px 6px", background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "5px", color: "var(--c-text)", fontSize: "12px", textAlign: "center" }}
                                />
                                <span style={{ fontSize: "11px", color: "var(--c-text-4)" }}>d</span>
                              </div>
                            ))}
                            <div style={{ display: "flex", gap: "6px", marginTop: "10px", justifyContent: "flex-end" }}>
                              <button onClick={() => setDaysPopover(null)} style={{ padding: "4px 10px", background: "transparent", border: "1px solid #334155", color: "var(--c-text-3)", borderRadius: "5px", cursor: "pointer", fontSize: "11px" }}>Cancel</button>
                              <button onClick={applyDaysPopover} style={{ padding: "4px 12px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "11px", fontWeight: "600" }}>Apply to all</button>
                            </div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); openDaysPopover("cat", cat.id); }}
                            style={{ padding: "2px 7px", border: `1px solid var(--c-accent)`, borderRadius: "20px", fontSize: "10px", fontWeight: "600", cursor: "pointer", background: "var(--c-accent-dk)", color: "var(--c-accent-lt)", whiteSpace: "nowrap" }}>
                            📅 days
                          </button>
                        </div>
                      );
                      return (
                        <button onClick={(e) => { e.stopPropagation(); openDaysPopover("cat", cat.id); }}
                          style={{ padding: "2px 7px", border: `1px solid ${hasAny ? "var(--c-accent)" : "var(--c-border)"}`, borderRadius: "20px", fontSize: "10px", fontWeight: "600", cursor: "pointer", background: hasAny ? "var(--c-accent-dk)" : "transparent", color: hasAny ? "var(--c-accent-lt)" : "var(--c-text-4)", whiteSpace: "nowrap" }}>
                          📅 days
                        </button>
                      );
                    })()}
                  </div>
                )}
                <button onClick={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)} style={{ background: "none", border: "none", color: isExpanded ? "var(--c-accent)" : "var(--c-text-3)", cursor: "pointer", padding: "4px 6px", fontSize: "13px", flexShrink: 0 }}>
                  {isExpanded ? "^" : "v"}
                </button>
              </div>

              {isExpanded && (
                <div style={{ borderTop: "1px solid #1e293b", padding: "12px 16px" }}>
                  {catSections.map((sLabel, sIdx) => {
                    const sectionItems = catItems.filter((i) => i.sub_section === sLabel);
                    const isSectionDT = dragOver === `sh:${cat.id}:${sLabel}`;
                    const isOrderT = dragOver === `so:${cat.id}:${sIdx}`;
                    const isBD = dragInfo.current?.type === "section" && dragInfo.current?.label === sLabel;
                    const isRenSec = renamingSection?.catId === cat.id && renamingSection?.label === sLabel;
                    return (
                      <div key={sLabel} style={{ marginBottom: "10px", opacity: isBD ? 0.35 : 1 }}>
                        <div draggable={canEdit && !isRenSec}
                          onDragStart={(e) => handleSectionDragStart(e, cat.id, sLabel, sIdx)}
                          onDragOver={(e) => handleSectionDragOver(e, cat.id, sLabel, sIdx)}
                          onDrop={(e) => handleSectionDrop(e, cat.id, sLabel, sIdx)}
                          onDragEnd={handleDragEnd}
                          style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px 6px 8px", background: isSectionDT ? "var(--c-accent-dk)" : isOrderT ? "var(--c-surface-alt)" : "var(--c-surface-alt)", borderLeft: `3px solid ${isSectionDT ? "var(--c-warn)" : "var(--c-accent)"}`, borderRadius: "0 6px 6px 0", marginBottom: "4px", cursor: canEdit && !isRenSec ? "grab" : "default", transition: "background 0.12s" }}
                        >
                          {canEdit && <span style={{ color: "var(--c-text-4)", fontSize: "14px", userSelect: "none", flexShrink: 0 }}>:</span>}
                          {isRenSec ? (
                            <div style={{ display: "flex", gap: "6px", flex: 1, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                              <input autoFocus value={renameSectionText} onChange={(e) => setRenameSectionText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") renameSection(cat.id, sLabel); if (e.key === "Escape") setRenamingSection(null); }}
                                style={{ flex: 1, padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #0095da", borderRadius: "4px", color: "var(--c-text)", fontSize: "12px" }}
                              />
                              <button onClick={() => renameSection(cat.id, sLabel)} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none" })}>Save</button>
                              <button onClick={() => setRenamingSection(null)} style={mBtn()}>x</button>
                            </div>
                          ) : (
                            <>
                              <span style={{ flex: 1, color: "var(--c-accent-lt)", fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.07em" }}>{sLabel}</span>
                              {isSectionDT && <span style={{ color: "var(--c-warn)", fontSize: "10px", flexShrink: 0 }}>drop to assign</span>}
                              {canEdit && milestones.length > 0 && (() => {
                                const secItemIds = catItems.filter((i) => i.sub_section === sLabel).map((i) => i.id);
                                return (
                                  <div style={{ display: "flex", gap: "3px", alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
                                    {milestones.map((m) => {
                                      const isActive = secItemIds.length > 0 && secItemIds.every((id) => itemMilestones[id]?.has(m.id));
                                      return (
                                        <button key={m.id} onClick={(e) => { e.stopPropagation(); bulkToggleMilestone(secItemIds, m.id, !isActive); }}
                                          style={{ padding: "2px 7px", border: `1px solid ${isActive ? "var(--c-accent)" : "var(--c-border)"}`, borderRadius: "20px", fontSize: "10px", fontWeight: "600", cursor: "pointer", background: isActive ? "var(--c-accent-dk)" : "transparent", color: isActive ? "var(--c-accent-lt)" : "var(--c-text-4)", whiteSpace: "nowrap" }}>
                                          {m.name}
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                              {canEdit && (
                                <div style={{ display: "flex", gap: "3px", flexShrink: 0, alignItems: "center" }}>
                                  {milestones.length > 0 && (() => {
                                    const secItems = catItems.filter((i) => i.sub_section === sLabel);
                                    const isOpen = daysPopover?.type === "section" && daysPopover?.catId === cat.id && daysPopover?.sectionLabel === sLabel;
                                    const hasAny = secItems.some((i) => Object.keys(itemMilestoneDays[i.id] || {}).length > 0);
                                    if (isOpen) return (
                                      <div style={{ position: "relative" }}>
                                        <div style={{ position: "absolute", right: 0, top: "100%", marginTop: "4px", zIndex: 20, background: "var(--c-bg)", border: "1px solid var(--c-accent)", borderRadius: "10px", padding: "12px 14px", minWidth: "220px", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }} onClick={(e) => e.stopPropagation()}>
                                          <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-2)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Days before milestone — "{sLabel}"</div>
                                          {milestones.map((m) => (
                                            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px" }}>
                                              <span style={{ flex: 1, fontSize: "12px", color: "var(--c-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                                              <input type="number" min="0" placeholder="—" value={daysPopover.msInputs[m.id] ?? ""}
                                                onChange={(e) => setDaysPopover((p) => ({ ...p, msInputs: { ...p.msInputs, [m.id]: e.target.value } }))}
                                                onKeyDown={(e) => { if (e.key === "Enter") applyDaysPopover(); if (e.key === "Escape") setDaysPopover(null); }}
                                                style={{ width: "52px", padding: "4px 6px", background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "5px", color: "var(--c-text)", fontSize: "12px", textAlign: "center" }}
                                              />
                                              <span style={{ fontSize: "11px", color: "var(--c-text-4)" }}>d</span>
                                            </div>
                                          ))}
                                          <div style={{ display: "flex", gap: "6px", marginTop: "10px", justifyContent: "flex-end" }}>
                                            <button onClick={() => setDaysPopover(null)} style={{ padding: "4px 10px", background: "transparent", border: "1px solid #334155", color: "var(--c-text-3)", borderRadius: "5px", cursor: "pointer", fontSize: "11px" }}>Cancel</button>
                                            <button onClick={applyDaysPopover} style={{ padding: "4px 12px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "11px", fontWeight: "600" }}>Apply to section</button>
                                          </div>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); openDaysPopover("section", cat.id, sLabel); }}
                                          style={{ padding: "2px 7px", border: "1px solid var(--c-accent)", borderRadius: "20px", fontSize: "10px", fontWeight: "600", cursor: "pointer", background: "var(--c-accent-dk)", color: "var(--c-accent-lt)", whiteSpace: "nowrap" }}>
                                          📅 days
                                        </button>
                                      </div>
                                    );
                                    return (
                                      <button onClick={(e) => { e.stopPropagation(); openDaysPopover("section", cat.id, sLabel); }}
                                        style={{ padding: "2px 7px", border: `1px solid ${hasAny ? "var(--c-accent)" : "var(--c-border)"}`, borderRadius: "20px", fontSize: "10px", fontWeight: "600", cursor: "pointer", background: hasAny ? "var(--c-accent-dk)" : "transparent", color: hasAny ? "var(--c-accent-lt)" : "var(--c-text-4)", whiteSpace: "nowrap" }}>
                                        📅 days
                                      </button>
                                    );
                                  })()}
                                  <button onClick={() => { setRenamingSection({ catId: cat.id, label: sLabel }); setRenameSectionText(sLabel); }} style={mBtn()}>Rename</button>
                                  <button onClick={() => deleteSection(cat.id, sLabel)} style={mBtn({ color: "var(--c-err)" })}>x</button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <div style={{ display: "grid", gap: "3px", marginLeft: "12px" }}>
                          {sectionItems.map((item, itemIdx) => {
                            const isDO = dragOver === `item:${item.id}`;
                            const isBDi = dragInfo.current?.type === "item" && dragInfo.current?.itemId === item.id;
                            return (
                              <div key={item.id} draggable={canEdit && !isMobile && editingItemId !== item.id}
                                onDragStart={(e) => handleItemDragStart(e, cat.id, item.id)}
                                onDragOver={(e) => handleItemDragOver(e, cat.id, item.id)}
                                onDrop={(e) => handleItemDrop(e, cat.id, item.id, item.sub_section)}
                                onDragEnd={handleDragEnd}
                                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", borderRadius: "0 6px 6px 0", borderLeft: `2px solid ${isDO ? "var(--c-accent)" : "var(--c-accent-2)"}`, background: isDO ? "var(--c-accent-dk)" : "var(--c-surface-item)", opacity: isBDi ? 0.3 : 1, transition: "background 0.1s" }}
                              >
                                {canEdit && !isMobile && <span style={{ color: "var(--c-text-4)", fontSize: "13px", cursor: "grab", userSelect: "none", flexShrink: 0 }}>⠿</span>}
                                {canEdit && isMobile && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "1px", flexShrink: 0 }}>
                                    <button onClick={() => moveItemByStep(cat.id, item.id, -1)} disabled={itemIdx === 0}
                                      style={{ padding: "1px 5px", fontSize: "10px", background: "none", border: "1px solid var(--c-border)", borderRadius: "3px", color: "var(--c-text-3)", cursor: "pointer", lineHeight: 1 }}>▲</button>
                                    <button onClick={() => moveItemByStep(cat.id, item.id, 1)} disabled={itemIdx === sectionItems.length - 1}
                                      style={{ padding: "1px 5px", fontSize: "10px", background: "none", border: "1px solid var(--c-border)", borderRadius: "3px", color: "var(--c-text-3)", cursor: "pointer", lineHeight: 1 }}>▼</button>
                                  </div>
                                )}
                                {editingItemId === item.id ? (
                                  <input autoFocus value={editItemText} onChange={(e) => setEditItemText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") saveItemEdit(item); if (e.key === "Escape") setEditingItemId(null); }}
                                    style={{ flex: 1, padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #0095da", borderRadius: "4px", color: "var(--c-text)", fontSize: "13px" }}
                                  />
                                ) : (
                                  <span style={{ flex: 1, color: "var(--c-text-4)", fontSize: "13px", lineHeight: 1.4 }}>
                                    {refCodes[item.id] && <span style={{ marginRight: "6px", fontSize: "9px", fontWeight: "700", color: "var(--c-text-4)", fontFamily: "monospace", letterSpacing: "0.04em" }}>{refCodes[item.id]}</span>}
                                    {item.item_text}
                                    {item.edited_by_pm && <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--c-warn)", background: "var(--c-warn-bg)", padding: "1px 5px", borderRadius: "3px" }}>edited</span>}
                                    {item.is_custom && <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--c-purple)", background: "var(--c-purple-bg)", padding: "1px 5px", borderRadius: "3px" }}>custom</span>}
                                  </span>
                                )}
                                {milestones.length > 0 && (
                                  <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "3px", flexWrap: "wrap" }}>
                                    {milestones.map((m) => {
                                      const isActive = itemMilestones[item.id]?.has(m.id) ?? false;
                                      const days = itemMilestoneDays[item.id]?.[m.id];
                                      const isEditingD = editingDays?.itemId === item.id && editingDays?.milestoneId === m.id;
                                      return (
                                        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                                          <button onClick={(e) => { e.stopPropagation(); if (canEdit) toggleItemMilestone(item.id, m.id, !isActive); }}
                                            disabled={!canEdit}
                                            style={{ padding: "1px 6px", border: `1px solid ${isActive ? "var(--c-accent)" : "var(--c-border)"}`, borderRadius: isActive ? "20px 0 0 20px" : "20px", fontSize: "9px", fontWeight: "600", cursor: canEdit ? "pointer" : "default", background: isActive ? "var(--c-accent-dk)" : "transparent", color: isActive ? "var(--c-accent-lt)" : "var(--c-text-4)", whiteSpace: "nowrap" }}>
                                            {m.name}
                                          </button>
                                          {isActive && canEdit && (isEditingD ? (
                                            <div style={{ display: "flex", alignItems: "center", background: "var(--c-accent-dk)", border: "1px solid var(--c-accent)", borderLeft: "none", borderRadius: "0 20px 20px 0", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
                                              <input autoFocus type="number" min="0" value={editingDays.val}
                                                onChange={(e) => setEditingDays((p) => ({ ...p, val: e.target.value }))}
                                                onKeyDown={async (e) => { if (e.key === "Enter") { await saveMilestoneDays([item.id], m.id, editingDays.val); setEditingDays(null); } if (e.key === "Escape") setEditingDays(null); }}
                                                onBlur={async () => { await saveMilestoneDays([item.id], m.id, editingDays.val); setEditingDays(null); }}
                                                style={{ width: "36px", padding: "1px 4px", background: "transparent", border: "none", color: "var(--c-accent-lt)", fontSize: "9px", outline: "none", textAlign: "center" }}
                                              />
                                              <span style={{ fontSize: "9px", color: "var(--c-accent-lt)", paddingRight: "5px" }}>d</span>
                                            </div>
                                          ) : (
                                            <button onClick={(e) => { e.stopPropagation(); setEditingDays({ itemId: item.id, milestoneId: m.id, val: days != null ? String(days) : "" }); }}
                                              style={{ padding: "1px 6px", border: "1px solid var(--c-accent)", borderLeft: "none", borderRadius: "0 20px 20px 0", fontSize: "9px", fontWeight: "600", cursor: "pointer", background: "var(--c-accent-dk)", color: days != null ? "var(--c-accent-lt)" : "var(--c-text-4)", whiteSpace: "nowrap" }}>
                                              {days != null ? `${days}d` : "+d"}
                                            </button>
                                          ))}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                {canEdit && (() => {
                                  const deps = [...(itemDeps[item.id] || new Set())];
                                  const isPickerOpen = depsPickerItemId === item.id;
                                  const allItems = Object.values(items).flat();
                                  const filtered = allItems.filter((i) => i.id !== item.id && (!depsPickerSearch || i.item_text.toLowerCase().includes(depsPickerSearch.toLowerCase()) || refCodes[i.id]?.toLowerCase().includes(depsPickerSearch.toLowerCase())));
                                  return (
                                    <div style={{ display: "flex", gap: "4px", flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
                                      {deps.map((depId) => {
                                        const depItem = allItems.find((i) => i.id === depId);
                                        if (!depItem) return null;
                                        return (
                                          <span key={depId} title={depItem.item_text}
                                            style={{ fontSize: "9px", fontWeight: "600", color: "var(--c-purple)", background: "var(--c-purple-bg)", border: "1px solid var(--c-purple)", borderRadius: "20px", padding: "1px 6px", whiteSpace: "nowrap" }}>
                                            ⛓ {refCodes[depId] || depItem.item_text.slice(0, 12)}
                                          </span>
                                        );
                                      })}
                                      <div style={{ position: "relative" }}>
                                        <button onClick={(e) => { e.stopPropagation(); setDepsPickerItemId(isPickerOpen ? null : item.id); setDepsPickerSearch(""); }}
                                          title="Set dependencies"
                                          style={{ ...mBtn(), color: deps.length > 0 ? "var(--c-purple)" : "var(--c-text-4)", borderColor: deps.length > 0 ? "var(--c-purple)" : "#334155" }}>
                                          ⛓
                                        </button>
                                        {isPickerOpen && (
                                          <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30, background: "var(--c-bg)", border: "1px solid var(--c-accent)", borderRadius: "10px", padding: "10px", minWidth: "260px", maxHeight: "280px", overflowY: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }} onClick={(e) => e.stopPropagation()}>
                                            <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-2)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Depends on (must complete first)</div>
                                            <input autoFocus placeholder="Search items…" value={depsPickerSearch} onChange={(e) => setDepsPickerSearch(e.target.value)}
                                              style={{ width: "100%", padding: "5px 8px", background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "5px", color: "var(--c-text)", fontSize: "12px", marginBottom: "6px", boxSizing: "border-box" }}
                                            />
                                            {filtered.length === 0 && <div style={{ fontSize: "11px", color: "var(--c-text-4)", textAlign: "center", padding: "8px 0" }}>No items found</div>}
                                            {filtered.map((i) => {
                                              const checked = itemDeps[item.id]?.has(i.id) ?? false;
                                              const circular = !checked && wouldCreateCycle(item.id, i.id, itemDeps);
                                              return (
                                                <label key={i.id} style={{ display: "flex", alignItems: "flex-start", gap: "7px", padding: "4px 2px", cursor: circular ? "not-allowed" : "pointer", opacity: circular ? 0.4 : 1 }}>
                                                  <input type="checkbox" checked={checked} disabled={circular}
                                                    onChange={() => toggleDep(item.id, i.id, !checked)}
                                                    style={{ marginTop: "2px", flexShrink: 0 }}
                                                  />
                                                  <span style={{ fontSize: "11px", color: "var(--c-text-3)", lineHeight: 1.4 }}>
                                                    {refCodes[i.id] && <span style={{ fontFamily: "monospace", fontSize: "9px", color: "var(--c-text-4)", marginRight: "4px" }}>{refCodes[i.id]}</span>}
                                                    {i.item_text}
                                                    {circular && <span style={{ marginLeft: "4px", fontSize: "9px", color: "var(--c-err)" }}>↻ circular</span>}
                                                  </span>
                                                </label>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })()}
                                {canEdit && (
                                  <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                                    {editingItemId === item.id
                                      ? <><button onClick={() => saveItemEdit(item)} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none" })}>Save</button><button onClick={() => setEditingItemId(null)} style={mBtn()}>x</button></>
                                      : <><button onClick={() => { setEditingItemId(item.id); setEditItemText(item.item_text); }} style={mBtn()}>Edit</button><button onClick={() => removeItem(item)} style={mBtn({ color: "var(--c-err)" })}>x</button></>
                                    }
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {canEdit && (addingTo?.catId === cat.id && addingTo?.section === sLabel ? (
                          <div style={{ display: "flex", gap: "6px", marginTop: "4px", marginLeft: "12px" }}>
                            <input autoFocus value={newItemText} onChange={(e) => setNewItemText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") addItem(cat.id, sLabel); if (e.key === "Escape") { setAddingTo(null); setNewItemText(""); } }}
                              placeholder="New item text..." style={{ flex: 1, padding: "6px 9px", background: "var(--c-surface)", border: "1px solid #0095da", borderRadius: "5px", color: "var(--c-text)", fontSize: "13px" }}
                            />
                            <button onClick={() => addItem(cat.id, sLabel)} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none", padding: "6px 12px" })}>Add</button>
                            <button onClick={() => { setAddingTo(null); setNewItemText(""); }} style={mBtn({ padding: "6px 9px" })}>x</button>
                          </div>
                        ) : (
                          <button onClick={() => setAddingTo({ catId: cat.id, section: sLabel })}
                            style={{ display: "block", width: "calc(100% - 12px)", marginLeft: "12px", marginTop: "4px", padding: "5px", background: "transparent", border: "1px dashed #29439b", borderRadius: "5px", color: "var(--c-text-4)", fontSize: "11px", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-accent)"; e.currentTarget.style.color = "var(--c-accent-lt)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-accent-2)"; e.currentTarget.style.color = "var(--c-text-4)"; }}
                          >+ Add Item to "{sLabel}"</button>
                        ))}
                      </div>
                    );
                  })}

                  {(() => {
                    const noSection = catItems.filter((i) => !i.sub_section);
                    return (
                      <>
                        {noSection.length > 0 && (
                          <div style={{ marginTop: catSections.length > 0 ? "10px" : 0 }}>
                            {catSections.length > 0 && (
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                                <div style={{ flex: 1, height: "1px", background: "#2d3f55" }} />
                                <span style={{ color: "var(--c-text-4)", fontSize: "10px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>No Section</span>
                                <div style={{ flex: 1, height: "1px", background: "#2d3f55" }} />
                              </div>
                            )}
                            <div style={{ display: "grid", gap: "3px" }}>
                              {noSection.map((item, itemIdx) => {
                                const isDO = dragOver === `item:${item.id}`;
                                const isBDi = dragInfo.current?.type === "item" && dragInfo.current?.itemId === item.id;
                                return (
                                  <div key={item.id} draggable={canEdit && !isMobile && editingItemId !== item.id}
                                    onDragStart={(e) => handleItemDragStart(e, cat.id, item.id)}
                                    onDragOver={(e) => handleItemDragOver(e, cat.id, item.id)}
                                    onDrop={(e) => handleItemDrop(e, cat.id, item.id, null)}
                                    onDragEnd={handleDragEnd}
                                    style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", borderRadius: "6px", borderLeft: `2px dashed ${isDO ? "var(--c-accent)" : "var(--c-border)"}`, background: isDO ? "var(--c-accent-dk)" : "var(--c-surface)", opacity: isBDi ? 0.3 : 1, transition: "background 0.1s" }}
                                  >
                                    {canEdit && !isMobile && <span style={{ color: "var(--c-text-4)", fontSize: "13px", cursor: "grab", userSelect: "none", flexShrink: 0 }}>⠿</span>}
                                    {canEdit && isMobile && (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "1px", flexShrink: 0 }}>
                                        <button onClick={() => moveItemByStep(cat.id, item.id, -1)} disabled={itemIdx === 0}
                                          style={{ padding: "1px 5px", fontSize: "10px", background: "none", border: "1px solid var(--c-border)", borderRadius: "3px", color: "var(--c-text-3)", cursor: "pointer", lineHeight: 1 }}>▲</button>
                                        <button onClick={() => moveItemByStep(cat.id, item.id, 1)} disabled={itemIdx === noSection.length - 1}
                                          style={{ padding: "1px 5px", fontSize: "10px", background: "none", border: "1px solid var(--c-border)", borderRadius: "3px", color: "var(--c-text-3)", cursor: "pointer", lineHeight: 1 }}>▼</button>
                                      </div>
                                    )}
                                    {editingItemId === item.id ? (
                                      <input autoFocus value={editItemText} onChange={(e) => setEditItemText(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") saveItemEdit(item); if (e.key === "Escape") setEditingItemId(null); }}
                                        style={{ flex: 1, padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #0095da", borderRadius: "4px", color: "var(--c-text)", fontSize: "13px" }}
                                      />
                                    ) : (
                                      <span style={{ flex: 1, color: "var(--c-text-2)", fontSize: "13px", lineHeight: 1.4 }}>
                                        {refCodes[item.id] && <span style={{ marginRight: "6px", fontSize: "9px", fontWeight: "700", color: "var(--c-text-4)", fontFamily: "monospace", letterSpacing: "0.04em" }}>{refCodes[item.id]}</span>}
                                        {item.item_text}
                                        {item.edited_by_pm && <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--c-warn)", background: "var(--c-warn-bg)", padding: "1px 5px", borderRadius: "3px" }}>edited</span>}
                                        {item.is_custom && <span style={{ marginLeft: "6px", fontSize: "10px", color: "var(--c-purple)", background: "var(--c-purple-bg)", padding: "1px 5px", borderRadius: "3px" }}>custom</span>}
                                      </span>
                                    )}
                                    {milestones.length > 0 && (
                                      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "3px", flexWrap: "wrap" }}>
                                        {milestones.map((m) => {
                                          const isActive = itemMilestones[item.id]?.has(m.id) ?? false;
                                          const days = itemMilestoneDays[item.id]?.[m.id];
                                          const isEditingD = editingDays?.itemId === item.id && editingDays?.milestoneId === m.id;
                                          return (
                                            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "1px" }}>
                                              <button onClick={(e) => { e.stopPropagation(); if (canEdit) toggleItemMilestone(item.id, m.id, !isActive); }}
                                                disabled={!canEdit}
                                                style={{ padding: "1px 6px", border: `1px solid ${isActive ? "var(--c-accent)" : "var(--c-border)"}`, borderRadius: isActive ? "20px 0 0 20px" : "20px", fontSize: "9px", fontWeight: "600", cursor: canEdit ? "pointer" : "default", background: isActive ? "var(--c-accent-dk)" : "transparent", color: isActive ? "var(--c-accent-lt)" : "var(--c-text-4)", whiteSpace: "nowrap" }}>
                                                {m.name}
                                              </button>
                                              {isActive && canEdit && (isEditingD ? (
                                                <div style={{ display: "flex", alignItems: "center", background: "var(--c-accent-dk)", border: "1px solid var(--c-accent)", borderLeft: "none", borderRadius: "0 20px 20px 0", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
                                                  <input autoFocus type="number" min="0" value={editingDays.val}
                                                    onChange={(e) => setEditingDays((p) => ({ ...p, val: e.target.value }))}
                                                    onKeyDown={async (e) => { if (e.key === "Enter") { await saveMilestoneDays([item.id], m.id, editingDays.val); setEditingDays(null); } if (e.key === "Escape") setEditingDays(null); }}
                                                    onBlur={async () => { await saveMilestoneDays([item.id], m.id, editingDays.val); setEditingDays(null); }}
                                                    style={{ width: "36px", padding: "1px 4px", background: "transparent", border: "none", color: "var(--c-accent-lt)", fontSize: "9px", outline: "none", textAlign: "center" }}
                                                  />
                                                  <span style={{ fontSize: "9px", color: "var(--c-accent-lt)", paddingRight: "5px" }}>d</span>
                                                </div>
                                              ) : (
                                                <button onClick={(e) => { e.stopPropagation(); setEditingDays({ itemId: item.id, milestoneId: m.id, val: days != null ? String(days) : "" }); }}
                                                  style={{ padding: "1px 6px", border: "1px solid var(--c-accent)", borderLeft: "none", borderRadius: "0 20px 20px 0", fontSize: "9px", fontWeight: "600", cursor: "pointer", background: "var(--c-accent-dk)", color: days != null ? "var(--c-accent-lt)" : "var(--c-text-4)", whiteSpace: "nowrap" }}>
                                                  {days != null ? `${days}d` : "+d"}
                                                </button>
                                              ))}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {canEdit && (() => {
                                      const deps = [...(itemDeps[item.id] || new Set())];
                                      const isPickerOpen = depsPickerItemId === item.id;
                                      const allItems = Object.values(items).flat();
                                      const filtered = allItems.filter((i) => i.id !== item.id && (!depsPickerSearch || i.item_text.toLowerCase().includes(depsPickerSearch.toLowerCase()) || refCodes[i.id]?.toLowerCase().includes(depsPickerSearch.toLowerCase())));
                                      return (
                                        <div style={{ display: "flex", gap: "4px", flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
                                          {deps.map((depId) => {
                                            const depItem = allItems.find((i) => i.id === depId);
                                            if (!depItem) return null;
                                            return (
                                              <span key={depId} title={depItem.item_text}
                                                style={{ fontSize: "9px", fontWeight: "600", color: "var(--c-purple)", background: "var(--c-purple-bg)", border: "1px solid var(--c-purple)", borderRadius: "20px", padding: "1px 6px", whiteSpace: "nowrap" }}>
                                                ⛓ {refCodes[depId] || depItem.item_text.slice(0, 12)}
                                              </span>
                                            );
                                          })}
                                          <div style={{ position: "relative" }}>
                                            <button onClick={(e) => { e.stopPropagation(); setDepsPickerItemId(isPickerOpen ? null : item.id); setDepsPickerSearch(""); }}
                                              title="Set dependencies"
                                              style={{ ...mBtn(), color: deps.length > 0 ? "var(--c-purple)" : "var(--c-text-4)", borderColor: deps.length > 0 ? "var(--c-purple)" : "#334155" }}>
                                              ⛓
                                            </button>
                                            {isPickerOpen && (
                                              <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30, background: "var(--c-bg)", border: "1px solid var(--c-accent)", borderRadius: "10px", padding: "10px", minWidth: "260px", maxHeight: "280px", overflowY: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }} onClick={(e) => e.stopPropagation()}>
                                                <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-2)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Depends on (must complete first)</div>
                                                <input autoFocus placeholder="Search items…" value={depsPickerSearch} onChange={(e) => setDepsPickerSearch(e.target.value)}
                                                  style={{ width: "100%", padding: "5px 8px", background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "5px", color: "var(--c-text)", fontSize: "12px", marginBottom: "6px", boxSizing: "border-box" }}
                                                />
                                                {filtered.length === 0 && <div style={{ fontSize: "11px", color: "var(--c-text-4)", textAlign: "center", padding: "8px 0" }}>No items found</div>}
                                                {filtered.map((i) => {
                                                  const checked = itemDeps[item.id]?.has(i.id) ?? false;
                                                  const circular = !checked && wouldCreateCycle(item.id, i.id, itemDeps);
                                                  return (
                                                    <label key={i.id} style={{ display: "flex", alignItems: "flex-start", gap: "7px", padding: "4px 2px", cursor: circular ? "not-allowed" : "pointer", opacity: circular ? 0.4 : 1 }}>
                                                      <input type="checkbox" checked={checked} disabled={circular}
                                                        onChange={() => toggleDep(item.id, i.id, !checked)}
                                                        style={{ marginTop: "2px", flexShrink: 0 }}
                                                      />
                                                      <span style={{ fontSize: "11px", color: "var(--c-text-3)", lineHeight: 1.4 }}>
                                                        {refCodes[i.id] && <span style={{ fontFamily: "monospace", fontSize: "9px", color: "var(--c-text-4)", marginRight: "4px" }}>{refCodes[i.id]}</span>}
                                                        {i.item_text}
                                                        {circular && <span style={{ marginLeft: "4px", fontSize: "9px", color: "var(--c-err)" }}>↻ circular</span>}
                                                      </span>
                                                    </label>
                                                  );
                                                })}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                    {canEdit && (
                                      <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                                        {editingItemId === item.id
                                          ? <><button onClick={() => saveItemEdit(item)} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none" })}>Save</button><button onClick={() => setEditingItemId(null)} style={mBtn()}>x</button></>
                                          : <><button onClick={() => { setEditingItemId(item.id); setEditItemText(item.item_text); }} style={mBtn()}>Edit</button><button onClick={() => removeItem(item)} style={mBtn({ color: "var(--c-err)" })}>x</button></>
                                        }
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {canEdit && addingTo?.catId === cat.id && addingTo?.section === null && (
                          <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                            <input autoFocus value={newItemText} onChange={(e) => setNewItemText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") addItem(cat.id, null); if (e.key === "Escape") { setAddingTo(null); setNewItemText(""); } }}
                              placeholder="New item text..." style={{ flex: 1, padding: "6px 9px", background: "var(--c-surface)", border: "1px solid #0095da", borderRadius: "5px", color: "var(--c-text)", fontSize: "13px" }}
                            />
                            <button onClick={() => addItem(cat.id, null)} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none", padding: "6px 12px" })}>Add</button>
                            <button onClick={() => { setAddingTo(null); setNewItemText(""); }} style={mBtn({ padding: "6px 9px" })}>x</button>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {canEdit && addingTo?.catId !== cat.id && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                      <button onClick={() => setAddingTo({ catId: cat.id, section: null })}
                        style={{ flex: 1, padding: "6px 10px", background: "transparent", border: "1px dashed #334155", borderRadius: "6px", color: "var(--c-text-3)", fontSize: "12px", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-accent)"; e.currentTarget.style.color = "var(--c-accent-lt)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-border)"; e.currentTarget.style.color = "var(--c-text-3)"; }}>
                        {catSections.length > 0 ? "+ Add Item (No Section)" : "+ Add Item"}
                      </button>
                      {addingSection !== cat.id && (
                        <button onClick={() => { setAddingSection(cat.id); setNewSectionText(""); }}
                          style={{ padding: "6px 12px", background: "transparent", border: "1px dashed #0095da", borderRadius: "6px", color: "var(--c-accent)", fontSize: "12px", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-accent-dk)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                          + Add Section
                        </button>
                      )}
                    </div>
                  )}
                  {addingSection === cat.id && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center" }}>
                      <div style={{ width: "3px", background: "var(--c-accent)", borderRadius: "2px", alignSelf: "stretch", flexShrink: 0 }} />
                      <input autoFocus value={newSectionText} onChange={(e) => setNewSectionText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") addSection(cat.id); if (e.key === "Escape") setAddingSection(null); }}
                        placeholder="Section name..." style={{ flex: 1, padding: "6px 10px", background: "var(--c-surface-alt)", border: "1px solid #0095da", borderRadius: "5px", color: "var(--c-text)", fontSize: "13px" }}
                      />
                      <button onClick={() => addSection(cat.id)} disabled={!newSectionText.trim()} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none", padding: "6px 12px" })}>Create</button>
                      <button onClick={() => setAddingSection(null)} style={mBtn({ padding: "6px 9px" })}>x</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Milestones tab ─────────────────────────────────────────────────────────
function MilestonesTab({ project }) {
  const [milestones, setMilestones] = useState([]);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [daysAlert, setDaysAlert] = useState(7);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDaysAlert, setEditDaysAlert] = useState(7);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { loadMilestones(); }, []);

  const loadMilestones = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("project_milestones").select("*").eq("project_id", project.id).order("date");
    if (err) setError("Failed to load milestones: " + err.message);
    setMilestones(data || []);
    setLoading(false);
  };

  const add = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const { error: err } = await supabase.from("project_milestones").insert({
      project_id: project.id, name, date, days_before_alert: daysAlert,
    });
    if (err) { setError("Could not save milestone: " + err.message); }
    else { setName(""); setDate(""); setDaysAlert(7); loadMilestones(); }
    setSaving(false);
  };

  const startEdit = (m) => {
    setEditingId(m.id); setEditName(m.name); setEditDate(m.date); setEditDaysAlert(m.days_before_alert);
  };
  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id) => {
    setEditSaving(true);
    const { error: err } = await supabase.from("project_milestones")
      .update({ name: editName, date: editDate, days_before_alert: editDaysAlert }).eq("id", id);
    if (err) { setError("Could not update: " + err.message); }
    else { setEditingId(null); loadMilestones(); }
    setEditSaving(false);
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this milestone?")) return;
    const { error: err } = await supabase.from("project_milestones").delete().eq("id", id);
    if (err) { setError("Could not delete: " + err.message); return; }
    setMilestones((prev) => prev.filter((m) => m.id !== id));
  };

  const getDaysUntil = (dateStr) =>
    Math.ceil((new Date(dateStr + "T00:00:00") - new Date()) / (1000 * 60 * 60 * 24));

  return (
    <div>
      <p style={{ color: "var(--c-text-2)", fontSize: "14px", marginTop: 0 }}>
        Define milestones and alert windows. Assign checklist items to milestones from the Checklists tab.
      </p>

      {error && (
        <div style={{ background: "var(--c-err-bg)", border: "1px solid #ef4444", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", color: "var(--c-err-text)", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {/* Add form */}
      <form onSubmit={add} style={{ background: "var(--c-bg)", borderRadius: "8px", padding: "16px", marginBottom: "24px", border: "1px solid #334155" }}>
        <p style={{ color: "var(--c-accent-lt)", fontSize: "13px", fontWeight: "600", margin: "0 0 12px" }}>Add New Milestone</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px", alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Milestone Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. SD Submission" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Alert (days before)</label>
            <input type="number" value={daysAlert} onChange={(e) => setDaysAlert(Number(e.target.value))} min={1} max={180} style={inputStyle} />
          </div>
        </div>
        <button type="submit" disabled={saving} style={{
          marginTop: "12px", padding: "8px 20px", background: "var(--c-accent)", color: "white",
          border: "none", borderRadius: "6px", cursor: saving ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "600",
        }}>
          {saving ? "Adding..." : "+ Add Milestone"}
        </button>
      </form>

      {/* List */}
      {loading ? (
        <p style={{ color: "var(--c-text-2)" }}>Loading milestones...</p>
      ) : milestones.length === 0 ? (
        <p style={{ color: "var(--c-text-3)", fontSize: "14px" }}>No milestones yet. Add one above.</p>
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {milestones.map((m) => {
            const d = getDaysUntil(m.date);
            const isAlert = d >= 0 && d <= m.days_before_alert;
            const isPast = d < 0;
            const isEditing = editingId === m.id;

            if (isEditing) {
              return (
                <div key={m.id} style={{ background: "var(--c-bg)", border: "1px solid #0095da", borderRadius: "8px", padding: "14px 16px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px", alignItems: "end", marginBottom: "10px" }}>
                    <div>
                      <label style={labelStyle}>Name</label>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Date</label>
                      <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>Alert days</label>
                      <input type="number" value={editDaysAlert} onChange={(e) => setEditDaysAlert(Number(e.target.value))} min={1} max={180} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => saveEdit(m.id)} disabled={editSaving} style={{ padding: "6px 14px", background: "var(--c-ok)", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
                      {editSaving ? "Saving..." : "Save"}
                    </button>
                    <button onClick={cancelEdit} style={{ padding: "6px 14px", background: "transparent", color: "var(--c-text-2)", border: "1px solid #334155", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "12px 16px", background: "var(--c-bg)", borderRadius: "8px",
                border: `1px solid ${isAlert ? "var(--c-warn)" : "var(--c-border)"}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span style={{ color: "var(--c-text)", fontSize: "14px", fontWeight: "600" }}>{m.name}</span>
                  <span style={{ color: "var(--c-text-2)", fontSize: "13px" }}>{new Date(m.date + "T00:00:00").toLocaleDateString()}</span>
                  <span style={{ color: "var(--c-text-3)", fontSize: "12px" }}>alert {m.days_before_alert}d before</span>
                  {isAlert && <span style={{ fontSize: "11px", color: "var(--c-warn)", background: "var(--c-warn-bg)", padding: "2px 8px", borderRadius: "20px" }}>⚠ {d}d remaining</span>}
                  {isPast && <span style={{ fontSize: "11px", color: "var(--c-text-3)" }}>Past</span>}
                </div>
                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                  <button onClick={() => startEdit(m)} style={{ padding: "5px 12px", background: "var(--c-accent-dk)", color: "var(--c-accent-lt)", border: "1px solid #0095da", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                    Edit
                  </button>
                  <button onClick={() => remove(m.id)} style={{ padding: "5px 12px", background: "transparent", color: "var(--c-err)", border: "1px solid #ef4444", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Team tab (assign org members to project) ────────────────────────────────
function MembersTab({ project, session, userRole, org }) {
  const [members, setMembers] = useState([]);
  const [orgMembers, setOrgMembers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [role, setRole] = useState("engineer");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [myProfile, setMyProfile] = useState(null);

  useEffect(() => {
    fetchAll();
    fetchMyProfile();
  }, []);

  const fetchMyProfile = async () => {
    const { data } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).single();
    setMyProfile(data);
  };

  const fetchAll = async () => {
    setLoading(true);
    // Current project members
    const { data: pmRows } = await supabase.from("project_members")
      .select("id, user_id, role").eq("project_id", project.id);
    const pmIds = new Set((pmRows || []).map((r) => r.user_id));

    // All org members
    const { data: omRows } = org?.id
      ? await supabase.from("organization_members").select("user_id, role").eq("organization_id", org.id)
      : { data: [] };

    const allUserIds = [...new Set([...(pmRows || []).map((r) => r.user_id), ...(omRows || []).map((r) => r.user_id)])];
    const { data: profiles } = allUserIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", allUserIds)
      : { data: [] };
    const pMap = {};
    (profiles || []).forEach((p) => { pMap[p.id] = p; });

    setMembers((pmRows || []).map((r) => ({ ...r, profile: pMap[r.user_id] })));
    // Org members not yet on this project
    setOrgMembers((omRows || []).filter((r) => !pmIds.has(r.user_id)).map((r) => ({ ...r, profile: pMap[r.user_id] })));
    if (!pmIds.size) setSelectedUserId((omRows || [])[0]?.user_id || "");
    setLoading(false);
  };

  const addMember = async (e) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setAdding(true);
    setError("");
    const { error: err } = await supabase.from("project_members").insert({
      project_id: project.id, user_id: selectedUserId, role, invited_by: session.user.id,
    });
    if (err) { setError(err.message); setAdding(false); return; }

    const inviterName = myProfile?.full_name || session.user.email;
    await supabase.from("notifications").insert({
      user_id: selectedUserId, project_id: project.id, type: "project_invite",
      title: `You've been assigned to "${project.name}"`,
      body: `${inviterName} assigned you as ${role.replace(/_/g, " ")}.`,
    });
    setSelectedUserId("");
    fetchAll();
    setAdding(false);
  };

  const updateRole = async (memberId, newRole) => {
    const { error } = await supabase.from("project_members").update({ role: newRole }).eq("id", memberId);
    if (!error) setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, role: newRole } : m));
  };

  const removeMember = async (memberId) => {
    await supabase.from("project_members").delete().eq("id", memberId);
    fetchAll();
  };

  return (
    <div>
      <p style={{ color: "var(--c-text-2)", fontSize: "13px", marginTop: 0, marginBottom: "16px" }}>
        Assign organization members to this project with a specific role. To add someone new, invite them to the organization first via Settings → Members.
      </p>

      {/* Add from org members */}
      {orgMembers.length > 0 ? (
        <form onSubmit={addMember} style={{ background: "var(--c-bg)", borderRadius: "8px", padding: "16px", marginBottom: "16px", border: "1px solid #334155" }}>
          <p style={{ color: "var(--c-accent-lt)", fontSize: "12px", fontWeight: "700", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Add Team Member</p>
          {error && (
            <div style={{ color: "var(--c-err-text)", fontSize: "13px", marginBottom: "12px", background: "var(--c-err-bg)", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ef4444" }}>{error}</div>
          )}
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 2, minWidth: "160px" }}>
              <label style={labelStyle}>Member</label>
              <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} style={inputStyle}>
                <option value="">— select member —</option>
                {orgMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profile?.full_name || m.profile?.email || m.user_id}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: "130px" }}>
              <label style={labelStyle}>Project Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
                <option value="project_manager">Project Manager</option>
                <option value="engineer">Engineer</option>
                <option value="drafter">Drafter</option>
                <option value="qaqc">QA/QC</option>
              </select>
            </div>
            <button type="submit" disabled={adding || !selectedUserId} style={{
              padding: "10px 16px", background: "var(--c-accent)", color: "white", border: "none",
              borderRadius: "8px", cursor: adding || !selectedUserId ? "not-allowed" : "pointer",
              fontSize: "14px", fontWeight: "600", whiteSpace: "nowrap", flexShrink: 0,
            }}>
              {adding ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
      ) : !loading && (
        <div style={{ background: "var(--c-bg)", borderRadius: "8px", padding: "14px 16px", marginBottom: "16px", border: "1px solid #334155", color: "var(--c-text-3)", fontSize: "13px" }}>
          All organization members are already on this project.
        </div>
      )}

      {/* Current team list */}
      {loading ? (
        <p style={{ color: "var(--c-text-2)" }}>Loading...</p>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {members.map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--c-bg)", borderRadius: "8px", border: "1px solid #334155", flexWrap: "wrap", gap: "8px" }}>
              <div>
                <span style={{ color: "var(--c-text)", fontSize: "14px", fontWeight: "600" }}>{m.profile?.full_name || "Unknown"}</span>
                <span style={{ color: "var(--c-text-3)", fontSize: "12px", marginLeft: "8px" }}>{m.profile?.email}</span>
                {m.user_id === session.user.id && <span style={{ color: "var(--c-text-3)", fontSize: "11px", marginLeft: "6px" }}>(you)</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select value={m.role} onChange={(e) => updateRole(m.id, e.target.value)}
                  disabled={m.user_id === session.user.id}
                  style={{ background: "var(--c-surface)", border: "1px solid #334155", color: "var(--c-text)", borderRadius: "6px", padding: "5px 8px", fontSize: "12px" }}>
                  <option value="project_manager">Project Manager</option>
                  <option value="engineer">Engineer</option>
                  <option value="drafter">Drafter</option>
                  <option value="qaqc">QA/QC</option>
                </select>
                {m.user_id !== session.user.id && (
                  <button onClick={() => removeMember(m.id)} style={{ background: "none", border: "1px solid #334155", color: "var(--c-err)", cursor: "pointer", padding: "5px 10px", borderRadius: "6px", fontSize: "12px" }}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── General tab ────────────────────────────────────────────────────────────
function GeneralTab({ project, onProjectRenamed }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    setSuccess(false);
    const { error: err } = await supabase
      .from("projects")
      .update({ name: name.trim(), description: description.trim() })
      .eq("id", project.id);
    if (err) {
      setError("Could not update project: " + err.message);
    } else {
      setSuccess(true);
      onProjectRenamed(name.trim(), description.trim());
      setTimeout(() => setSuccess(false), 3000);
    }
    setSaving(false);
  };

  return (
    <div>
      <p style={{ color: "var(--c-text-2)", fontSize: "14px", marginTop: 0 }}>
        Edit the project name and description.
      </p>

      {error && (
        <div style={{ background: "var(--c-err-bg)", border: "1px solid #ef4444", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", color: "var(--c-err-text)", fontSize: "13px" }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: "var(--c-ok-bg)", border: "1px solid #4da447", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", color: "#a8e0a5", fontSize: "13px" }}>
          ✓ Project updated successfully.
        </div>
      )}

      <form onSubmit={save} style={{ background: "var(--c-bg)", borderRadius: "8px", padding: "20px", border: "1px solid #334155" }}>
        <div style={{ marginBottom: "16px" }}>
          <label style={labelStyle}>Project Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
          />
        </div>
        <div style={{ marginBottom: "20px" }}>
          <label style={labelStyle}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional project description..."
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>
        <button type="submit" disabled={saving || !name.trim()} style={{
          padding: "10px 24px", background: "var(--c-accent)", color: "white", border: "none",
          borderRadius: "8px", cursor: saving ? "not-allowed" : "pointer",
          fontSize: "14px", fontWeight: "600",
        }}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────
const TABS = ["General", "Team", "Checklists", "Milestones"];
const TAB_SHORT = ["General", "Team", "Lists", "Miles."];

export default function ProjectSetupModal({ project, session, org, orgRole, userRole, onClose, onProjectRenamed }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("General");
  const [projectName, setProjectName] = useState(project.name);

  const handleRenamed = (newName, newDesc) => {
    setProjectName(newName);
    if (onProjectRenamed) onProjectRenamed(newName, newDesc);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{
        background: "var(--c-surface)",
        borderRadius: isMobile ? "16px 16px 0 0" : "16px",
        width: "100%",
        maxWidth: isMobile ? "100%" : "760px",
        height: isMobile ? "92vh" : undefined,
        maxHeight: isMobile ? "92vh" : "88vh",
        display: "flex", flexDirection: "column",
        boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ padding: isMobile ? "16px 16px 0" : "24px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ color: "var(--c-text)", margin: 0, fontSize: isMobile ? "15px" : "18px", fontWeight: "700", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: isMobile ? "240px" : undefined }}>
            ⚙ {isMobile ? projectName : `Project Setup — ${projectName}`}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--c-text-2)", fontSize: "26px", cursor: "pointer", lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>
            ×
          </button>
        </div>

        {/* Tabs — scrollable on mobile */}
        <div style={{ display: "flex", padding: isMobile ? "12px 16px 0" : "16px 24px 0", borderBottom: "1px solid #334155", overflowX: "auto" }}>
          {TABS.map((t, i) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: isMobile ? "7px 12px" : "8px 16px",
              border: "none", background: "transparent", cursor: "pointer",
              fontSize: isMobile ? "13px" : "14px",
              fontWeight: tab === t ? "600" : "400",
              color: tab === t ? "var(--c-accent)" : "var(--c-text-2)",
              borderBottom: `2px solid ${tab === t ? "var(--c-accent)" : "transparent"}`,
              marginBottom: "-1px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}>
              {isMobile ? TAB_SHORT[i] : t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px" : "24px" }}>
          {tab === "General" && <GeneralTab project={{ ...project, name: projectName }} onProjectRenamed={handleRenamed} />}
          {tab === "Team" && <MembersTab project={project} session={session} userRole={userRole} org={org} />}
          {tab === "Checklists" && <ChecklistsTab project={project} userRole={userRole} />}
          {tab === "Milestones" && <MilestonesTab project={project} />}
        </div>
      </div>
    </div>
  );
}
