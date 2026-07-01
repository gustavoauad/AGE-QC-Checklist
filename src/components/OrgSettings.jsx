import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { CATEGORIES, CHECKLIST_TEMPLATE } from "../checklistTemplate";
import { useIsMobile } from "../useIsMobile";

const inputStyle = {
  width: "100%", padding: "10px 12px", background: "var(--c-bg)",
  border: "1px solid #334155", borderRadius: "8px", color: "var(--c-text)",
  fontSize: "14px", boxSizing: "border-box", fontFamily: "Manrope, sans-serif",
};
const labelStyle = { display: "block", color: "var(--c-text-2)", fontSize: "13px", marginBottom: "6px" };

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
      <h3 style={{ color: "var(--c-text)", margin: "0 0 20px", fontSize: "16px" }}>Organization Details</h3>
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
            padding: "10px 24px", background: "var(--c-accent)", color: "white", border: "none",
            borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontWeight: "600", fontFamily: "Manrope, sans-serif",
          }}>
            {saved ? "✓ Saved" : saving ? "Saving..." : "Save Changes"}
          </button>
        )}
        {orgRole !== "admin" && (
          <p style={{ color: "var(--c-text-3)", fontSize: "13px", margin: 0 }}>Only admins can edit organization settings.</p>
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
      <h3 style={{ color: "var(--c-text)", margin: "0 0 20px", fontSize: "16px" }}>Organization Members</h3>

      {/* Invite form (admin only) */}
      {orgRole === "admin" && (
        <form onSubmit={invite} style={{ background: "var(--c-bg)", borderRadius: "8px", padding: "16px", marginBottom: "20px", border: "1px solid #334155" }}>
          <p style={{ color: "var(--c-accent-lt)", fontSize: "12px", fontWeight: "700", margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Invite Member</p>
          {error && (
            <div style={{ color: "var(--c-err-text)", fontSize: "13px", marginBottom: "12px", background: "var(--c-err-bg)", padding: "8px 12px", borderRadius: "6px", border: "1px solid #ef4444" }}>{error}</div>
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
              padding: "10px 18px", background: "var(--c-accent)", color: "white", border: "none",
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
        <p style={{ color: "var(--c-text-2)" }}>Loading members...</p>
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
                  disabled={orgRole !== "admin" || m.user_id === session.user.id}
                  style={{ background: "var(--c-surface)", border: "1px solid #334155", color: "var(--c-text)", borderRadius: "6px", padding: "5px 8px", fontSize: "12px" }}>
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                </select>
                {orgRole === "admin" && m.user_id !== session.user.id && (
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

// ── Checklists tab ───────────────────────────────────────────────────────────
function ChecklistsTab({ org, orgRole }) {
  const isMobile = useIsMobile();
  const [config, setConfig] = useState({});
  const [customCats, setCustomCats] = useState([]);
  const [items, setItems] = useState({});
  const [sections, setSections] = useState({}); // { [catId]: [{label, sort_order}] }
  const [loading, setLoading] = useState(true);
  const [expandedCat, setExpandedCat] = useState(null);
  const [renamingCat, setRenamingCat] = useState(null);
  const [renameText, setRenameText] = useState("");
  const [editingItemId, setEditingItemId] = useState(null);
  const [editItemText, setEditItemText] = useState("");
  const [editItemHelpText, setEditItemHelpText] = useState("");
  const [editItemDays, setEditItemDays] = useState("");
  const [orgItemDeps, setOrgItemDeps] = useState({}); // { [itemId]: Set<depOnItemId> }
  const [depsPickerItemId, setDepsPickerItemId] = useState(null);
  const [depsPickerSearch, setDepsPickerSearch] = useState("");
  const [addingTo, setAddingTo] = useState(null); // { catId, section: string|null }
  const [newItemText, setNewItemText] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [savingCat, setSavingCat] = useState(false);
  const [addingSection, setAddingSection] = useState(null); // catId
  const [newSectionText, setNewSectionText] = useState("");
  const [renamingSection, setRenamingSection] = useState(null); // { catId, label }
  const [renameSectionText, setRenameSectionText] = useState("");
  const dragInfo = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    const [{ data: cfgData }, { data: itemData }, { data: sectionData }] = await Promise.all([
      supabase.from("org_checklist_config").select("*").eq("organization_id", org.id).order("sort_order"),
      supabase.from("org_checklist_items").select("*").eq("organization_id", org.id).order("sort_order"),
      supabase.from("org_checklist_sections").select("*").eq("organization_id", org.id).order("sort_order"),
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
    const sectionMap = {};
    (sectionData || []).forEach((r) => {
      if (!sectionMap[r.category]) sectionMap[r.category] = [];
      sectionMap[r.category].push({ label: r.label, sort_order: r.sort_order });
    });
    setSections(sectionMap);
    // Load org item dependencies
    const allOrgItemIds = (itemData || []).map((i) => i.id);
    if (allOrgItemIds.length > 0) {
      const { data: depsData } = await supabase
        .from("org_checklist_item_dependencies")
        .select("item_id, depends_on_item_id")
        .eq("org_id", org.id)
        .in("item_id", allOrgItemIds);
      const dMap = {};
      (depsData || []).forEach(({ item_id, depends_on_item_id }) => {
        if (!dMap[item_id]) dMap[item_id] = new Set();
        dMap[item_id].add(depends_on_item_id);
      });
      setOrgItemDeps(dMap);
    }
    setLoading(false);
  };

  // ── Push to project ─────────────────────────────────────────────────────────
  const [pushModal, setPushModal] = useState(null);
  const [orgProjects, setOrgProjects] = useState([]);
  const [selectedProjIds, setSelectedProjIds] = useState(new Set());
  const [pushStatus, setPushStatus] = useState("idle");
  const [pushError, setPushError] = useState("");
  const [conflictNames, setConflictNames] = useState([]);

  const openPushModal = async (cat) => {
    setPushModal({ catId: cat.id, catLabel: getLabel(cat) });
    setPushStatus("idle"); setSelectedProjIds(new Set()); setPushError(""); setConflictNames([]);
    if (!orgProjects.length) {
      const { data } = await supabase.from("projects")
        .select("id, name").eq("organization_id", org.id).is("archived_at", null).order("name");
      setOrgProjects(data || []);
    }
  };

  const toggleProject = (id) => setSelectedProjIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (selectedProjIds.size === orgProjects.length) {
      setSelectedProjIds(new Set());
    } else {
      setSelectedProjIds(new Set(orgProjects.map((p) => p.id)));
    }
  };

  const executePush = async (action) => {
    setPushStatus("pushing"); setPushError("");
    const { catId, catLabel } = pushModal;
    const catItems = items[catId] !== undefined ? items[catId] : await initCategory(catId);
    const catSections = sections[catId] || [];

    // Order items: sectioned items grouped by section order, then unsectioned
    const sectionOrder = catSections.map((s) => s.label);
    const sortedItems = [
      ...sectionOrder.flatMap((sl) => catItems.filter((i) => i.section === sl)),
      ...catItems.filter((i) => !i.section),
    ];

    const { error } = await supabase.rpc("push_checklist_to_projects", {
      p_project_ids: [...selectedProjIds],
      p_category:    catId,
      p_label:       catLabel,
      p_items:       sortedItems.map((i) => ({ item_id: i.item_id, item_text: i.item_text, section: i.section || null, help_text: i.help_text || null, days_before_milestone: i.days_before_milestone || null })),
      p_action:      action,
    });

    if (error) { setPushError(error.message); setPushStatus("conflict"); return; }
    setPushStatus("done");
  };

  const checkAndPush = async () => {
    if (selectedProjIds.size === 0) return;
    setPushStatus("checking");
    const ids = [...selectedProjIds];
    const { data: existing } = await supabase.from("checklists")
      .select("project_id").in("project_id", ids).eq("category", pushModal.catId).limit(ids.length);
    const conflictIds = new Set((existing || []).map((r) => r.project_id));
    if (conflictIds.size > 0) {
      setConflictNames(orgProjects.filter((p) => conflictIds.has(p.id)).map((p) => p.name));
      setPushStatus("conflict");
    } else {
      await executePush("overwrite_reset");
    }
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
    setSections((p) => ({ ...p, [catId]: [] }));
    setNewCatName(""); setAddingCat(false); setSavingCat(false);
  };

  const deleteCustomCategory = async (catId) => {
    if (!window.confirm("Delete this checklist and all its items? This cannot be undone.")) return;
    await Promise.all([
      supabase.from("org_checklist_items").delete().eq("organization_id", org.id).eq("category", catId),
      supabase.from("org_checklist_sections").delete().eq("organization_id", org.id).eq("category", catId),
      supabase.from("org_checklist_config").delete().eq("organization_id", org.id).eq("category", catId),
    ]);
    setCustomCats((p) => p.filter((c) => c.id !== catId));
    setConfig((p) => { const n = { ...p }; delete n[catId]; return n; });
    setItems((p) => { const n = { ...p }; delete n[catId]; return n; });
    setSections((p) => { const n = { ...p }; delete n[catId]; return n; });
    if (expandedCat === catId) setExpandedCat(null);
  };

  // Lazy-init: copy template items + sections into org tables on first expand
  const initCategory = async (catId) => {
    const templateItems = CHECKLIST_TEMPLATE.filter((i) => i.category === catId);
    if (!templateItems.length) {
      setItems((p) => ({ ...p, [catId]: [] }));
      setSections((p) => ({ ...p, [catId]: [] }));
      return [];
    }
    // Extract unique sections in first-appearance order
    const sectionLabels = [];
    const seen = new Set();
    templateItems.forEach((t) => {
      if (t.sub_section && !seen.has(t.sub_section)) { seen.add(t.sub_section); sectionLabels.push(t.sub_section); }
    });
    const toInsert = templateItems.map((t, idx) => ({
      organization_id: org.id, category: catId,
      item_id: t.item_id, item_text: t.text, sort_order: idx, enabled: true,
      section: t.sub_section || null,
    }));
    const { data: inserted } = await supabase.from("org_checklist_items").insert(toInsert).select();
    const result = inserted || toInsert;
    setItems((p) => ({ ...p, [catId]: result }));
    if (sectionLabels.length) {
      const sectionsToInsert = sectionLabels.map((label, idx) => ({
        organization_id: org.id, category: catId, label, sort_order: idx,
      }));
      const { data: insertedSections } = await supabase.from("org_checklist_sections").insert(sectionsToInsert).select();
      setSections((p) => ({
        ...p,
        [catId]: (insertedSections || sectionsToInsert).map((s) => ({ label: s.label, sort_order: s.sort_order })),
      }));
    } else {
      setSections((p) => ({ ...p, [catId]: [] }));
    }
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
    const updates = {
      item_text: editItemText.trim(),
      help_text: editItemHelpText.trim() || null,
      days_before_milestone: editItemDays !== "" ? parseInt(editItemDays, 10) : null,
    };
    await supabase.from("org_checklist_items").update(updates).eq("id", item.id);
    setItems((p) => ({ ...p, [item.category]: p[item.category].map((i) => i.id === item.id ? { ...i, ...updates } : i) }));
    setEditingItemId(null);
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

  const toggleOrgDep = async (itemId, depOnId, add) => {
    if (add && wouldCreateCycle(itemId, depOnId, orgItemDeps)) {
      alert("Cannot add this dependency — it would create a circular dependency.");
      return;
    }
    setOrgItemDeps((prev) => {
      const next = { ...prev };
      next[itemId] = new Set(next[itemId] || []);
      if (add) next[itemId].add(depOnId); else next[itemId].delete(depOnId);
      return next;
    });
    if (add) {
      supabase.from("org_checklist_item_dependencies").insert({ org_id: org.id, item_id: itemId, depends_on_item_id: depOnId });
    } else {
      supabase.from("org_checklist_item_dependencies").delete()
        .eq("org_id", org.id).eq("item_id", itemId).eq("depends_on_item_id", depOnId);
    }
  };

  const removeItem = async (item) => {
    if (!window.confirm("Remove this item from the default checklist?")) return;
    await supabase.from("org_checklist_items").delete().eq("id", item.id);
    setItems((p) => ({ ...p, [item.category]: p[item.category].filter((i) => i.id !== item.id) }));
  };

  const addItem = async (catId, section) => {
    if (!newItemText.trim()) return;
    const catItems = items[catId] || [];
    const maxOrder = catItems.reduce((m, i) => Math.max(m, i.sort_order ?? 0), -1);
    const { data: newItem } = await supabase.from("org_checklist_items").insert({
      organization_id: org.id, category: catId,
      item_id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      item_text: newItemText.trim(), sort_order: maxOrder + 1, enabled: true,
      section: section || null,
    }).select().single();
    if (newItem) setItems((p) => ({ ...p, [catId]: [...(p[catId] || []), newItem] }));
    setNewItemText(""); setAddingTo(null);
  };

  // ── Section CRUD ─────────────────────────────────────────────────────────────
  const addSection = async (catId) => {
    if (!newSectionText.trim()) return;
    const catSections = sections[catId] || [];
    const maxOrder = catSections.reduce((m, s) => Math.max(m, s.sort_order ?? 0), -1);
    const label = newSectionText.trim();
    await supabase.from("org_checklist_sections").insert({
      organization_id: org.id, category: catId, label, sort_order: maxOrder + 1,
    });
    setSections((p) => ({ ...p, [catId]: [...(p[catId] || []), { label, sort_order: maxOrder + 1 }] }));
    setNewSectionText(""); setAddingSection(null);
  };

  const renameSection = async (catId, oldLabel) => {
    const newLabel = renameSectionText.trim();
    if (!newLabel || newLabel === oldLabel) { setRenamingSection(null); return; }
    await supabase.from("org_checklist_sections")
      .update({ label: newLabel })
      .eq("organization_id", org.id).eq("category", catId).eq("label", oldLabel);
    await supabase.from("org_checklist_items")
      .update({ section: newLabel })
      .eq("organization_id", org.id).eq("category", catId).eq("section", oldLabel);
    setSections((p) => ({
      ...p,
      [catId]: (p[catId] || []).map((s) => s.label === oldLabel ? { ...s, label: newLabel } : s),
    }));
    setItems((p) => ({
      ...p,
      [catId]: (p[catId] || []).map((i) => i.section === oldLabel ? { ...i, section: newLabel } : i),
    }));
    setRenamingSection(null);
  };

  const deleteSection = async (catId, label) => {
    if (!window.confirm(`Remove section "${label}"? Items in it will become unsectioned.`)) return;
    await supabase.from("org_checklist_sections")
      .delete().eq("organization_id", org.id).eq("category", catId).eq("label", label);
    await supabase.from("org_checklist_items")
      .update({ section: null })
      .eq("organization_id", org.id).eq("category", catId).eq("section", label);
    setSections((p) => ({ ...p, [catId]: (p[catId] || []).filter((s) => s.label !== label) }));
    setItems((p) => ({
      ...p,
      [catId]: (p[catId] || []).map((i) => i.section === label ? { ...i, section: null } : i),
    }));
  };

  // ── Drag & drop ──────────────────────────────────────────────────────────────
  const handleSectionDragStart = (e, catId, label, fromIdx) => {
    e.stopPropagation();
    dragInfo.current = { type: "section", catId, label, fromIdx };
    e.dataTransfer.effectAllowed = "move";
  };

  const handleSectionDragOver = (e, catId, label, toIdx) => {
    e.preventDefault(); e.stopPropagation();
    if (dragInfo.current?.type === "section" && dragInfo.current?.catId === catId) {
      setDragOver(`so:${catId}:${toIdx}`);
    } else if (dragInfo.current?.type === "item" && dragInfo.current?.catId === catId) {
      setDragOver(`sh:${catId}:${label}`); // section header as item drop target
    }
  };

  const handleSectionDrop = (e, catId, label, toIdx) => {
    e.stopPropagation();
    if (dragInfo.current?.type === "section" && dragInfo.current?.catId === catId) {
      reorderSections(catId, dragInfo.current.label, toIdx);
    } else if (dragInfo.current?.type === "item" && dragInfo.current?.catId === catId) {
      assignItemToSection(catId, dragInfo.current.itemId, label);
    }
    dragInfo.current = null; setDragOver(null);
  };

  const reorderSections = async (catId, fromLabel, toIdx) => {
    const arr = [...(sections[catId] || [])];
    const fromIdx = arr.findIndex((s) => s.label === fromLabel);
    if (fromIdx === -1 || fromIdx === toIdx) return;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    const reordered = arr.map((s, idx) => ({ ...s, sort_order: idx }));
    setSections((p) => ({ ...p, [catId]: reordered }));
    await Promise.all(reordered.map((s) =>
      supabase.from("org_checklist_sections")
        .update({ sort_order: s.sort_order })
        .eq("organization_id", org.id).eq("category", catId).eq("label", s.label)
    ));
  };

  const assignItemToSection = async (catId, itemId, newSection) => {
    const catItems = items[catId] || [];
    const idx = catItems.findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    const updated = catItems.map((i) => i.id === itemId ? { ...i, section: newSection } : i);
    setItems((p) => ({ ...p, [catId]: updated }));
    await supabase.from("org_checklist_items").update({ section: newSection }).eq("id", itemId);
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
    arr.splice(toIdx, 0, { ...moved, section: targetSection || null });
    const reordered = arr.map((item, idx) => ({ ...item, sort_order: idx }));
    setItems((p) => ({ ...p, [catId]: reordered }));
    await Promise.all(reordered.map((item) =>
      supabase.from("org_checklist_items")
        .update({ sort_order: item.sort_order, section: item.section || null })
        .eq("id", item.id)
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
      supabase.from("org_checklist_items").update({ sort_order: item.sort_order }).eq("id", item.id)
    ));
  };

  const handleDragEnd = () => { dragInfo.current = null; setDragOver(null); };

  const getLabel = (cat) => config[cat.id]?.label || cat.label;

  if (loading) return <p style={{ color: "var(--c-text-2)" }}>Loading...</p>;

  const allCats = [
    ...CATEGORIES.map((c) => ({ ...c, isCustom: false })),
    ...customCats.map((c) => ({ id: c.id, label: config[c.id]?.label || c.label, isCustom: true })),
  ];

  const mBtn = (extra = {}) => ({
    padding: "3px 7px", background: "transparent", border: "1px solid #334155",
    color: "var(--c-text-3)", borderRadius: "4px", cursor: "pointer", fontSize: "11px",
    fontFamily: "Manrope, sans-serif", ...extra,
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <h3 style={{ color: "var(--c-text)", margin: "0 0 4px", fontSize: "16px" }}>Default Checklists</h3>
          <p style={{ color: "var(--c-text-3)", fontSize: "13px", margin: 0 }}>
            {orgRole === "admin"
              ? "Customize categories, sections, and items. New projects inherit these defaults."
              : "Default checklist configuration for this organization."}
          </p>
        </div>
        {orgRole === "admin" && (
          <button onClick={() => setAddingCat(true)} style={{
            padding: "8px 16px", background: "var(--c-accent)", color: "white", border: "none",
            borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600",
            fontFamily: "Manrope, sans-serif", flexShrink: 0,
          }}>
            + Add Checklist
          </button>
        )}
      </div>

      {/* New checklist form */}
      {addingCat && (
        <div style={{ background: "var(--c-bg)", border: "1px solid #0095da", borderRadius: "10px", padding: "14px 16px", marginBottom: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            autoFocus value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addCustomCategory(); if (e.key === "Escape") { setAddingCat(false); setNewCatName(""); } }}
            placeholder="Checklist name (e.g. MEP Coordination)"
            style={{ flex: 1, padding: "8px 12px", background: "var(--c-surface)", border: "1px solid #0095da", borderRadius: "7px", color: "var(--c-text)", fontSize: "14px", fontFamily: "Manrope, sans-serif" }}
          />
          <button onClick={addCustomCategory} disabled={savingCat || !newCatName.trim()} style={{
            padding: "8px 16px", background: "var(--c-accent)", color: "white", border: "none",
            borderRadius: "7px", cursor: savingCat ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: "600",
          }}>
            {savingCat ? "..." : "Create"}
          </button>
          <button onClick={() => { setAddingCat(false); setNewCatName(""); }} style={{
            padding: "8px 12px", background: "transparent", border: "1px solid #334155",
            color: "var(--c-text-2)", borderRadius: "7px", cursor: "pointer", fontSize: "13px",
          }}>×</button>
        </div>
      )}

      <div style={{ display: "grid", gap: "8px" }}>
        {allCats.map((cat) => {
          const enabled = config[cat.id]?.enabled !== false;
          const isExpanded = expandedCat === cat.id;
          const catItems = items[cat.id];
          const catSections = (sections[cat.id] || []).slice().sort((a, b) => a.sort_order - b.sort_order);
          const isRenamingThis = renamingCat === cat.id;

          return (
            <div key={cat.id} style={{
              background: "var(--c-bg)", borderRadius: "10px",
              border: `1px solid ${isExpanded ? "var(--c-accent)" : enabled ? "var(--c-border)" : "var(--c-surface)"}`,
              overflow: "hidden", opacity: enabled ? 1 : 0.6,
            }}>
              {/* Category header row */}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px" }}>
                {orgRole === "admin" && (
                  <button onClick={() => toggleCategory(cat.id)} style={{
                    padding: "3px 10px", borderRadius: "20px", border: "1px solid",
                    fontSize: "10px", fontWeight: "700", cursor: "pointer", flexShrink: 0,
                    background: enabled ? "var(--c-ok-bg)" : "var(--c-surface)",
                    borderColor: enabled ? "var(--c-ok)" : "var(--c-border)",
                    color: enabled ? "var(--c-ok-text)" : "var(--c-text-3)",
                  }}>
                    {enabled ? "ON" : "OFF"}
                  </button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isRenamingThis ? (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <input autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveCategoryRename(cat.id); if (e.key === "Escape") setRenamingCat(null); }}
                        style={{ flex: 1, padding: "5px 8px", background: "var(--c-surface)", border: "1px solid #0095da", borderRadius: "6px", color: "var(--c-text)", fontSize: "13px" }}
                      />
                      <button onClick={() => saveCategoryRename(cat.id)} style={{ padding: "4px 10px", background: "var(--c-accent)", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>Save</button>
                      <button onClick={() => setRenamingCat(null)} style={{ padding: "4px 8px", background: "transparent", border: "1px solid #334155", color: "var(--c-text-2)", borderRadius: "5px", cursor: "pointer", fontSize: "12px" }}>×</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ color: "var(--c-text)", fontSize: "14px", fontWeight: "600" }}>{getLabel(cat)}</span>
                      {cat.isCustom && (
                        <span style={{ fontSize: "10px", color: "var(--c-accent)", background: "var(--c-accent-dk)", padding: "1px 7px", borderRadius: "20px", fontWeight: "600" }}>custom</span>
                      )}
                      {!cat.isCustom && config[cat.id]?.label && config[cat.id].label !== cat.label && (
                        <span style={{ color: "var(--c-text-3)", fontSize: "11px" }}>({cat.label})</span>
                      )}
                    </div>
                  )}
                </div>
                {orgRole === "admin" && !isRenamingThis && (
                  <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                    <button onClick={() => openPushModal(cat)} style={{
                      padding: "3px 8px", background: "transparent", border: "1px solid #29439b",
                      color: "#818cf8", borderRadius: "5px", cursor: "pointer", fontSize: "11px",
                    }}>↗ Push</button>
                    <button onClick={() => { setRenamingCat(cat.id); setRenameText(getLabel(cat)); }} style={{
                      padding: "3px 8px", background: "transparent", border: "1px solid #334155",
                      color: "var(--c-text-3)", borderRadius: "5px", cursor: "pointer", fontSize: "11px",
                    }}>Rename</button>
                    {cat.isCustom && (
                      <button onClick={() => deleteCustomCategory(cat.id)} style={{
                        padding: "3px 7px", background: "transparent", border: "1px solid #334155",
                        color: "var(--c-err)", borderRadius: "5px", cursor: "pointer", fontSize: "11px",
                      }}>✕</button>
                    )}
                  </div>
                )}
                <button onClick={() => expandCat(cat.id)} style={{
                  background: "none", border: "none", color: isExpanded ? "var(--c-accent)" : "var(--c-text-3)",
                  cursor: "pointer", padding: "4px 6px", fontSize: "13px", flexShrink: 0,
                }}>
                  {isExpanded ? "▲" : "▼"}
                </button>
              </div>

              {/* Expanded items section */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid #1e293b", padding: "12px 16px" }}>
                  {catItems === undefined ? (
                    <p style={{ color: "var(--c-text-2)", fontSize: "13px", margin: 0 }}>Loading items...</p>
                  ) : (
                    <>
                      {/* ── Sections ─────────────────────────────────────── */}
                      {catSections.map((section, sIdx) => {
                        const sectionItems = catItems.filter((i) => i.section === section.label);
                        const isSectionDragTarget = dragOver === `sh:${cat.id}:${section.label}`;
                        const isOrderTarget = dragOver === `so:${cat.id}:${sIdx}`;
                        const isBeingDragged = dragInfo.current?.type === "section" && dragInfo.current?.label === section.label;
                        const isRenamingThisSection = renamingSection?.catId === cat.id && renamingSection?.label === section.label;

                        return (
                          <div key={section.label} style={{ marginBottom: "10px", opacity: isBeingDragged ? 0.35 : 1 }}>
                            {/* Section header */}
                            <div
                              draggable={orgRole === "admin" && !isRenamingThisSection}
                              onDragStart={(e) => handleSectionDragStart(e, cat.id, section.label, sIdx)}
                              onDragOver={(e) => handleSectionDragOver(e, cat.id, section.label, sIdx)}
                              onDrop={(e) => handleSectionDrop(e, cat.id, section.label, sIdx)}
                              onDragEnd={handleDragEnd}
                              style={{
                                display: "flex", alignItems: "center", gap: "8px",
                                padding: "6px 10px 6px 8px",
                                background: isSectionDragTarget ? "var(--c-accent-dk)" : isOrderTarget ? "var(--c-surface-alt)" : "var(--c-surface-alt)",
                                borderLeft: `3px solid ${isSectionDragTarget ? "var(--c-warn)" : "var(--c-accent)"}`,
                                borderRadius: "0 6px 6px 0", marginBottom: "4px",
                                cursor: orgRole === "admin" && !isRenamingThisSection ? "grab" : "default",
                                transition: "background 0.12s",
                              }}
                            >
                              {orgRole === "admin" && (
                                <span style={{ color: "var(--c-text-4)", fontSize: "14px", userSelect: "none", flexShrink: 0 }}>⠿</span>
                              )}
                              {isRenamingThisSection ? (
                                <div style={{ display: "flex", gap: "6px", flex: 1, alignItems: "center" }}
                                  onClick={(e) => e.stopPropagation()}>
                                  <input
                                    autoFocus value={renameSectionText}
                                    onChange={(e) => setRenameSectionText(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") renameSection(cat.id, section.label);
                                      if (e.key === "Escape") setRenamingSection(null);
                                    }}
                                    style={{ flex: 1, padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #0095da", borderRadius: "4px", color: "var(--c-text)", fontSize: "12px" }}
                                  />
                                  <button onClick={() => renameSection(cat.id, section.label)}
                                    style={mBtn({ background: "var(--c-accent)", color: "white", border: "none" })}>Save</button>
                                  <button onClick={() => setRenamingSection(null)} style={mBtn()}>×</button>
                                </div>
                              ) : (
                                <>
                                  <span style={{ flex: 1, color: "var(--c-accent-lt)", fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                                    {section.label}
                                  </span>
                                  {isSectionDragTarget && (
                                    <span style={{ color: "var(--c-warn)", fontSize: "10px", flexShrink: 0 }}>drop to assign</span>
                                  )}
                                  {orgRole === "admin" && (
                                    <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                                      <button onClick={() => { setRenamingSection({ catId: cat.id, label: section.label }); setRenameSectionText(section.label); }}
                                        style={mBtn()}>Rename</button>
                                      <button onClick={() => deleteSection(cat.id, section.label)}
                                        style={mBtn({ color: "var(--c-err)" })}>✕</button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>

                            {/* Items in this section */}
                            <div style={{ display: "grid", gap: "3px", marginLeft: "12px" }}>
                              {sectionItems.map((item, itemIdx) => {
                                const isItemDragOver = dragOver === `item:${item.id}`;
                                const isItemBeingDragged = dragInfo.current?.type === "item" && dragInfo.current?.itemId === item.id;
                                return (
                                  <div
                                    key={item.id}
                                    draggable={orgRole === "admin" && !isMobile && editingItemId !== item.id}
                                    onDragStart={(e) => handleItemDragStart(e, cat.id, item.id)}
                                    onDragOver={(e) => handleItemDragOver(e, cat.id, item.id)}
                                    onDrop={(e) => handleItemDrop(e, cat.id, item.id, item.section)}
                                    onDragEnd={handleDragEnd}
                                    style={{
                                      display: "flex", alignItems: "center", gap: "8px",
                                      padding: "6px 10px", borderRadius: "0 6px 6px 0",
                                      borderLeft: `2px solid ${isItemDragOver ? "var(--c-accent)" : "var(--c-accent-2)"}`,
                                      background: isItemDragOver ? "var(--c-accent-dk)" : "var(--c-surface-item)",
                                      opacity: isItemBeingDragged ? 0.3 : 1,
                                      transition: "background 0.1s",
                                    }}
                                  >
                                    {orgRole === "admin" && !isMobile && (
                                      <span style={{ color: "var(--c-text-4)", fontSize: "13px", cursor: "grab", userSelect: "none", flexShrink: 0 }}>⠿</span>
                                    )}
                                    {orgRole === "admin" && isMobile && (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "1px", flexShrink: 0 }}>
                                        <button onClick={() => moveItemByStep(cat.id, item.id, -1)} disabled={itemIdx === 0}
                                          style={{ padding: "1px 5px", fontSize: "10px", background: "none", border: "1px solid var(--c-border)", borderRadius: "3px", color: "var(--c-text-3)", cursor: "pointer", lineHeight: 1 }}>▲</button>
                                        <button onClick={() => moveItemByStep(cat.id, item.id, 1)} disabled={itemIdx === sectionItems.length - 1}
                                          style={{ padding: "1px 5px", fontSize: "10px", background: "none", border: "1px solid var(--c-border)", borderRadius: "3px", color: "var(--c-text-3)", cursor: "pointer", lineHeight: 1 }}>▼</button>
                                      </div>
                                    )}
                                    {editingItemId === item.id ? (
                                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                                        <input autoFocus value={editItemText}
                                          onChange={(e) => setEditItemText(e.target.value)}
                                          onKeyDown={(e) => { if (e.key === "Enter") saveItemEdit(item); if (e.key === "Escape") setEditingItemId(null); }}
                                          placeholder="Item text"
                                          style={{ padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #0095da", borderRadius: "4px", color: "var(--c-text)", fontSize: "13px" }}
                                        />
                                        <input value={editItemHelpText}
                                          onChange={(e) => setEditItemHelpText(e.target.value)}
                                          placeholder="Help text (optional tooltip)"
                                          style={{ padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #334155", borderRadius: "4px", color: "var(--c-text)", fontSize: "12px" }}
                                        />
                                        <input type="number" min="0" value={editItemDays}
                                          onChange={(e) => setEditItemDays(e.target.value)}
                                          placeholder="Days before milestone (due-date offset)"
                                          style={{ padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #334155", borderRadius: "4px", color: "var(--c-text)", fontSize: "12px", width: "220px" }}
                                        />
                                      </div>
                                    ) : (
                                      <div style={{ flex: 1 }}>
                                        <span style={{ color: "var(--c-text-4)", fontSize: "13px", lineHeight: 1.4 }}>{item.item_text}</span>
                                        {item.help_text && <div style={{ fontSize: "11px", color: "var(--c-text-3)", marginTop: "2px" }}>ⓘ {item.help_text}</div>}
                                        {item.days_before_milestone && <div style={{ fontSize: "10px", color: "var(--c-accent-lt)", marginTop: "2px" }}>📅 {item.days_before_milestone}d before milestone</div>}
                                        {[...(orgItemDeps[item.id] || new Set())].length > 0 && (
                                          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                                            {[...(orgItemDeps[item.id] || new Set())].map((depId) => {
                                              const depItem = Object.values(items).flat().find((i) => i.id === depId);
                                              if (!depItem) return null;
                                              return <span key={depId} style={{ fontSize: "9px", color: "var(--c-purple)", background: "var(--c-purple-bg)", border: "1px solid var(--c-purple)", borderRadius: "20px", padding: "1px 6px" }}>⛓ {depItem.item_text.slice(0, 20)}</span>;
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {orgRole === "admin" && (
                                      <div style={{ display: "flex", gap: "3px", flexShrink: 0, alignItems: "center" }}>
                                        {editingItemId === item.id ? (
                                          <>
                                            <button onClick={() => saveItemEdit(item)} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none" })}>Save</button>
                                            <button onClick={() => setEditingItemId(null)} style={mBtn()}>×</button>
                                          </>
                                        ) : (
                                          <>
                                            {(() => {
                                              const deps = [...(orgItemDeps[item.id] || new Set())];
                                              const isPickerOpen = depsPickerItemId === item.id;
                                              const allItems = Object.values(items).flat();
                                              const filtered = allItems.filter((i) => i.id !== item.id && (!depsPickerSearch || i.item_text.toLowerCase().includes(depsPickerSearch.toLowerCase())));
                                              return (
                                                <div style={{ position: "relative" }}>
                                                  <button onClick={() => { setDepsPickerItemId(isPickerOpen ? null : item.id); setDepsPickerSearch(""); }}
                                                    title="Set dependencies"
                                                    style={{ ...mBtn(), color: deps.length > 0 ? "var(--c-purple)" : "var(--c-text-4)", borderColor: deps.length > 0 ? "var(--c-purple)" : "#334155" }}>
                                                    ⛓
                                                  </button>
                                                  {isPickerOpen && (
                                                    <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30, background: "var(--c-bg)", border: "1px solid var(--c-accent)", borderRadius: "10px", padding: "10px", minWidth: "260px", maxHeight: "280px", overflowY: "auto", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }} onClick={(e) => e.stopPropagation()}>
                                                      <div style={{ fontSize: "11px", fontWeight: "700", color: "var(--c-text-2)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Depends on (template)</div>
                                                      <input autoFocus placeholder="Search items…" value={depsPickerSearch} onChange={(e) => setDepsPickerSearch(e.target.value)}
                                                        style={{ width: "100%", padding: "5px 8px", background: "var(--c-surface)", border: "1px solid #334155", borderRadius: "5px", color: "var(--c-text)", fontSize: "12px", marginBottom: "6px", boxSizing: "border-box" }}
                                                      />
                                                      {filtered.map((i) => {
                                                        const checked = orgItemDeps[item.id]?.has(i.id) ?? false;
                                                        const circular = !checked && wouldCreateCycle(item.id, i.id, orgItemDeps);
                                                        return (
                                                          <label key={i.id} style={{ display: "flex", alignItems: "flex-start", gap: "7px", padding: "4px 2px", cursor: circular ? "not-allowed" : "pointer", opacity: circular ? 0.4 : 1 }}>
                                                            <input type="checkbox" checked={checked} disabled={circular}
                                                              onChange={() => toggleOrgDep(item.id, i.id, !checked)}
                                                              style={{ marginTop: "2px", flexShrink: 0 }}
                                                            />
                                                            <span style={{ fontSize: "11px", color: "var(--c-text-3)", lineHeight: 1.4 }}>
                                                              {i.item_text}
                                                              {circular && <span style={{ marginLeft: "4px", fontSize: "9px", color: "var(--c-err)" }}>↻ circular</span>}
                                                            </span>
                                                          </label>
                                                        );
                                                      })}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })()}
                                            <button onClick={() => { setEditingItemId(item.id); setEditItemText(item.item_text); setEditItemHelpText(item.help_text || ""); setEditItemDays(item.days_before_milestone ?? ""); }} style={mBtn()}>Edit</button>
                                            <button onClick={() => removeItem(item)} style={mBtn({ color: "var(--c-err)" })}>✕</button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Add item to this section */}
                            {orgRole === "admin" && (
                              addingTo?.catId === cat.id && addingTo?.section === section.label ? (
                                <div style={{ display: "flex", gap: "6px", marginTop: "4px", marginLeft: "12px" }}>
                                  <input autoFocus value={newItemText}
                                    onChange={(e) => setNewItemText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") addItem(cat.id, section.label); if (e.key === "Escape") { setAddingTo(null); setNewItemText(""); } }}
                                    placeholder="New item text..."
                                    style={{ flex: 1, padding: "6px 9px", background: "var(--c-surface)", border: "1px solid #0095da", borderRadius: "5px", color: "var(--c-text)", fontSize: "13px" }}
                                  />
                                  <button onClick={() => addItem(cat.id, section.label)} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none", padding: "6px 12px" })}>Add</button>
                                  <button onClick={() => { setAddingTo(null); setNewItemText(""); }} style={mBtn({ padding: "6px 9px" })}>×</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setAddingTo({ catId: cat.id, section: section.label })}
                                  style={{
                                    display: "block", width: "calc(100% - 12px)", marginLeft: "12px", marginTop: "4px",
                                    padding: "5px", background: "transparent", border: "1px dashed #29439b",
                                    borderRadius: "5px", color: "var(--c-text-4)", fontSize: "11px", cursor: "pointer",
                                    fontFamily: "Manrope, sans-serif",
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-accent)"; e.currentTarget.style.color = "var(--c-accent-lt)"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-accent-2)"; e.currentTarget.style.color = "var(--c-text-4)"; }}
                                >
                                  + Add Item to "{section.label}"
                                </button>
                              )
                            )}
                          </div>
                        );
                      })}

                      {/* ── No-section items ─────────────────────────────── */}
                      {(() => {
                        const noSection = catItems.filter((i) => !i.section);
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
                                    const isItemDragOver = dragOver === `item:${item.id}`;
                                    const isItemBeingDragged = dragInfo.current?.type === "item" && dragInfo.current?.itemId === item.id;
                                    return (
                                      <div
                                        key={item.id}
                                        draggable={orgRole === "admin" && !isMobile && editingItemId !== item.id}
                                        onDragStart={(e) => handleItemDragStart(e, cat.id, item.id)}
                                        onDragOver={(e) => handleItemDragOver(e, cat.id, item.id)}
                                        onDrop={(e) => handleItemDrop(e, cat.id, item.id, null)}
                                        onDragEnd={handleDragEnd}
                                        style={{
                                          display: "flex", alignItems: "center", gap: "8px",
                                          padding: "6px 10px", borderRadius: "6px",
                                          borderLeft: `2px dashed ${isItemDragOver ? "var(--c-accent)" : "var(--c-border)"}`,
                                          background: isItemDragOver ? "var(--c-accent-dk)" : "var(--c-surface)",
                                          opacity: isItemBeingDragged ? 0.3 : 1,
                                          transition: "background 0.1s",
                                        }}
                                      >
                                        {orgRole === "admin" && !isMobile && (
                                          <span style={{ color: "var(--c-text-4)", fontSize: "13px", cursor: "grab", userSelect: "none", flexShrink: 0 }}>⠿</span>
                                        )}
                                        {orgRole === "admin" && isMobile && (
                                          <div style={{ display: "flex", flexDirection: "column", gap: "1px", flexShrink: 0 }}>
                                            <button onClick={() => moveItemByStep(cat.id, item.id, -1)} disabled={itemIdx === 0}
                                              style={{ padding: "1px 5px", fontSize: "10px", background: "none", border: "1px solid var(--c-border)", borderRadius: "3px", color: "var(--c-text-3)", cursor: "pointer", lineHeight: 1 }}>▲</button>
                                            <button onClick={() => moveItemByStep(cat.id, item.id, 1)} disabled={itemIdx === noSection.length - 1}
                                              style={{ padding: "1px 5px", fontSize: "10px", background: "none", border: "1px solid var(--c-border)", borderRadius: "3px", color: "var(--c-text-3)", cursor: "pointer", lineHeight: 1 }}>▼</button>
                                          </div>
                                        )}
                                        {editingItemId === item.id ? (
                                          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                                            <input autoFocus value={editItemText}
                                              onChange={(e) => setEditItemText(e.target.value)}
                                              onKeyDown={(e) => { if (e.key === "Enter") saveItemEdit(item); if (e.key === "Escape") setEditingItemId(null); }}
                                              placeholder="Item text"
                                              style={{ padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #0095da", borderRadius: "4px", color: "var(--c-text)", fontSize: "13px" }}
                                            />
                                            <input value={editItemHelpText}
                                              onChange={(e) => setEditItemHelpText(e.target.value)}
                                              placeholder="Help text (optional tooltip)"
                                              style={{ padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #334155", borderRadius: "4px", color: "var(--c-text)", fontSize: "12px" }}
                                            />
                                            <input type="number" min="0" value={editItemDays}
                                              onChange={(e) => setEditItemDays(e.target.value)}
                                              placeholder="Days before milestone"
                                              style={{ padding: "3px 8px", background: "var(--c-bg)", border: "1px solid #334155", borderRadius: "4px", color: "var(--c-text)", fontSize: "12px", width: "220px" }}
                                            />
                                          </div>
                                        ) : (
                                          <div style={{ flex: 1 }}>
                                            <span style={{ color: "var(--c-text-2)", fontSize: "13px", lineHeight: 1.4 }}>{item.item_text}</span>
                                            {item.help_text && <div style={{ fontSize: "11px", color: "var(--c-text-3)", marginTop: "2px" }}>ⓘ {item.help_text}</div>}
                                            {item.days_before_milestone && <div style={{ fontSize: "10px", color: "var(--c-accent-lt)", marginTop: "2px" }}>📅 {item.days_before_milestone}d before milestone</div>}
                                          </div>
                                        )}
                                        {orgRole === "admin" && (
                                          <div style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                                            {editingItemId === item.id ? (
                                              <>
                                                <button onClick={() => saveItemEdit(item)} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none" })}>Save</button>
                                                <button onClick={() => setEditingItemId(null)} style={mBtn()}>×</button>
                                              </>
                                            ) : (
                                              <>
                                                <button onClick={() => { setEditingItemId(item.id); setEditItemText(item.item_text); setEditItemHelpText(item.help_text || ""); setEditItemDays(item.days_before_milestone ?? ""); }} style={mBtn()}>Edit</button>
                                                <button onClick={() => removeItem(item)} style={mBtn({ color: "var(--c-err)" })}>✕</button>
                                              </>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Add unsectioned item */}
                            {orgRole === "admin" && (
                              addingTo?.catId === cat.id && addingTo?.section === null ? (
                                <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                                  <input autoFocus value={newItemText}
                                    onChange={(e) => setNewItemText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") addItem(cat.id, null); if (e.key === "Escape") { setAddingTo(null); setNewItemText(""); } }}
                                    placeholder="New item text..."
                                    style={{ flex: 1, padding: "6px 9px", background: "var(--c-surface)", border: "1px solid #0095da", borderRadius: "5px", color: "var(--c-text)", fontSize: "13px" }}
                                  />
                                  <button onClick={() => addItem(cat.id, null)} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none", padding: "6px 12px" })}>Add</button>
                                  <button onClick={() => { setAddingTo(null); setNewItemText(""); }} style={mBtn({ padding: "6px 9px" })}>×</button>
                                </div>
                              ) : null
                            )}
                          </>
                        );
                      })()}

                      {/* ── Bottom actions ───────────────────────────────── */}
                      {orgRole === "admin" && addingTo?.catId !== cat.id && (
                        <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
                          {catSections.length > 0 ? (
                            <button onClick={() => setAddingTo({ catId: cat.id, section: null })} style={{
                              flex: 1, padding: "6px 10px", background: "transparent",
                              border: "1px dashed #334155", borderRadius: "6px",
                              color: "var(--c-text-3)", fontSize: "12px", cursor: "pointer", fontFamily: "Manrope, sans-serif",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-accent)"; e.currentTarget.style.color = "var(--c-accent-lt)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-border)"; e.currentTarget.style.color = "var(--c-text-3)"; }}>
                              + Add Item (No Section)
                            </button>
                          ) : (
                            <button onClick={() => setAddingTo({ catId: cat.id, section: null })} style={{
                              flex: 1, padding: "6px 10px", background: "transparent",
                              border: "1px dashed #334155", borderRadius: "6px",
                              color: "var(--c-text-3)", fontSize: "12px", cursor: "pointer", fontFamily: "Manrope, sans-serif",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--c-accent)"; e.currentTarget.style.color = "var(--c-accent-lt)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--c-border)"; e.currentTarget.style.color = "var(--c-text-3)"; }}>
                              + Add Item
                            </button>
                          )}
                          {addingSection !== cat.id && (
                            <button onClick={() => { setAddingSection(cat.id); setNewSectionText(""); }} style={{
                              padding: "6px 12px", background: "transparent",
                              border: "1px dashed #0095da", borderRadius: "6px",
                              color: "var(--c-accent)", fontSize: "12px", cursor: "pointer", fontFamily: "Manrope, sans-serif",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--c-accent-dk)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                              + Add Section
                            </button>
                          )}
                        </div>
                      )}

                      {/* Add section form */}
                      {addingSection === cat.id && (
                        <div style={{ display: "flex", gap: "6px", marginTop: "8px", alignItems: "center" }}>
                          <div style={{ width: "3px", background: "var(--c-accent)", borderRadius: "2px", alignSelf: "stretch", flexShrink: 0 }} />
                          <input
                            autoFocus value={newSectionText}
                            onChange={(e) => setNewSectionText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") addSection(cat.id); if (e.key === "Escape") setAddingSection(null); }}
                            placeholder="Section name..."
                            style={{ flex: 1, padding: "6px 10px", background: "var(--c-surface-alt)", border: "1px solid #0095da", borderRadius: "5px", color: "var(--c-text)", fontSize: "13px" }}
                          />
                          <button onClick={() => addSection(cat.id)} disabled={!newSectionText.trim()} style={mBtn({ background: "var(--c-accent)", color: "white", border: "none", padding: "6px 12px" })}>Create</button>
                          <button onClick={() => setAddingSection(null)} style={mBtn({ padding: "6px 9px" })}>×</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Push to Project modal */}
      {pushModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: "16px" }}>
          <div style={{ background: "var(--c-surface)", borderRadius: "12px", padding: "28px", width: "100%", maxWidth: "440px", border: "1px solid #334155", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
            <h3 style={{ color: "var(--c-text)", margin: "0 0 6px", fontSize: "16px", fontFamily: "Manrope, sans-serif" }}>Push to Project</h3>
            <p style={{ color: "var(--c-text-3)", fontSize: "13px", margin: "0 0 20px" }}>
              Send <strong style={{ color: "var(--c-accent-lt)" }}>{pushModal.catLabel}</strong> checklist items to a project.
            </p>

            {pushStatus === "done" ? (
              <div style={{ textAlign: "center" }}>
                <p style={{ color: "var(--c-ok-text)", fontSize: "15px", marginBottom: "20px" }}>
                  ✓ Checklist pushed to {selectedProjIds.size} project{selectedProjIds.size !== 1 ? "s" : ""}!
                </p>
                <button onClick={() => setPushModal(null)} style={{ padding: "10px 28px", background: "var(--c-border)", color: "var(--c-text)", border: "none", borderRadius: "8px", cursor: "pointer", fontFamily: "Manrope, sans-serif" }}>Close</button>
              </div>

            ) : pushStatus === "conflict" ? (
              <div>
                {pushError && (
                  <div style={{ background: "var(--c-err-bg)", border: "1px solid #ef4444", borderRadius: "8px", padding: "10px 12px", marginBottom: "14px", color: "var(--c-err-text)", fontSize: "13px" }}>{pushError}</div>
                )}
                <div style={{ background: "var(--c-warn-bg)", border: "1px solid #f59e0b", borderRadius: "8px", padding: "12px", marginBottom: "16px" }}>
                  <p style={{ color: "#fcd34d", margin: "0 0 6px", fontSize: "13px", fontWeight: "600" }}>
                    ⚠ {conflictNames.length} project{conflictNames.length !== 1 ? "s" : ""} already {conflictNames.length !== 1 ? "have" : "has"} this checklist:
                  </p>
                  <p style={{ color: "var(--c-warn-text)", margin: 0, fontSize: "12px" }}>{conflictNames.join(", ")}</p>
                </div>
                <p style={{ color: "var(--c-text-2)", fontSize: "13px", margin: "0 0 12px" }}>How should existing items be handled?</p>
                <div style={{ display: "grid", gap: "8px" }}>
                  <button onClick={() => executePush("overwrite_keep")} style={{
                    padding: "12px 16px", background: "#0f2a1a", border: "1px solid #4da447", color: "var(--c-ok-text)",
                    borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600", textAlign: "left", fontFamily: "Manrope, sans-serif",
                  }}>
                    ✓ Keep statuses — update item text, preserve pending / complete / N/A
                  </button>
                  <button onClick={() => executePush("overwrite_reset")} style={{
                    padding: "12px 16px", background: "var(--c-err-bg)", border: "1px solid #ef4444", color: "var(--c-err-text)",
                    borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: "600", textAlign: "left", fontFamily: "Manrope, sans-serif",
                  }}>
                    ↺ Reset all — replace items and reset everything to pending
                  </button>
                  <button onClick={() => { setPushStatus("idle"); setPushError(""); setConflictNames([]); }} style={{
                    padding: "10px", background: "transparent", border: "1px solid #334155", color: "var(--c-text-2)",
                    borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontFamily: "Manrope, sans-serif",
                  }}>
                    Back
                  </button>
                </div>
              </div>

            ) : pushStatus === "pushing" || pushStatus === "checking" ? (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <p style={{ color: "var(--c-text-2)", fontSize: "14px", margin: 0 }}>
                  {pushStatus === "checking" ? "Checking projects..." : "Pushing checklist..."}
                </p>
              </div>

            ) : (
              <div>
                {/* Select All */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <label style={{ color: "var(--c-text-2)", fontSize: "13px" }}>Select projects to push to:</label>
                  <button onClick={toggleAll} style={{
                    background: "transparent", border: "none", color: "var(--c-accent)",
                    cursor: "pointer", fontSize: "12px", fontWeight: "600", fontFamily: "Manrope, sans-serif",
                  }}>
                    {selectedProjIds.size === orgProjects.length && orgProjects.length > 0 ? "Deselect All" : "Select All"}
                  </button>
                </div>

                {/* Project list */}
                <div style={{ maxHeight: "260px", overflowY: "auto", display: "grid", gap: "6px", marginBottom: "20px" }}>
                  {orgProjects.length === 0 ? (
                    <p style={{ color: "var(--c-text-3)", fontSize: "13px", margin: 0 }}>No active projects in this organization.</p>
                  ) : orgProjects.map((p) => (
                    <label key={p.id} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "10px 14px", background: selectedProjIds.has(p.id) ? "var(--c-accent-dk)" : "var(--c-bg)",
                      border: `1px solid ${selectedProjIds.has(p.id) ? "var(--c-accent)" : "var(--c-border)"}`,
                      borderRadius: "8px", cursor: "pointer", transition: "background 0.1s",
                    }}>
                      <input type="checkbox" checked={selectedProjIds.has(p.id)} onChange={() => toggleProject(p.id)}
                        style={{ width: "15px", height: "15px", accentColor: "var(--c-accent)", flexShrink: 0 }} />
                      <span style={{ color: "var(--c-text)", fontSize: "14px" }}>{p.name}</span>
                    </label>
                  ))}
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setPushModal(null)} style={{
                    flex: 1, padding: "10px", background: "var(--c-border)", color: "var(--c-text)",
                    border: "none", borderRadius: "8px", cursor: "pointer", fontSize: "14px", fontFamily: "Manrope, sans-serif",
                  }}>Cancel</button>
                  <button onClick={checkAndPush} disabled={selectedProjIds.size === 0} style={{
                    flex: 2, padding: "10px", fontWeight: "600", fontSize: "14px", border: "none",
                    borderRadius: "8px", fontFamily: "Manrope, sans-serif",
                    background: selectedProjIds.size > 0 ? "var(--c-accent)" : "var(--c-surface)",
                    color: selectedProjIds.size > 0 ? "white" : "var(--c-text-4)",
                    cursor: selectedProjIds.size > 0 ? "pointer" : "not-allowed",
                  }}>
                    Push to {selectedProjIds.size || 0} Project{selectedProjIds.size !== 1 ? "s" : ""}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
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
      <h2 style={{ color: "var(--c-text)", margin: "0 0 24px", fontSize: isMobile ? "18px" : "22px", fontWeight: "700" }}>Settings</h2>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #334155", marginBottom: "28px", overflowX: "auto" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 20px", border: "none", background: "transparent", cursor: "pointer",
            fontSize: "14px", fontWeight: tab === t ? "600" : "400",
            color: tab === t ? "var(--c-accent)" : "var(--c-text-2)",
            borderBottom: `2px solid ${tab === t ? "var(--c-accent)" : "transparent"}`,
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
