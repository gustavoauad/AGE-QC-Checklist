import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { CATEGORIES } from "../checklistTemplate";
import { useIsMobile } from "../useIsMobile";

const inputStyle = {
  width: "100%", padding: "10px 12px", background: "#0f172a",
  border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9",
  fontSize: "14px", boxSizing: "border-box",
};
const labelStyle = { display: "block", color: "#94a3b8", fontSize: "13px", marginBottom: "6px" };

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
  const canEdit = userRole === "project_manager";
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

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    const [cfgRes, itemsRes] = await Promise.all([
      supabase.from("project_checklist_config").select("*").eq("project_id", project.id),
      supabase.from("checklists").select("*").eq("project_id", project.id)
        .order("category").order("sort_order", { nullsFirst: false }).order("item_id"),
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
    setLoading(false);
  };

  const standardCatIds = new Set(CATEGORIES.map((c) => c.id));
  const customCats = Object.entries(config)
    .filter(([key, val]) => !standardCatIds.has(key) && val?.label)
    .map(([key, val]) => ({ id: key, label: val.label, isCustom: true }));
  const allCats = [...CATEGORIES.map((c) => ({ ...c, isCustom: false })), ...customCats];
  const getLabel = (cat) => config[cat.id]?.label || cat.label;
  const mBtn = (extra = {}) => ({ padding: "3px 7px", background: "transparent", border: "1px solid #334155", color: "#64748b", borderRadius: "4px", cursor: "pointer", fontSize: "11px", fontFamily: "Manrope, sans-serif", ...extra });

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

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading...</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <p style={{ color: "#94a3b8", fontSize: "13px", margin: 0 }}>
          {canEdit ? "Manage checklist categories, sections, and items for this project." : "View checklist items for this project. Only project managers can edit."}
        </p>
        {canEdit && (
          <button onClick={() => setAddingCat(true)} style={{ padding: "7px 14px", background: "#0095da", color: "white", border: "none", borderRadius: "7px", cursor: "pointer", fontSize: "13px", fontWeight: "600", fontFamily: "Manrope, sans-serif", flexShrink: 0 }}>
            + Add Checklist
          </button>
        )}
      </div>

      {addingCat && (
        <div style={{ background: "#0f172a", border: "1px solid #0095da", borderRadius: "10px", padding: "14px 16px", marginBottom: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
          <input autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCustomCategory(); if (e.key === "Escape") { setAddingCat(false); setNewCatName(""); } }}
            placeholder="Checklist name (e.g. MEP Coordination)"
            style={{ flex: 1, padding: "8px 12px", background: "#1e293b", border: "1px solid #0095da", borderRadius: "7px", color: "#f1f5f9", fontSize: "14px" }}
          />
          <button onClick={addCustomCategory} disabled={savingCat || !newCatName.trim()} style={{ padding: "8px 16px", background: "#0095da", color: "white", border: "none", borderRadius: "7px", cursor: savingCat ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: "600" }}>
            {savingCat ? "..." : "Create"}
          </button>
          <button onClick={() => { setAddingCat(false); setNewCatName(""); }} style={{ padding: "8px 12px", background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: "7px", cursor: "pointer", fontSize: "13px" }}>x</button>
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
            <div key={cat.id} style={{ background: "#0f172a", borderRadius: "10px", border: `1px solid ${isExpanded ? "#0095da" : enabled ? "#334155" : "#1e293b"}`, overflow: "hidden", opacity: enabled ? 1 : 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px" }}>
                {canEdit && (
                  <button onClick={() => toggle(cat.id)} style={{ padding: "3px 10px", borderRadius: "20px", border: "1px solid", fontSize: "10px", fontWeight: "700", cursor: "pointer", flexShrink: 0, background: enabled ? "#1a3318" : "#1e293b", borderColor: enabled ? "#4da447" : "#334155", color: enabled ? "#7ecb7b" : "#64748b" }}>
                    {enabled ? "ON" : "OFF"}
                  </button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isRenamingThis ? (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input autoFocus value={renameCatText} onChange={(e) => setRenameCatText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRename(cat.id); if (e.key === "Escape") setRenamingCat(null); }}
                        style={{ flex: 1, padding: "5px 8px", background: "#1e293b", border: "1px solid #0095da", borderRadius: "6px", color: "#f1f5f9", fontSize: "13px" }}
                      />
                      <button onClick={() => saveRename(cat.id)} style={{ padding: "4px 10px", background: "#0095da", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>Save</button>
                      <button onClick={() => setRenamingCat(null)} style={{ padding: "4px 8px", background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}>x</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ color: "#f1f5f9", fontSize: "14px", fontWeight: "600" }}>{getLabel(cat)}</span>
                      {cat.isCustom && <span style={{ fontSize: "10px", color: "#0095da", background: "#012d5a", padding: "1px 7px", borderRadius: "20px", fontWeight: "600" }}>custom</span>}
                      <span style={{ color: "#64748b", fontSize: "11px" }}>{catItems.length} items</span>
                    </div>
                  )}
                </div>
                {canEdit && !isRenamingThis && (
                  <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                    <button onClick={() => { setRenamingCat(cat.id); setRenameCatText(getLabel(cat)); }} style={mBtn()}>Rename</button>
                    {cat.isCustom && <button onClick={() => deleteCustomCat(cat.id)} style={mBtn({ color: "#ef4444" })}>x</button>}
                  </div>
                )}
                <button onClick={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)} style={{ background: "none", border: "none", color: isExpanded ? "#0095da" : "#64748b", cursor: "pointer", padding: "4px 6px", fontSize: "13px", flexShrink: 0 }}>
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
                          style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px 6px 8px", background: isSectionDT ? "#012d5a" : isOrderT ? "#0d2340" : "#0c1a28", borderLeft: `3px solid ${isSectionDT ? "#f59e0b" : "#0095da"}`, borderRadius: "0 6px 6px 0", marginBottom: "4px", cursor: canEdit && !isRenSec ? "grab" : "default", transition: "background 0.12s" }}
                        >
                          {canEdit && <span style={{ color: "#475569", fontSize: "14px", userSelect: "none", flexShrink: 0 }}>:</span>}
                          {isRenSec ? (
                            <div style={{ display: "flex", gap: "6px", flex: 1, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                              <input autoFocus value={renameSectionText} onChange={(e) => setRenameSectionText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") renameSection(cat.id, sLabel); if (e.key === "Escape") setRenamingSection(null); }}
                                style={{ flex: 1, padding: "3px 8px", background: "#0f172a", border: "1px solid #0095da", borderRadius: "4px", color: "#f1f5f9", fontSize: "12px" }}
                              />
                              <button onClick={() => renameSection(cat.id, sLabel)} style={mBtn({ background: "#0095da", color: "white", border: "none" })}>Save</button>
                              <button onClick={() => setRenamingSection(null)} style={mBtn()}>x</button>
                            </div>
                          ) : (
                            <>
                              <span style={{ flex: 1, color: "#7dd3fc", fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.07em" }}>{sLabel}</span>
                              {isSectionDT && <span style={{ color: "#f59e0b", fontSize: "10px", flexShrink: 0 }}>drop to assign</span>}
                              {canEdit && (
                                <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                                  <button onClick={() => { setRenamingSection({ catId: cat.id, label: sLabel }); setRenameSectionText(sLabel); }} style={mBtn()}>Rename</button>
                                  <button onClick={() => deleteSection(cat.id, sLabel)} style={mBtn({ color: "#ef4444" })}>x</button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        <div style={{ display: "grid", gap: "3px", marginLeft: "12px" }}>
                          {sectionItems.map((item) => {
                            const isDO = dragOver === `item:${item.id}`;
                            const isBDi = dragInfo.current?.type === "item" && dragInfo.current?.itemId === item.id;
                            return (
                              <div key={item.id} draggable={canEdit && editingItemId !== item.id}
                                onDragStart={(e) => handleItemDragStart(e, cat.id, item.id)}
                                onDragOver={(e) => handleItemDragOver(e, cat.id, item.id)}
                                onDrop={(e) => handleItemDrop(e, cat.id, item.id, item.sub_section)}
                                onDragEnd={handleDragEnd}
                                style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", borderRadius: "0 6px 6px 0", borderLeft: `2px solid ${isDO ? "#0095da" : "#29439b"}`, background: isDO ? "#012d5a" : "#1a2a3a", opacity: isBDi ? 0.3 : 1, transition: "background 0.1s" }}
                              >
                                {canEdit && <span style={{ color: "#475569", fontSize: "13px", cursor: "grab", userSelect: "none", flexShrink: 0 }}>:</span>}
                                {editingItemId === item.id ? (
                                  <input autoFocus value={editItemText} onChange={(e) => setEditItemText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") saveItemEdit(item); if (e.key === "Escape") setEditingItemId(null); }}
                                    style={{ flex: 1, padding: "3px 8px", background: "#0f172a", border: "1px solid #0095da", borderRadius: "4px", color: "#f1f5f9", fontSize: "13px" }}
                                  />
                                ) : (
                                  <span style={{ flex: 1, color: "#cbd5e1", fontSize: "13px", lineHeight: 1.4 }}>
                                    {item.item_text}
                                    {item.edited_by_pm && <span style={{ marginLeft: "6px", fontSize: "10px", color: "#f59e0b", background: "#451a03", padding: "1px 5px", borderRadius: "3px" }}>edited</span>}
                                    {item.is_custom && <span style={{ marginLeft: "6px", fontSize: "10px", color: "#a78bfa", background: "#2e1065", padding: "1px 5px", borderRadius: "3px" }}>custom</span>}
                                  </span>
                                )}
                                {canEdit && (
                                  <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                                    {editingItemId === item.id
                                      ? <><button onClick={() => saveItemEdit(item)} style={mBtn({ background: "#0095da", color: "white", border: "none" })}>Save</button><button onClick={() => setEditingItemId(null)} style={mBtn()}>x</button></>
                                      : <><button onClick={() => { setEditingItemId(item.id); setEditItemText(item.item_text); }} style={mBtn()}>Edit</button><button onClick={() => removeItem(item)} style={mBtn({ color: "#ef4444" })}>x</button></>
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
                              placeholder="New item text..." style={{ flex: 1, padding: "6px 9px", background: "#1e293b", border: "1px solid #0095da", borderRadius: "5px", color: "#f1f5f9", fontSize: "13px" }}
                            />
                            <button onClick={() => addItem(cat.id, sLabel)} style={mBtn({ background: "#0095da", color: "white", border: "none", padding: "6px 12px" })}>Add</button>
                            <button onClick={() => { setAddingTo(null); setNewItemText(""); }} style={mBtn({ padding: "6px 9px" })}>x</button>
                          </div>
                        ) : (
                          <button onClick={() => setAddingTo({ catId: cat.id, section: sLabel })}
                            style={{ display: "block", width: "calc(100% - 12px)", marginLeft: "12px", marginTop: "4px", padding: "5px", background: "transparent", border: "1px dashed #29439b", borderRadius: "5px", color: "#475569", fontSize: "11px", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0095da"; e.currentTarget.style.color = "#7dd3fc"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#29439b"; e.currentTarget.style.color = "#475569"; }}
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
                                <span style={{ color: "#475569", fontSize: "10px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>No Section</span>
                                <div style={{ flex: 1, height: "1px", background: "#2d3f55" }} />
                              </div>
                            )}
                            <div style={{ display: "grid", gap: "3px" }}>
                              {noSection.map((item) => {
                                const isDO = dragOver === `item:${item.id}`;
                                const isBDi = dragInfo.current?.type === "item" && dragInfo.current?.itemId === item.id;
                                return (
                                  <div key={item.id} draggable={canEdit && editingItemId !== item.id}
                                    onDragStart={(e) => handleItemDragStart(e, cat.id, item.id)}
                                    onDragOver={(e) => handleItemDragOver(e, cat.id, item.id)}
                                    onDrop={(e) => handleItemDrop(e, cat.id, item.id, null)}
                                    onDragEnd={handleDragEnd}
                                    style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px", borderRadius: "6px", borderLeft: `2px dashed ${isDO ? "#0095da" : "#334155"}`, background: isDO ? "#012d5a" : "#1e293b", opacity: isBDi ? 0.3 : 1, transition: "background 0.1s" }}
                                  >
                                    {canEdit && <span style={{ color: "#475569", fontSize: "13px", cursor: "grab", userSelect: "none", flexShrink: 0 }}>:</span>}
                                    {editingItemId === item.id ? (
                                      <input autoFocus value={editItemText} onChange={(e) => setEditItemText(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") saveItemEdit(item); if (e.key === "Escape") setEditingItemId(null); }}
                                        style={{ flex: 1, padding: "3px 8px", background: "#0f172a", border: "1px solid #0095da", borderRadius: "4px", color: "#f1f5f9", fontSize: "13px" }}
                                      />
                                    ) : (
                                      <span style={{ flex: 1, color: "#94a3b8", fontSize: "13px", lineHeight: 1.4 }}>
                                        {item.item_text}
                                        {item.edited_by_pm && <span style={{ marginLeft: "6px", fontSize: "10px", color: "#f59e0b", background: "#451a03", padding: "1px 5px", borderRadius: "3px" }}>edited</span>}
                                        {item.is_custom && <span style={{ marginLeft: "6px", fontSize: "10px", color: "#a78bfa", background: "#2e1065", padding: "1px 5px", borderRadius: "3px" }}>custom</span>}
                                      </span>
                                    )}
                                    {canEdit && (
                                      <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                                        {editingItemId === item.id
                                          ? <><button onClick={() => saveItemEdit(item)} style={mBtn({ background: "#0095da", color: "white", border: "none" })}>Save</button><button onClick={() => setEditingItemId(null)} style={mBtn()}>x</button></>
                                          : <><button onClick={() => { setEditingItemId(item.id); setEditItemText(item.item_text); }} style={mBtn()}>Edit</button><button onClick={() => removeItem(item)} style={mBtn({ color: "#ef4444" })}>x</button></>
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
                              placeholder="New item text..." style={{ flex: 1, padding: "6px 9px", background: "#1e293b", border: "1px solid #0095da", borderRadius: "5px", color: "#f1f5f9", fontSize: "13px" }}
                            />
                            <button onClick={() => addItem(cat.id, null)} style={mBtn({ background: "#0095da", color: "white", border: "none", padding: "6px 12px" })}>Add</button>
                            <button onClick={() => { setAddingTo(null); setNewItemText(""); }} style={mBtn({ padding: "6px 9px" })}>x</button>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {canEdit && addingTo?.catId !== cat.id && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                      <button onClick={() => setAddingTo({ catId: cat.id, section: null })}
                        style={{ flex: 1, padding: "6px 10px", background: "transparent", border: "1px dashed #334155", borderRadius: "6px", color: "#64748b", fontSize: "12px", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0095da"; e.currentTarget.style.color = "#33bdef"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#64748b"; }}>
                        {catSections.length > 0 ? "+ Add Item (No Section)" : "+ Add Item"}
                      </button>
                      {addingSection !== cat.id && (
                        <button onClick={() => { setAddingSection(cat.id); setNewSectionText(""); }}
                          style={{ padding: "6px 12px", background: "transparent", border: "1px dashed #0095da", borderRadius: "6px", color: "#0095da", fontSize: "12px", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "#012d5a"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                          + Add Section
                        </button>
                      )}
                    </div>
                  )}
                  {addingSection === cat.id && (
                    <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center" }}>
                      <div style={{ width: "3px", background: "#0095da", borderRadius: "2px", alignSelf: "stretch", flexShrink: 0 }} />
                      <input autoFocus value={newSectionText} onChange={(e) => setNewSectionText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") addSection(cat.id); if (e.key === "Escape") setAddingSection(null); }}
                        placeholder="Section name..." style={{ flex: 1, padding: "6px 10px", background: "#0c1a28", border: "1px solid #0095da", borderRadius: "5px", color: "#f1f5f9", fontSize: "13px" }}
                      />
                      <button onClick={() => addSection(cat.id)} disabled={!newSectionText.trim()} style={mBtn({ background: "#0095da", color: "white", border: "none", padding: "6px 12px" })}>Create</button>
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
  // assignment panel state
  const [assigningId, setAssigningId] = useState(null);
  const [projectItems, setProjectItems] = useState([]);
  const [assignedSets, setAssignedSets] = useState({}); // milestoneId -> Set<itemId>
  const [assignLoading, setAssignLoading] = useState(false);

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
    setAssigningId(null);
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
    if (!window.confirm("Delete this milestone and all its item assignments?")) return;
    const { error: err } = await supabase.from("project_milestones").delete().eq("id", id);
    if (err) { setError("Could not delete: " + err.message); return; }
    setMilestones((prev) => prev.filter((m) => m.id !== id));
    if (assigningId === id) setAssigningId(null);
  };

  // ── Assignment panel ──────────────────────────────────────────────────────
  const openAssign = async (milestoneId) => {
    if (assigningId === milestoneId) { setAssigningId(null); return; }
    setEditingId(null);
    setAssigningId(milestoneId);
    setAssignLoading(true);

    // Load all project checklist items once
    let items = projectItems;
    if (items.length === 0) {
      const { data } = await supabase.from("checklists")
        .select("id, category, sub_section, item_text, phase").eq("project_id", project.id).order("category").order("item_id");
      items = data || [];
      setProjectItems(items);
    }

    // Load assigned items for this milestone
    if (!assignedSets[milestoneId]) {
      const { data } = await supabase.from("milestone_items")
        .select("checklist_item_id").eq("milestone_id", milestoneId);
      const ids = new Set((data || []).map((r) => r.checklist_item_id));
      setAssignedSets((prev) => ({ ...prev, [milestoneId]: ids }));
    }

    setAssignLoading(false);
  };

  const toggleItem = async (milestoneId, itemId, add) => {
    // Optimistic update
    setAssignedSets((prev) => {
      const next = new Set(prev[milestoneId] || []);
      add ? next.add(itemId) : next.delete(itemId);
      return { ...prev, [milestoneId]: next };
    });

    if (add) {
      await supabase.from("milestone_items").insert({ milestone_id: milestoneId, checklist_item_id: itemId });
    } else {
      await supabase.from("milestone_items").delete()
        .eq("milestone_id", milestoneId).eq("checklist_item_id", itemId);
    }
  };

  const selectAllInCategory = async (milestoneId, catItems, addAll) => {
    for (const item of catItems) {
      const already = assignedSets[milestoneId]?.has(item.id) ?? false;
      if (addAll && !already) await toggleItem(milestoneId, item.id, true);
      if (!addAll && already) await toggleItem(milestoneId, item.id, false);
    }
  };

  const getDaysUntil = (dateStr) =>
    Math.ceil((new Date(dateStr + "T00:00:00") - new Date()) / (1000 * 60 * 60 * 24));

  const groupedItems = CATEGORIES.reduce((acc, cat) => {
    const items = projectItems.filter((i) => i.category === cat.id);
    if (items.length) acc[cat.id] = { label: cat.label, items };
    return acc;
  }, {});

  return (
    <div>
      <p style={{ color: "#94a3b8", fontSize: "14px", marginTop: 0 }}>
        Define milestones, set alert windows, and assign which checklist items belong to each milestone.
      </p>

      {error && (
        <div style={{ background: "#450a0a", border: "1px solid #ef4444", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", color: "#fca5a5", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {/* Add form */}
      <form onSubmit={add} style={{ background: "#0f172a", borderRadius: "8px", padding: "16px", marginBottom: "24px", border: "1px solid #334155" }}>
        <p style={{ color: "#33bdef", fontSize: "13px", fontWeight: "600", margin: "0 0 12px" }}>Add New Milestone</p>
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
          marginTop: "12px", padding: "8px 20px", background: "#0095da", color: "white",
          border: "none", borderRadius: "6px", cursor: saving ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "600",
        }}>
          {saving ? "Adding..." : "+ Add Milestone"}
        </button>
      </form>

      {/* List */}
      {loading ? (
        <p style={{ color: "#94a3b8" }}>Loading milestones...</p>
      ) : milestones.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: "14px" }}>No milestones yet. Add one above.</p>
      ) : (
        <div style={{ display: "grid", gap: "12px" }}>
          {milestones.map((m) => {
            const d = getDaysUntil(m.date);
            const isAlert = d >= 0 && d <= m.days_before_alert;
            const isPast = d < 0;
            const isEditing = editingId === m.id;
            const isAssigning = assigningId === m.id;
            const assigned = assignedSets[m.id];
            const assignedCount = assigned?.size ?? "—";

            if (isEditing) {
              return (
                <div key={m.id} style={{ background: "#0f172a", border: "1px solid #0095da", borderRadius: "8px", padding: "14px 16px" }}>
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
                    <button onClick={() => saveEdit(m.id)} disabled={editSaving} style={{ padding: "6px 14px", background: "#4da447", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
                      {editSaving ? "Saving..." : "Save"}
                    </button>
                    <button onClick={cancelEdit} style={{ padding: "6px 14px", background: "transparent", color: "#94a3b8", border: "1px solid #334155", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id}>
                {/* Milestone row */}
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "12px 16px", background: "#0f172a", borderRadius: isAssigning ? "8px 8px 0 0" : "8px",
                  border: `1px solid ${isAssigning ? "#0095da" : isAlert ? "#f59e0b" : "#334155"}`,
                  borderBottom: isAssigning ? "none" : undefined,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                    <span style={{ color: "#f1f5f9", fontSize: "14px", fontWeight: "600" }}>{m.name}</span>
                    <span style={{ color: "#94a3b8", fontSize: "13px" }}>{new Date(m.date + "T00:00:00").toLocaleDateString()}</span>
                    <span style={{ color: "#64748b", fontSize: "12px" }}>alert {m.days_before_alert}d before</span>
                    {assigned !== undefined && (
                      <span style={{ fontSize: "11px", color: "#33bdef", background: "#012d5a", padding: "2px 8px", borderRadius: "20px" }}>
                        {assignedCount} items
                      </span>
                    )}
                    {isAlert && <span style={{ fontSize: "11px", color: "#f59e0b", background: "#451a03", padding: "2px 8px", borderRadius: "20px" }}>⚠ {d}d remaining</span>}
                    {isPast && <span style={{ fontSize: "11px", color: "#64748b" }}>Past</span>}
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                    <button onClick={() => openAssign(m.id)} style={{
                      padding: "5px 12px", background: isAssigning ? "#012d5a" : "transparent",
                      color: isAssigning ? "#33bdef" : "#94a3b8",
                      border: `1px solid ${isAssigning ? "#0095da" : "#334155"}`,
                      borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600",
                    }}>
                      {isAssigning ? "▲ Assign Items" : "▼ Assign Items"}
                    </button>
                    <button onClick={() => startEdit(m)} style={{ padding: "5px 12px", background: "#012d5a", color: "#33bdef", border: "1px solid #0095da", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                      Edit
                    </button>
                    <button onClick={() => remove(m.id)} style={{ padding: "5px 12px", background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                      Delete
                    </button>
                  </div>
                </div>

                {/* Assignment panel */}
                {isAssigning && (
                  <div style={{ border: "1px solid #0095da", borderTop: "none", borderRadius: "0 0 8px 8px", background: "#060f1e", padding: "16px", maxHeight: "420px", overflowY: "auto" }}>
                    {assignLoading ? (
                      <p style={{ color: "#94a3b8", fontSize: "13px" }}>Loading items...</p>
                    ) : (
                      Object.entries(groupedItems).map(([catId, { label, items }]) => {
                        const catAssigned = items.filter((i) => assignedSets[m.id]?.has(i.id));
                        const allSelected = catAssigned.length === items.length;
                        return (
                          <div key={catId} style={{ marginBottom: "16px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", paddingBottom: "4px", borderBottom: "1px solid #1e293b" }}>
                              <span style={{ color: "#33bdef", fontSize: "12px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                {label}
                                <span style={{ color: "#334155", fontWeight: "400", marginLeft: "6px" }}>({catAssigned.length}/{items.length})</span>
                              </span>
                              <button
                                onClick={() => selectAllInCategory(m.id, items, !allSelected)}
                                style={{ fontSize: "11px", color: allSelected ? "#64748b" : "#0095da", background: "none", border: "none", cursor: "pointer", fontWeight: "600" }}>
                                {allSelected ? "Deselect All" : "Select All"}
                              </button>
                            </div>
                            <div style={{ display: "grid", gap: "2px" }}>
                              {items.map((item) => {
                                const checked = assignedSets[m.id]?.has(item.id) ?? false;
                                return (
                                  <label key={item.id} style={{
                                    display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer",
                                    padding: "5px 8px", borderRadius: "5px",
                                    background: checked ? "#0f2744" : "transparent",
                                  }}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) => toggleItem(m.id, item.id, e.target.checked)}
                                      style={{ marginTop: "3px", flexShrink: 0, accentColor: "#0095da" }}
                                    />
                                    <span style={{ color: checked ? "#f1f5f9" : "#94a3b8", fontSize: "13px", lineHeight: "1.45", flex: 1 }}>
                                      {item.item_text}
                                    </span>
                                    {item.phase && (
                                      <span style={{ fontSize: "10px", color: "#0095da", background: "#012d5a", padding: "1px 6px", borderRadius: "4px", flexShrink: 0, alignSelf: "center" }}>
                                        {item.phase}
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
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
      <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: 0, marginBottom: "16px" }}>
        Assign organization members to this project with a specific role. To add someone new, invite them to the organization first via Settings → Members.
      </p>

      {/* Add from org members */}
      {orgMembers.length > 0 ? (
        <form onSubmit={addMember} style={{ background: "#0f172a", borderRadius: "8px", padding: "16px", marginBottom: "16px", border: "1px solid #334155" }}>
          <p style={{ color: "#33bdef", fontSize: "12px", fontWeight: "700", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Add Team Member</p>
          {error && (
            <div style={{ color: "#fca5a5", fontSize: "13px", marginBottom: "12px", background: "#450a0a", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ef4444" }}>{error}</div>
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
              </select>
            </div>
            <button type="submit" disabled={adding || !selectedUserId} style={{
              padding: "10px 16px", background: "#0095da", color: "white", border: "none",
              borderRadius: "8px", cursor: adding || !selectedUserId ? "not-allowed" : "pointer",
              fontSize: "14px", fontWeight: "600", whiteSpace: "nowrap", flexShrink: 0,
            }}>
              {adding ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
      ) : !loading && (
        <div style={{ background: "#0f172a", borderRadius: "8px", padding: "14px 16px", marginBottom: "16px", border: "1px solid #334155", color: "#64748b", fontSize: "13px" }}>
          All organization members are already on this project.
        </div>
      )}

      {/* Current team list */}
      {loading ? (
        <p style={{ color: "#94a3b8" }}>Loading...</p>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {members.map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155", flexWrap: "wrap", gap: "8px" }}>
              <div>
                <span style={{ color: "#f1f5f9", fontSize: "14px", fontWeight: "600" }}>{m.profile?.full_name || "Unknown"}</span>
                <span style={{ color: "#64748b", fontSize: "12px", marginLeft: "8px" }}>{m.profile?.email}</span>
                {m.user_id === session.user.id && <span style={{ color: "#64748b", fontSize: "11px", marginLeft: "6px" }}>(you)</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select value={m.role} onChange={(e) => updateRole(m.id, e.target.value)}
                  disabled={m.user_id === session.user.id}
                  style={{ background: "#1e293b", border: "1px solid #334155", color: "#f1f5f9", borderRadius: "6px", padding: "5px 8px", fontSize: "12px" }}>
                  <option value="project_manager">Project Manager</option>
                  <option value="engineer">Engineer</option>
                  <option value="drafter">Drafter</option>
                </select>
                {m.user_id !== session.user.id && (
                  <button onClick={() => removeMember(m.id)} style={{ background: "none", border: "1px solid #334155", color: "#ef4444", cursor: "pointer", padding: "5px 10px", borderRadius: "6px", fontSize: "12px" }}>
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
      <p style={{ color: "#94a3b8", fontSize: "14px", marginTop: 0 }}>
        Edit the project name and description.
      </p>

      {error && (
        <div style={{ background: "#450a0a", border: "1px solid #ef4444", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", color: "#fca5a5", fontSize: "13px" }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: "#1a3318", border: "1px solid #4da447", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", color: "#a8e0a5", fontSize: "13px" }}>
          ✓ Project updated successfully.
        </div>
      )}

      <form onSubmit={save} style={{ background: "#0f172a", borderRadius: "8px", padding: "20px", border: "1px solid #334155" }}>
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
          padding: "10px 24px", background: "#0095da", color: "white", border: "none",
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
        background: "#1e293b",
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
          <h2 style={{ color: "#f1f5f9", margin: 0, fontSize: isMobile ? "15px" : "18px", fontWeight: "700", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: isMobile ? "240px" : undefined }}>
            ⚙ {isMobile ? projectName : `Project Setup — ${projectName}`}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: "26px", cursor: "pointer", lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>
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
              color: tab === t ? "#0095da" : "#94a3b8",
              borderBottom: `2px solid ${tab === t ? "#0095da" : "transparent"}`,
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
