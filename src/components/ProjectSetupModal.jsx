import { useState, useEffect } from "react";
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
function ChecklistsTab({ project }) {
  const [config, setConfig] = useState({});   // { [catKey]: { enabled, label } }
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState(null);
  const [localEdits, setLocalEdits] = useState({});
  const [savingEdits, setSavingEdits] = useState(false);
  const [duplicating, setDuplicating] = useState(null);
  const [renamingCat, setRenamingCat] = useState(null);
  const [renameText, setRenameText] = useState("");

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    const [cfgRes, itemsRes] = await Promise.all([
      supabase.from("project_checklist_config").select("*").eq("project_id", project.id),
      supabase.from("checklists").select("*").eq("project_id", project.id).order("item_id"),
    ]);
    const cfgMap = {};
    (cfgRes.data || []).forEach((r) => { cfgMap[r.category] = { enabled: r.enabled, label: r.label }; });
    setConfig(cfgMap);
    setItems(itemsRes.data || []);
    setLoading(false);
  };

  const standardCatIds = new Set(CATEGORIES.map((c) => c.id));

  const customCategories = Object.entries(config)
    .filter(([key, val]) => !standardCatIds.has(key) && val?.label)
    .map(([key, val]) => ({ id: key, label: val.label, isCustom: true }));

  const allCategories = [
    ...CATEGORIES.map((c) => ({ ...c, isCustom: false })),
    ...customCategories,
  ];

  const toggle = async (catId) => {
    const current = config[catId];
    const newEnabled = current?.enabled === false ? true : false;
    await supabase.from("project_checklist_config").upsert(
      { project_id: project.id, category: catId, enabled: newEnabled, label: current?.label || null },
      { onConflict: "project_id,category" }
    );
    setConfig((prev) => ({ ...prev, [catId]: { ...prev[catId], enabled: newEnabled } }));
  };

  const duplicate = async (cat) => {
    if (duplicating) return;
    setDuplicating(cat.id);
    const catItems = items.filter((i) => i.category === cat.id);
    const ts = Date.now().toString(36);
    const newKey = `${cat.id.substring(0, 8)}_copy_${ts}`;
    const newLabel = `${cat.label} (Copy)`;

    const copies = catItems.map((item) => ({
      project_id: project.id,
      item_id: `${newKey}_${item.item_id}`,
      category: newKey,
      sub_section: item.sub_section || null,
      phase: item.phase || null,
      item_text: item.item_text,
      status: "pending",
      is_custom: true,
    }));

    for (let i = 0; i < copies.length; i += 50) {
      await supabase.from("checklists").insert(copies.slice(i, i + 50));
    }
    await supabase.from("project_checklist_config").upsert(
      { project_id: project.id, category: newKey, enabled: true, label: newLabel },
      { onConflict: "project_id,category" }
    );
    await loadAll();
    setDuplicating(null);
  };

  const deleteCustomCat = async (catId) => {
    if (!window.confirm("Delete this checklist and all its items? This cannot be undone.")) return;
    await supabase.from("checklists").delete().eq("project_id", project.id).eq("category", catId);
    await supabase.from("project_checklist_config").delete()
      .eq("project_id", project.id).eq("category", catId);
    await loadAll();
  };

  const toggleExpand = (catId) => {
    if (expandedCat === catId) { setExpandedCat(null); setLocalEdits({}); }
    else { setExpandedCat(catId); setLocalEdits({}); }
  };

  const saveEdits = async () => {
    setSavingEdits(true);
    for (const [id, text] of Object.entries(localEdits)) {
      await supabase.from("checklists").update({ item_text: text }).eq("id", id);
    }
    setItems((prev) => prev.map((i) => localEdits[i.id] ? { ...i, item_text: localEdits[i.id] } : i));
    setLocalEdits({});
    setSavingEdits(false);
  };

  const saveRename = async (catId) => {
    if (!renameText.trim()) return;
    await supabase.from("project_checklist_config").upsert(
      { project_id: project.id, category: catId, enabled: config[catId]?.enabled ?? true, label: renameText.trim() },
      { onConflict: "project_id,category" }
    );
    setConfig((prev) => ({ ...prev, [catId]: { ...prev[catId], label: renameText.trim() } }));
    setRenamingCat(null);
  };

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading...</p>;

  return (
    <div>
      <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: 0, marginBottom: "16px" }}>
        Enable/disable categories, edit item text (project-specific), or duplicate a category to create a custom version.
      </p>

      <div style={{ display: "grid", gap: "8px" }}>
        {allCategories.map((cat) => {
          const cfg = config[cat.id];
          const enabled = cfg?.enabled !== false;
          const isExpanded = expandedCat === cat.id;
          const catItems = items.filter((i) => i.category === cat.id);
          const isDuplicating = duplicating === cat.id;
          const isRenaming = renamingCat === cat.id;
          const hasEdits = isExpanded && Object.keys(localEdits).length > 0;

          return (
            <div key={cat.id} style={{ border: `1px solid ${isExpanded ? "#0095da" : "#334155"}`, borderRadius: "8px", overflow: "hidden", opacity: enabled ? 1 : 0.65 }}>

              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: isExpanded ? "#011a3d" : "#0f172a" }}>
                {/* Name / rename */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isRenaming ? (
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input value={renameText} onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveRename(cat.id)} autoFocus
                        style={{ ...inputStyle, padding: "5px 10px", fontSize: "13px" }} />
                      <button onClick={() => saveRename(cat.id)} style={{ padding: "5px 12px", background: "#0095da", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>Save</button>
                      <button onClick={() => setRenamingCat(null)} style={{ padding: "5px 10px", background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>✕</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ color: "#f1f5f9", fontSize: "14px", fontWeight: "500" }}>{cat.label}</span>
                      {cat.isCustom && <span style={{ fontSize: "10px", color: "#0095da", background: "#012d5a", padding: "1px 7px", borderRadius: "20px", fontWeight: "600" }}>custom</span>}
                      <span style={{ fontSize: "11px", color: "#64748b" }}>{catItems.length} items</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                {!isRenaming && (
                  <div style={{ display: "flex", gap: "5px", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button onClick={() => toggleExpand(cat.id)}
                      style={{ padding: "4px 10px", background: isExpanded ? "#012d5a" : "transparent", color: isExpanded ? "#33bdef" : "#94a3b8", border: `1px solid ${isExpanded ? "#0095da" : "#334155"}`, borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontWeight: "600" }}>
                      {isExpanded ? "▲ Close" : "✏ Edit Items"}
                    </button>
                    <button onClick={() => duplicate(cat)} disabled={!!duplicating}
                      style={{ padding: "4px 10px", background: "transparent", color: "#94a3b8", border: "1px solid #334155", borderRadius: "6px", cursor: duplicating ? "not-allowed" : "pointer", fontSize: "11px" }}>
                      {isDuplicating ? "..." : "⧉ Duplicate"}
                    </button>
                    {cat.isCustom && (
                      <button onClick={() => { setRenamingCat(cat.id); setRenameText(cat.label); }}
                        style={{ padding: "4px 10px", background: "transparent", color: "#94a3b8", border: "1px solid #334155", borderRadius: "6px", cursor: "pointer", fontSize: "11px" }}>
                        Rename
                      </button>
                    )}
                    <button onClick={() => toggle(cat.id)}
                      style={{ padding: "4px 12px", border: `1px solid ${enabled ? "#4da447" : "#334155"}`, borderRadius: "6px", cursor: "pointer", fontSize: "11px", fontWeight: "700", background: enabled ? "#1a3318" : "#1e293b", color: enabled ? "#7ecb7b" : "#64748b" }}>
                      {enabled ? "ON" : "OFF"}
                    </button>
                    {cat.isCustom && (
                      <button onClick={() => deleteCustomCat(cat.id)}
                        style={{ padding: "4px 8px", background: "transparent", color: "#ef4444", border: "1px solid #ef4444", borderRadius: "6px", cursor: "pointer", fontSize: "12px" }}>
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Edit items panel */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid #334155", padding: "14px", background: "#060f1e", maxHeight: "420px", overflowY: "auto" }}>
                  {catItems.length === 0 ? (
                    <p style={{ color: "#64748b", fontSize: "13px", margin: 0 }}>No items in this category yet.</p>
                  ) : (
                    <>
                      <p style={{ color: "#64748b", fontSize: "12px", margin: "0 0 12px" }}>
                        Edits are saved to this project only — other projects are not affected.
                      </p>
                      <div style={{ display: "grid", gap: "8px", marginBottom: "14px" }}>
                        {catItems.map((item, idx) => (
                          <div key={item.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                            <span style={{ color: "#64748b", fontSize: "11px", paddingTop: "10px", flexShrink: 0, minWidth: "22px", textAlign: "right" }}>{idx + 1}.</span>
                            <textarea
                              value={localEdits[item.id] ?? item.item_text}
                              onChange={(e) => setLocalEdits((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              rows={2}
                              style={{ ...inputStyle, fontSize: "13px", resize: "vertical", borderColor: localEdits[item.id] !== undefined ? "#0095da" : "#334155" }}
                            />
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button onClick={saveEdits} disabled={savingEdits || !hasEdits}
                          style={{ padding: "7px 16px", background: hasEdits ? "#0095da" : "#334155", color: "white", border: "none", borderRadius: "6px", cursor: hasEdits && !savingEdits ? "pointer" : "not-allowed", fontSize: "13px", fontWeight: "600" }}>
                          {savingEdits ? "Saving..." : hasEdits ? `Save ${Object.keys(localEdits).length} Change(s)` : "No Changes"}
                        </button>
                        {hasEdits && (
                          <button onClick={() => setLocalEdits({})}
                            style={{ padding: "7px 14px", background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>
                            Reset
                          </button>
                        )}
                      </div>
                    </>
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

// ── Members tab ────────────────────────────────────────────────────────────
function MembersTab({ project, session, userRole }) {
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("engineer");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [myProfile, setMyProfile] = useState(null);
  // QR invite token
  const [inviteToken, setInviteToken] = useState(null);
  const [qrRole, setQrRole] = useState("engineer");
  const [generatingToken, setGeneratingToken] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchMembers();
    fetchMyProfile();
    fetchInviteToken();
  }, []);

  const fetchMyProfile = async () => {
    const { data } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).single();
    setMyProfile(data);
  };

  const fetchMembers = async () => {
    const { data: rows } = await supabase.from("project_members")
      .select("id, user_id, role").eq("project_id", project.id);
    if (!rows) { setLoading(false); return; }
    const ids = rows.map((r) => r.user_id);
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    const pMap = {};
    profiles?.forEach((p) => { pMap[p.id] = p; });
    setMembers(rows.map((r) => ({ ...r, profile: pMap[r.user_id] })));
    setLoading(false);
  };

  const fetchInviteToken = async () => {
    const { data } = await supabase
      .from("project_invite_tokens")
      .select("*")
      .eq("project_id", project.id)
      .eq("created_by", session.user.id)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) { setInviteToken(data); setQrRole(data.role); }
  };

  const invite = async (e) => {
    e.preventDefault();
    setInviting(true);
    setError("");

    const trimmedEmail = email.toLowerCase().trim();
    const inviterName = myProfile?.full_name || session.user.email;
    const appBase = window.location.origin + window.location.pathname;

    const { data: found } = await supabase.from("profiles")
      .select("id, full_name, email").eq("email", trimmedEmail).single();

    if (!found) {
      setError("No registered user found with that email. They must create an account first.");
      setInviting(false);
      return;
    }

    if (members.find((m) => m.user_id === found.id)) {
      setError("This user is already a member of this project.");
      setInviting(false);
      return;
    }

    const { error: err } = await supabase.from("project_members").insert({
      project_id: project.id, user_id: found.id, role, invited_by: session.user.id,
    });

    if (err) { setError(err.message); setInviting(false); return; }

    // In-app notification for the invitee
    await supabase.from("notifications").insert({
      user_id: found.id,
      project_id: project.id,
      type: "project_invite",
      title: `You've been added to "${project.name}"`,
      body: `${inviterName} added you as ${role.replace(/_/g, " ")}. Open your projects to get started.`,
    });

    // Email the registered user too
    try {
      await supabase.functions.invoke("send-invite-email", {
        body: {
          to: found.email || trimmedEmail,
          inviteeName: found.full_name,
          inviterName,
          projectName: project.name,
          role,
          appUrl: appBase,
          isNewUser: false,
        },
      });
    } catch (_) { /* silent */ }

    setEmail("");
    fetchMembers();
    setInviting(false);
  };

  const generateToken = async () => {
    setGeneratingToken(true);
    // Remove old tokens for this project by this user
    await supabase.from("project_invite_tokens")
      .delete().eq("project_id", project.id).eq("created_by", session.user.id);
    const { data } = await supabase.from("project_invite_tokens")
      .insert({ project_id: project.id, role: qrRole, created_by: session.user.id })
      .select().single();
    setInviteToken(data);
    setShowQR(true);
    setGeneratingToken(false);
  };

  const inviteUrl = inviteToken
    ? `${window.location.origin}${window.location.pathname}?invite=${inviteToken.token}`
    : "";

  const copyLink = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updateRole = async (memberId, newRole) => {
    const { error } = await supabase.from("project_members").update({ role: newRole }).eq("id", memberId);
    if (!error) setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, role: newRole } : m));
  };

  const removeMember = async (memberId) => {
    await supabase.from("project_members").delete().eq("id", memberId);
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  return (
    <div>
      <p style={{ color: "#94a3b8", fontSize: "13px", marginTop: 0, marginBottom: "16px" }}>
        Invite registered members by email, or share a QR code for anyone to join.
      </p>

      {/* Invite by email */}
      <form onSubmit={invite} style={{ background: "#0f172a", borderRadius: "8px", padding: "16px", marginBottom: "16px", border: "1px solid #334155" }}>
        <p style={{ color: "#33bdef", fontSize: "12px", fontWeight: "700", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Invite by Email</p>
        {error && (
          <div style={{ color: "#fca5a5", fontSize: "13px", marginBottom: "12px", background: "#450a0a", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ef4444" }}>
            {error}
          </div>
        )}
        <div style={{ display: "grid", gap: "12px" }}>
          <div>
            <label style={labelStyle}>Email address</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              placeholder="colleague@example.com" style={inputStyle} />
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
                <option value="project_manager">Project Manager</option>
                <option value="engineer">Engineer</option>
                <option value="drafter">Drafter</option>
              </select>
            </div>
            <button type="submit" disabled={inviting} style={{
              padding: "10px 16px", background: "#0095da", color: "white", border: "none",
              borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "600", whiteSpace: "nowrap", flexShrink: 0,
            }}>
              {inviting ? "Inviting..." : "Invite"}
            </button>
          </div>
        </div>
      </form>

      {/* QR Code invite */}
      <div style={{ background: "#0f172a", borderRadius: "8px", padding: "16px", marginBottom: "20px", border: "1px solid #334155" }}>
        <p style={{ color: "#33bdef", fontSize: "12px", fontWeight: "700", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>QR Code Invite Link</p>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", marginBottom: "14px" }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Role for QR invitees</label>
            <select value={qrRole} onChange={(e) => setQrRole(e.target.value)} style={inputStyle}>
              <option value="project_manager">Project Manager</option>
              <option value="engineer">Engineer</option>
              <option value="drafter">Drafter</option>
            </select>
          </div>
          <button onClick={generatingToken ? undefined : generateToken} disabled={generatingToken} style={{
            padding: "10px 16px", background: "#29439b", color: "white", border: "none",
            borderRadius: "8px", cursor: generatingToken ? "not-allowed" : "pointer",
            fontSize: "13px", fontWeight: "600", whiteSpace: "nowrap", flexShrink: 0,
          }}>
            {generatingToken ? "..." : inviteToken ? "↻ Regenerate" : "Generate QR"}
          </button>
        </div>

        {inviteToken && (
          <>
            <button
              onClick={() => setShowQR((v) => !v)}
              style={{ width: "100%", padding: "8px", background: showQR ? "#012d5a" : "#1e293b", color: showQR ? "#33bdef" : "#94a3b8", border: `1px solid ${showQR ? "#0095da" : "#334155"}`, borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600", marginBottom: showQR ? "14px" : 0 }}>
              {showQR ? "▲ Hide QR Code" : "▼ Show QR Code"}
            </button>

            {showQR && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
                <div style={{ background: "white", padding: "12px", borderRadius: "10px", display: "inline-block" }}>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(inviteUrl)}`}
                    alt="QR invite code"
                    width={200} height={200}
                    style={{ display: "block" }}
                  />
                </div>
                <div style={{ width: "100%", background: "#1e293b", borderRadius: "6px", padding: "8px 12px", border: "1px solid #334155", display: "flex", gap: "8px", alignItems: "center" }}>
                  <span style={{ flex: 1, fontSize: "11px", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inviteUrl}</span>
                  <button onClick={copyLink} style={{ padding: "4px 12px", background: copied ? "#1a3318" : "#012d5a", color: copied ? "#7ecb7b" : "#33bdef", border: `1px solid ${copied ? "#4da447" : "#0095da"}`, borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600", flexShrink: 0 }}>
                    {copied ? "✓ Copied" : "Copy"}
                  </button>
                </div>
                <p style={{ color: "#64748b", fontSize: "11px", margin: 0, textAlign: "center" }}>
                  Expires {new Date(inviteToken.expires_at).toLocaleDateString()} · Role: <strong style={{ color: "#94a3b8" }}>{qrRole.replace(/_/g, " ")}</strong>
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Members list */}
      {loading ? (
        <p style={{ color: "#94a3b8" }}>Loading members...</p>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {members.map((m) => (
            <div key={m.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 16px", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155", flexWrap: "wrap", gap: "8px",
            }}>
              <div>
                <span style={{ color: "#f1f5f9", fontSize: "14px", fontWeight: "600" }}>{m.profile?.full_name || "Unknown"}</span>
                <span style={{ color: "#64748b", fontSize: "12px", marginLeft: "8px" }}>{m.profile?.email}</span>
                {m.user_id === session.user.id && <span style={{ color: "#64748b", fontSize: "11px", marginLeft: "6px" }}>(you)</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select value={m.role} onChange={(e) => updateRole(m.id, e.target.value)}
                  disabled={userRole !== "project_manager" || m.user_id === session.user.id}
                  style={{ background: "#1e293b", border: "1px solid #334155", color: "#f1f5f9", borderRadius: "6px", padding: "5px 8px", fontSize: "12px" }}>
                  <option value="project_manager">Project Manager</option>
                  <option value="engineer">Engineer</option>
                  <option value="drafter">Drafter</option>
                </select>
                {userRole === "project_manager" && m.user_id !== session.user.id && (
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

// ── Custom Items tab ───────────────────────────────────────────────────────
function CustomItemsTab({ project }) {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState(CATEGORIES[0].id);
  const [subSection, setSubSection] = useState("");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState("DD");
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    const { data } = await supabase.from("checklists")
      .select("*").eq("project_id", project.id).eq("is_custom", true).order("created_at", { ascending: false });
    setItems(data || []);
  };

  const add = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from("checklists").insert({
      project_id: project.id,
      item_id: `custom-${Date.now()}`,
      category, sub_section: subSection || null, phase, item_text: text,
      status: "pending", is_custom: true,
    });
    if (!error) { setText(""); setSubSection(""); fetchItems(); }
    setSaving(false);
  };

  const remove = async (id) => {
    await supabase.from("checklists").delete().eq("id", id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  return (
    <div>
      <p style={{ color: "#94a3b8", fontSize: "14px", marginTop: 0 }}>
        Add project-specific checklist items to any category.
      </p>

      <form onSubmit={add} style={{ background: "#0f172a", borderRadius: "8px", padding: "16px", marginBottom: "20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Phase</label>
            <select value={phase} onChange={(e) => setPhase(e.target.value)} style={inputStyle}>
              {["SD", "DD", "CD"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: "12px" }}>
          <label style={labelStyle}>Sub-section (optional)</label>
          <input value={subSection} onChange={(e) => setSubSection(e.target.value)}
            placeholder="e.g. Design & analysis" style={inputStyle} />
        </div>
        <div style={{ marginBottom: "12px" }}>
          <label style={labelStyle}>Check description *</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} required rows={2}
            placeholder="Describe what needs to be verified..." style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <button type="submit" disabled={saving} style={{
          padding: "8px 16px", background: "#0095da", color: "white", border: "none",
          borderRadius: "6px", cursor: "pointer", fontSize: "14px", fontWeight: "600",
        }}>
          {saving ? "Adding..." : "+ Add Item"}
        </button>
      </form>

      {items.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: "14px" }}>No custom items yet.</p>
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {items.map((item) => (
            <div key={item.id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              padding: "12px 16px", background: "#0f172a", borderRadius: "8px", border: "1px solid #334155",
            }}>
              <div style={{ flex: 1 }}>
                <p style={{ color: "#f1f5f9", fontSize: "14px", margin: "0 0 4px" }}>{item.item_text}</p>
                <span style={{ fontSize: "12px", color: "#0095da" }}>
                  {CATEGORIES.find((c) => c.id === item.category)?.label}
                  {item.sub_section ? ` · ${item.sub_section}` : ""}
                  {item.phase ? ` · Phase ${item.phase}` : ""}
                  {" · Custom"}
                </span>
              </div>
              <button onClick={() => remove(item.id)}
                style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "20px", marginLeft: "12px", lineHeight: 1 }}>
                ×
              </button>
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
const TABS = ["General", "Checklists", "Milestones", "Members", "Custom Items"];
const TAB_SHORT = ["General", "Lists", "Miles.", "Members", "Custom"];

export default function ProjectSetupModal({ project, session, userRole, onClose, onProjectRenamed }) {
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
          {tab === "Checklists" && <ChecklistsTab project={project} />}
          {tab === "Milestones" && <MilestonesTab project={project} />}
          {tab === "Members" && <MembersTab project={project} session={session} userRole={userRole} />}
          {tab === "Custom Items" && <CustomItemsTab project={project} />}
        </div>
      </div>
    </div>
  );
}
