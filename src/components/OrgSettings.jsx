import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { CATEGORIES, CHECKLIST_TEMPLATE } from "../checklistTemplate";
import { useIsMobile } from "../useIsMobile";

const inputStyle = {
  width: "100%", padding: "10px 12px", background: "#0f172a",
  border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9",
  fontSize: "14px", boxSizing: "border-box", fontFamily: "Manrope, sans-serif",
};
const labelStyle = { display: "block", color: "#94a3b8", fontSize: "13px", marginBottom: "6px" };

// ── Organization tab ────────────────────────────────────────────────────────
function OrgTab({ org, orgRole, onOrgRenamed }) {
  const [name, setName] = useState(org.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === org.name) return;
    setSaving(true);
    const { error } = await supabase.from("organizations").update({ name: name.trim() }).eq("id", org.id);
    if (!error) { onOrgRenamed(name.trim()); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    setSaving(false);
  };

  return (
    <div style={{ maxWidth: "480px" }}>
      <h3 style={{ color: "#f1f5f9", margin: "0 0 20px", fontSize: "16px" }}>Organization Details</h3>
      <form onSubmit={save}>
        <div style={{ marginBottom: "20px" }}>
          <label style={labelStyle}>Organization Name</label>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            disabled={orgRole !== "admin"} style={inputStyle}
          />
        </div>
        {orgRole === "admin" && (
          <button type="submit" disabled={saving || !name.trim() || name.trim() === org.name} style={{
            padding: "10px 24px", background: "#0095da", color: "white", border: "none",
            borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "600", fontFamily: "Manrope, sans-serif",
          }}>
            {saved ? "✓ Saved" : saving ? "Saving..." : "Save Changes"}
          </button>
        )}
        {orgRole !== "admin" && (
          <p style={{ color: "#64748b", fontSize: "13px", margin: 0 }}>Only admins can edit organization settings.</p>
        )}
      </form>
    </div>
  );
}

// ── Members tab ─────────────────────────────────────────────────────────────
function MembersTab({ org, session, orgRole }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const [myProfile, setMyProfile] = useState(null);

  useEffect(() => { fetchMembers(); fetchMyProfile(); }, []);

  const fetchMyProfile = async () => {
    const { data } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).single();
    setMyProfile(data);
  };

  const fetchMembers = async () => {
    setLoading(true);
    const { data: rows } = await supabase.from("organization_members")
      .select("id, user_id, role").eq("organization_id", org.id).order("created_at");
    if (!rows) { setLoading(false); return; }
    const ids = rows.map((r) => r.user_id);
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    const pMap = {};
    (profiles || []).forEach((p) => { pMap[p.id] = p; });
    setMembers(rows.map((r) => ({ ...r, profile: pMap[r.user_id] })));
    setLoading(false);
  };

  const invite = async (e) => {
    e.preventDefault();
    setInviting(true);
    setError("");
    const trimmed = email.toLowerCase().trim();
    const { data: found } = await supabase.from("profiles")
      .select("id, full_name, email").eq("email", trimmed).single();
    if (!found) {
      setError("No registered user found with that email. They must create an account first.");
      setInviting(false);
      return;
    }
    if (members.find((m) => m.user_id === found.id)) {
      setError("This user is already a member of this organization.");
      setInviting(false);
      return;
    }
    const { error: err } = await supabase.from("organization_members").insert({
      organization_id: org.id, user_id: found.id, role: inviteRole, invited_by: session.user.id,
    });
    if (err) { setError(err.message); setInviting(false); return; }

    // In-app notification
    const inviterName = myProfile?.full_name || session.user.email;
    await supabase.from("notifications").insert({
      user_id: found.id,
      type: "project_invite",
      title: `You've been added to "${org.name}"`,
      body: `${inviterName} added you to the organization as ${inviteRole}.`,
    });

    // Email (silent fail)
    try {
      await supabase.functions.invoke("send-invite-email", {
        body: {
          to: found.email, inviteeName: found.full_name, inviterName,
          projectName: org.name, role: inviteRole,
          appUrl: window.location.origin + window.location.pathname,
          isNewUser: false,
        },
      });
    } catch (_) {}

    setEmail("");
    fetchMembers();
    setInviting(false);
  };

  const updateRole = async (memberId, newRole) => {
    const { error } = await supabase.from("organization_members").update({ role: newRole }).eq("id", memberId);
    if (!error) setMembers((prev) => prev.map((m) => m.id === memberId ? { ...m, role: newRole } : m));
  };

  const removeMember = async (memberId) => {
    if (!window.confirm("Remove this member from the organization?")) return;
    await supabase.from("organization_members").delete().eq("id", memberId);
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  };

  return (
    <div>
      <h3 style={{ color: "#f1f5f9", margin: "0 0 20px", fontSize: "16px" }}>Organization Members</h3>

      {/* Invite form (admin only) */}
      {orgRole === "admin" && (
        <form onSubmit={invite} style={{ background: "#0f172a", borderRadius: "8px", padding: "16px", marginBottom: "20px", border: "1px solid #334155" }}>
          <p style={{ color: "#33bdef", fontSize: "12px", fontWeight: "700", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Invite Member</p>
          {error && (
            <div style={{ color: "#fca5a5", fontSize: "13px", marginBottom: "12px", background: "#450a0a", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ef4444" }}>{error}</div>
          )}
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 2, minWidth: "180px" }}>
              <label style={labelStyle}>Email address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="colleague@example.com" style={inputStyle} />
            </div>
            <div style={{ flex: 1, minWidth: "130px" }}>
              <label style={labelStyle}>Role</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={inputStyle}>
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
            </div>
            <button type="submit" disabled={inviting} style={{
              padding: "10px 18px", background: "#0095da", color: "white", border: "none",
              borderRadius: "8px", cursor: inviting ? "not-allowed" : "pointer", fontSize: "14px",
              fontWeight: "600", whiteSpace: "nowrap", flexShrink: 0, fontFamily: "Manrope, sans-serif",
            }}>
              {inviting ? "Inviting..." : "Invite"}
            </button>
          </div>
        </form>
      )}

      {/* Members list */}
      {loading ? (
        <p style={{ color: "#94a3b8" }}>Loading members...</p>
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
                  disabled={orgRole !== "admin" || m.user_id === session.user.id}
                  style={{ background: "#1e293b", border: "1px solid #334155", color: "#f1f5f9", borderRadius: "6px", padding: "5px 8px", fontSize: "12px" }}>
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                </select>
                {orgRole === "admin" && m.user_id !== session.user.id && (
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

// ── Checklists tab ───────────────────────────────────────────────────────────
function ChecklistsTab({ org, orgRole }) {
  const [config, setConfig] = useState({});
  const [customCats, setCustomCats] = useState([]); // [{id, label, sort_order}]
  const [items, setItems] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState(null);
  const [renamingCat, setRenamingCat] = useState(null);
  const [renameText, setRenameText] = useState("");
  const [editingItemId, setEditingItemId] = useState(null);
  const [editItemText, setEditItemText] = useState("");
  const [addingTo, setAddingTo] = useState(null);
  const [newItemText, setNewItemText] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);
  const dragCat = useRef(null);
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [savingCat, setSavingCat] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    const [{ data: cfgData }, { data: itemData }] = await Promise.all([
      supabase.from("org_checklist_config").select("*").eq("organization_id", org.id).order("sort_order"),
      supabase.from("org_checklist_items").select("*").eq("organization_id", org.id).order("sort_order"),
    ]);
    const cfgMap = {};
    const customs = [];
    (cfgData || []).forEach((r) => {
      cfgMap[r.category] = { enabled: r.enabled, label: r.label, is_custom: r.is_custom };
      if (r.is_custom) customs.push({ id: r.category, label: r.label, sort_order: r.sort_order });
    });
    setConfig(cfgMap);
    setCustomCats(customs.sort((a, b) => a.sort_order - b.sort_order));

    const itemMap = {};
    (itemData || []).forEach((r) => {
      if (!itemMap[r.category]) itemMap[r.category] = [];
      itemMap[r.category].push(r);
    });
    setItems(itemMap);
    setLoading(false);
  };

  const addCustomCategory = async () => {
    if (!newCatName.trim()) return;
    setSavingCat(true);
    const catId = `org_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const maxOrder = customCats.reduce((m, c) => Math.max(m, c.sort_order ?? 0), CATEGORIES.length);
    await supabase.from("org_checklist_config").insert({
      organization_id: org.id, category: catId,
      label: newCatName.trim(), enabled: true,
      is_custom: true, sort_order: maxOrder + 1,
    });
    setCustomCats((p) => [...p, { id: catId, label: newCatName.trim(), sort_order: maxOrder + 1 }]);
    setConfig((p) => ({ ...p, [catId]: { enabled: true, label: newCatName.trim(), is_custom: true } }));
    setItems((p) => ({ ...p, [catId]: [] }));
    setNewCatName(""); setAddingCat(false); setSavingCat(false);
  };

  const deleteCustomCategory = async (catId) => {
    if (!window.confirm("Delete this checklist and all its items? This cannot be undone.")) return;
    await Promise.all([
      supabase.from("org_checklist_items").delete().eq("organization_id", org.id).eq("category", catId),
      supabase.from("org_checklist_config").delete().eq("organization_id", org.id).eq("category", catId),
    ]);
    setCustomCats((p) => p.filter((c) => c.id !== catId));
    setConfig((p) => { const n = { ...p }; delete n[catId]; return n; });
    setItems((p) => { const n = { ...p }; delete n[catId]; return n; });
    if (expandedCat === catId) setExpandedCat(null);
  };

  // Copy template items for a category into org_checklist_items (lazy init)
  const initCategory = async (catId) => {
    const templateItems = CHECKLIST_TEMPLATE.filter((i) => i.category === catId);
    if (!templateItems.length) { setItems((p) => ({ ...p, [catId]: [] })); return []; }
    const toInsert = templateItems.map((t, idx) => ({
      organization_id: org.id, category: catId,
      item_id: t.item_id, item_text: t.text, sort_order: idx, enabled: true,
    }));
    const { data: inserted } = await supabase.from("org_checklist_items").insert(toInsert).select();
    const result = inserted || toInsert;
    setItems((p) => ({ ...p, [catId]: result }));
    return result;
  };

  const expandCat = async (catId) => {
    if (expandedCat === catId) { setExpandedCat(null); return; }
    setExpandedCat(catId);
    if (!items[catId]) await initCategory(catId);
  };

  const toggleCategory = async (catId) => {
    if (orgRole !== "admin") return;
    const newEnabled = !(config[catId]?.enabled !== false);
    setConfig((p) => ({ ...p, [catId]: { ...p[catId], enabled: newEnabled } }));
    await supabase.from("org_checklist_config").upsert(
      { organization_id: org.id, category: catId, enabled: newEnabled, label: config[catId]?.label || null },
      { onConflict: "organization_id,category" }
    );
  };

  const saveCategoryRename = async (catId) => {
    if (!renameText.trim()) { setRenamingCat(null); return; }
    await supabase.from("org_checklist_config").upsert(
      { organization_id: org.id, category: catId, label: renameText.trim(), enabled: config[catId]?.enabled !== false },
      { onConflict: "organization_id,category" }
    );
    setConfig((p) => ({ ...p, [catId]: { ...p[catId], label: renameText.trim() } }));
    setRenamingCat(null);
  };

  const saveItemEdit = async (item) => {
    if (!editItemText.trim()) { setEditingItemId(null); return; }
    await supabase.from("org_checklist_items").update({ item_text: editItemText.trim() }).eq("id", item.id);
    setItems((p) => ({ ...p, [item.category]: p[item.category].map((i) => i.id === item.id ? { ...i, item_text: editItemText.trim() } : i) }));
    setEditingItemId(null);
  };

  const removeItem = async (item) => {
    if (!window.confirm("Remove this item from the default checklist?")) return;
    await supabase.from("org_checklist_items").delete().eq("id", item.id);
    setItems((p) => ({ ...p, [item.category]: p[item.category].filter((i) => i.id !== item.id) }));
  };

  const addItem = async (catId) => {
    if (!newItemText.trim()) return;
    const catItems = items[catId] || [];
    const maxOrder = catItems.reduce((m, i) => Math.max(m, i.sort_order), -1);
    const { data: newItem } = await supabase.from("org_checklist_items").insert({
      organization_id: org.id, category: catId,
      item_id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      item_text: newItemText.trim(), sort_order: maxOrder + 1, enabled: true,
    }).select().single();
    if (newItem) setItems((p) => ({ ...p, [catId]: [...(p[catId] || []), newItem] }));
    setNewItemText(""); setAddingTo(null);
  };

  const handleDrop = async (catId, toIdx) => {
    if (dragIdx === null || dragIdx === toIdx || dragCat.current !== catId) return;
    const arr = [...(items[catId] || [])];
    const [moved] = arr.splice(dragIdx, 1);
    arr.splice(toIdx, 0, moved);
    const reordered = arr.map((item, idx) => ({ ...item, sort_order: idx }));
    setItems((p) => ({ ...p, [catId]: reordered }));
    setDragIdx(null); setDropIdx(null); dragCat.current = null;
    await Promise.all(reordered.map((item) =>
      supabase.from("org_checklist_items").update({ sort_order: item.sort_order }).eq("id", item.id)
    ));
  };

  const getLabel = (cat) => config[cat.id]?.label || cat.label;

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading...</p>;

  const allCats = [
    ...CATEGORIES.map((c) => ({ ...c, isCustom: false })),
    ...customCats.map((c) => ({ id: c.id, label: config[c.id]?.label || c.label, isCustom: true })),
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h3 style={{ color: "#f1f5f9", margin: "0 0 4px", fontSize: "16px" }}>Default Checklists</h3>
          <p style={{ color: "#64748b", fontSize: "13px", margin: 0 }}>
            {orgRole === "admin"
              ? "Customize categories and items. New projects inherit these defaults."
              : "Default checklist configuration for this organization."}
          </p>
        </div>
        {orgRole === "admin" && (
          <button onClick={() => setAddingCat(true)} style={{
            padding: "8px 16px", background: "#0095da", color: "white", border: "none",
            borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600",
            fontFamily: "Manrope, sans-serif", flexShrink: 0,
          }}>
            + Add Checklist
          </button>
        )}
      </div>

      {/* New checklist form */}
      {addingCat && (
        <div style={{ background: "#0f172a", border: "1px solid #0095da", borderRadius: "10px", padding: "14px 16px", marginBottom: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCustomCategory(); if (e.key === "Escape") { setAddingCat(false); setNewCatName(""); } }}
            placeholder="Checklist name (e.g. MEP Coordination)"
            style={{ flex: 1, padding: "8px 12px", background: "#1e293b", border: "1px solid #0095da", borderRadius: "7px", color: "#f1f5f9", fontSize: "14px", fontFamily: "Manrope, sans-serif" }}
          />
          <button onClick={addCustomCategory} disabled={savingCat || !newCatName.trim()} style={{
            padding: "8px 16px", background: "#0095da", color: "white", border: "none",
            borderRadius: "7px", cursor: savingCat ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: "600",
          }}>
            {savingCat ? "..." : "Create"}
          </button>
          <button onClick={() => { setAddingCat(false); setNewCatName(""); }} style={{
            padding: "8px 12px", background: "transparent", border: "1px solid #334155",
            color: "#94a3b8", borderRadius: "7px", cursor: "pointer", fontSize: "13px",
          }}>×</button>
        </div>
      )}

      <div style={{ display: "grid", gap: "8px" }}>
        {allCats.map((cat) => {
          const enabled = config[cat.id]?.enabled !== false;
          const isExpanded = expandedCat === cat.id;
          const catItems = items[cat.id];
          const isRenamingThis = renamingCat === cat.id;

          return (
            <div key={cat.id} style={{
              background: "#0f172a", borderRadius: "10px",
              border: `1px solid ${isExpanded ? "#0095da" : enabled ? "#334155" : "#1e293b"}`,
              overflow: "hidden", opacity: enabled ? 1 : 0.6,
            }}>
              {/* Category header row */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px" }}>
                {orgRole === "admin" && (
                  <button onClick={() => toggleCategory(cat.id)} style={{
                    padding: "3px 10px", borderRadius: "20px", border: "1px solid",
                    fontSize: "10px", fontWeight: "700", cursor: "pointer", flexShrink: 0,
                    background: enabled ? "#1a3318" : "#1e293b",
                    borderColor: enabled ? "#4da447" : "#334155",
                    color: enabled ? "#7ecb7b" : "#64748b",
                  }}>
                    {enabled ? "ON" : "OFF"}
                  </button>
                )}

                {/* Category name / rename inline */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isRenamingThis ? (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveCategoryRename(cat.id); if (e.key === "Escape") setRenamingCat(null); }}
                        style={{ flex: 1, padding: "5px 8px", background: "#1e293b", border: "1px solid #0095da", borderRadius: "6px", color: "#f1f5f9", fontSize: "13px" }}
                      />
                      <button onClick={() => saveCategoryRename(cat.id)} style={{ padding: "4px 10px", background: "#0095da", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>Save</button>
                      <button onClick={() => setRenamingCat(null)} style={{ padding: "4px 8px", background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}>×</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ color: "#f1f5f9", fontSize: "14px", fontWeight: "600" }}>{getLabel(cat)}</span>
                      {cat.isCustom && (
                        <span style={{ fontSize: "10px", color: "#0095da", background: "#012d5a", padding: "1px 7px", borderRadius: "20px", fontWeight: "600" }}>custom</span>
                      )}
                      {!cat.isCustom && config[cat.id]?.label && config[cat.id].label !== cat.label && (
                        <span style={{ color: "#64748b", fontSize: "11px" }}>({cat.label})</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                {orgRole === "admin" && !isRenamingThis && (
                  <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                    <button onClick={() => { setRenamingCat(cat.id); setRenameText(getLabel(cat)); }} style={{
                      padding: "3px 8px", background: "transparent", border: "1px solid #334155",
                      color: "#64748b", borderRadius: "5px", cursor: "pointer", fontSize: "11px",
                    }}>
                      Rename
                    </button>
                    {cat.isCustom && (
                      <button onClick={() => deleteCustomCategory(cat.id)} style={{
                        padding: "3px 7px", background: "transparent", border: "1px solid #334155",
                        color: "#ef4444", borderRadius: "5px", cursor: "pointer", fontSize: "11px",
                      }}>✕</button>
                    )}
                  </div>
                )}
                <button onClick={() => expandCat(cat.id)} style={{
                  background: "none", border: "none", color: isExpanded ? "#0095da" : "#64748b",
                  cursor: "pointer", padding: "4px 6px", fontSize: "13px", flexShrink: 0,
                }}>
                  {isExpanded ? "▲" : "▼"}
                </button>
              </div>

              {/* Expanded items section */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid #1e293b", padding: "12px 16px" }}>
                  {catItems === undefined ? (
                    <p style={{ color: "#94a3b8", fontSize: "13px", margin: 0 }}>Loading items...</p>
                  ) : (
                    <>
                      <div style={{ display: "grid", gap: "4px", marginBottom: catItems.length ? "10px" : "0" }}>
                        {catItems.map((item, idx) => (
                          <div
                            key={item.id}
                            draggable={orgRole === "admin" && editingItemId !== item.id}
                            onDragStart={() => { setDragIdx(idx); dragCat.current = cat.id; }}
                            onDragOver={(e) => { e.preventDefault(); setDropIdx(idx); }}
                            onDrop={() => handleDrop(cat.id, idx)}
                            onDragEnd={() => { setDragIdx(null); setDropIdx(null); dragCat.current = null; }}
                            style={{
                              display: "flex", alignItems: "center", gap: "8px",
                              padding: "7px 10px", borderRadius: "6px",
                              background: dropIdx === idx && dragIdx !== idx && dragCat.current === cat.id ? "#012d5a" : "#1e293b",
                              border: `1px solid ${dropIdx === idx && dragIdx !== idx && dragCat.current === cat.id ? "#0095da" : "#2d3f55"}`,
                              opacity: dragIdx === idx ? 0.35 : 1,
                              transition: "background 0.1s",
                            }}>
                            {orgRole === "admin" && (
                              <span style={{ color: "#475569", fontSize: "15px", cursor: "grab", userSelect: "none", flexShrink: 0 }}>⠿</span>
                            )}
                            {editingItemId === item.id ? (
                              <input autoFocus value={editItemText}
                                onChange={(e) => setEditItemText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveItemEdit(item); if (e.key === "Escape") setEditingItemId(null); }}
                                style={{ flex: 1, padding: "4px 8px", background: "#0f172a", border: "1px solid #0095da", borderRadius: "4px", color: "#f1f5f9", fontSize: "13px" }}
                              />
                            ) : (
                              <span style={{ flex: 1, color: "#cbd5e1", fontSize: "13px", lineHeight: 1.4 }}>{item.item_text}</span>
                            )}
                            {orgRole === "admin" && (
                              <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                                {editingItemId === item.id ? (
                                  <>
                                    <button onClick={() => saveItemEdit(item)} style={{ padding: "3px 8px", background: "#0095da", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "11px", fontWeight: "600" }}>Save</button>
                                    <button onClick={() => setEditingItemId(null)} style={{ padding: "3px 6px", background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: "4px", cursor: "pointer", fontSize: "11px" }}>×</button>
                                  </>
                                ) : (
                                  <>
                                    <button onClick={() => { setEditingItemId(item.id); setEditItemText(item.item_text); }} style={{ padding: "3px 8px", background: "transparent", border: "1px solid #334155", color: "#64748b", borderRadius: "4px", cursor: "pointer", fontSize: "11px" }}>Edit</button>
                                    <button onClick={() => removeItem(item)} style={{ padding: "3px 6px", background: "transparent", border: "1px solid #334155", color: "#ef4444", borderRadius: "4px", cursor: "pointer", fontSize: "11px" }}>✕</button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Add item */}
                      {orgRole === "admin" && (
                        addingTo === cat.id ? (
                          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "6px" }}>
                            <input autoFocus value={newItemText}
                              onChange={(e) => setNewItemText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") addItem(cat.id); if (e.key === "Escape") { setAddingTo(null); setNewItemText(""); } }}
                              placeholder="New item text..."
                              style={{ flex: 1, padding: "7px 10px", background: "#1e293b", border: "1px solid #0095da", borderRadius: "6px", color: "#f1f5f9", fontSize: "13px" }}
                            />
                            <button onClick={() => addItem(cat.id)} style={{ padding: "7px 14px", background: "#0095da", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>Add</button>
                            <button onClick={() => { setAddingTo(null); setNewItemText(""); }} style={{ padding: "7px 10px", background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>×</button>
                          </div>
                        ) : (
                          <button onClick={() => setAddingTo(cat.id)} style={{
                            width: "100%", padding: "7px", background: "transparent",
                            border: "1px dashed #334155", borderRadius: "6px", marginTop: "6px",
                            color: "#64748b", fontSize: "12px", cursor: "pointer", fontFamily: "Manrope, sans-serif",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0095da"; e.currentTarget.style.color = "#33bdef"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#64748b"; }}>
                            + Add Item
                          </button>
                        )
                      )}
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

// ── Main ─────────────────────────────────────────────────────────────────────
const TABS = ["Organization", "Members", "Checklists"];

export default function OrgSettings({ session, org, orgRole, onOrgRenamed }) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState("Organization");

  return (
    <div style={{ padding: isMobile ? "20px 16px" : "32px 28px", maxWidth: "760px", margin: "0 auto", fontFamily: "Manrope, sans-serif" }}>
      <h2 style={{ color: "#f1f5f9", margin: "0 0 24px", fontSize: isMobile ? "18px" : "22px", fontWeight: "700" }}>Settings</h2>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #334155", marginBottom: "28px", overflowX: "auto" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 20px", border: "none", background: "transparent", cursor: "pointer",
            fontSize: "14px", fontWeight: tab === t ? "600" : "400",
            color: tab === t ? "#0095da" : "#94a3b8",
            borderBottom: `2px solid ${tab === t ? "#0095da" : "transparent"}`,
            marginBottom: "-1px", whiteSpace: "nowrap", fontFamily: "Manrope, sans-serif",
          }}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Organization" && <OrgTab org={org} orgRole={orgRole} onOrgRenamed={onOrgRenamed} />}
      {tab === "Members" && <MembersTab org={org} session={session} orgRole={orgRole} />}
      {tab === "Checklists" && <ChecklistsTab org={org} orgRole={orgRole} />}
    </div>
  );
}
