import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { CHECKLIST_TEMPLATE } from "../checklistTemplate";

const inputStyle = {
  width: "100%", padding: "10px 12px", background: "#0f172a",
  border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9",
  fontSize: "14px", boxSizing: "border-box",
};
const labelStyle = { display: "block", color: "#94a3b8", fontSize: "13px", marginBottom: "6px" };

export default function CreateProjectModal({ onClose, onCreated, userId, org }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [templateProjectId, setTemplateProjectId] = useState("");
  const [pmProjects, setPmProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  useEffect(() => {
    supabase
      .from("projects")
      .select("id, name")
      .eq("organization_id", org?.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => setPmProjects(data || []));
  }, [userId, org?.id]);

  const applyTemplate = async (newProjectId, templateId) => {
    setProgress("Copying checklist configuration...");
    const { data: cfgs } = await supabase
      .from("project_checklist_config")
      .select("*")
      .eq("project_id", templateId);
    if (cfgs?.length) {
      await supabase.from("project_checklist_config").insert(
        cfgs.map((c) => ({ project_id: newProjectId, category: c.category, enabled: c.enabled, label: c.label || null }))
      );
    }

    setProgress("Copying custom checklist items...");
    const { data: customItems } = await supabase
      .from("checklists")
      .select("*")
      .eq("project_id", templateId)
      .eq("is_custom", true);
    if (customItems?.length) {
      for (let i = 0; i < customItems.length; i += 50) {
        await supabase.from("checklists").insert(
          customItems.slice(i, i + 50).map((item) => ({
            project_id: newProjectId,
            item_id: `tmpl_${Date.now().toString(36)}_${item.item_id}`,
            category: item.category,
            sub_section: item.sub_section || null,
            phase: item.phase || null,
            item_text: item.item_text,
            status: "pending",
            is_custom: true,
          }))
        );
      }
    }

    setProgress("Copying milestones...");
    const { data: milestones } = await supabase
      .from("project_milestones")
      .select("*")
      .eq("project_id", templateId)
      .order("date");

    if (milestones?.length) {
      const { data: newMilestones } = await supabase
        .from("project_milestones")
        .insert(milestones.map((m) => ({
          project_id: newProjectId,
          name: m.name,
          date: m.date,
          days_before_alert: m.days_before_alert,
        })))
        .select();

      // Copy milestone item assignments (standard items only, matched by item_id)
      if (newMilestones?.length) {
        setProgress("Copying milestone assignments...");
        const nameToNewId = {};
        newMilestones.forEach((m) => { nameToNewId[m.name] = m.id; });

        for (const oldMs of milestones) {
          const newMsId = nameToNewId[oldMs.name];
          if (!newMsId) continue;

          const { data: msItems } = await supabase
            .from("milestone_items")
            .select("checklist_item_id")
            .eq("milestone_id", oldMs.id);
          if (!msItems?.length) continue;

          const { data: oldItems } = await supabase
            .from("checklists")
            .select("id, item_id")
            .in("id", msItems.map((r) => r.checklist_item_id));

          const itemIds = (oldItems || []).map((i) => i.item_id);
          if (!itemIds.length) continue;

          const { data: newItems } = await supabase
            .from("checklists")
            .select("id")
            .eq("project_id", newProjectId)
            .in("item_id", itemIds);

          if (newItems?.length) {
            await supabase.from("milestone_items").insert(
              newItems.map((i) => ({ milestone_id: newMsId, checklist_item_id: i.id }))
            );
          }
        }
      }
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    setProgress("Creating project...");
    const { data: project, error: projError } = await supabase
      .from("projects")
      .insert({ name, description, created_by: userId, organization_id: org?.id || null })
      .select()
      .single();
    if (projError) { setError(projError.message); setLoading(false); setProgress(""); return; }

    setProgress("Setting up team...");
    const { error: memberError } = await supabase.from("project_members").insert({
      project_id: project.id, user_id: userId, role: "project_manager", invited_by: userId,
    });
    if (memberError) { setError(memberError.message); setLoading(false); setProgress(""); return; }

    // Template metadata lookup (sub_section / phase by item_id)
    const tmplMeta = {};
    CHECKLIST_TEMPLATE.forEach((t) => { tmplMeta[t.item_id] = { sub_section: t.sub_section, phase: t.phase }; });

    let orgCfg = null;
    let orgItemsByCategory = {};
    let initializedCats = new Set(); // categories that have been configured in org settings

    if (org?.id) {
      setProgress("Loading organization settings...");
      // Fetch config + enabled items + all items (to detect which categories were initialized)
      const [{ data: cfgData }, { data: enabledItems }, { data: allItems }] = await Promise.all([
        supabase.from("org_checklist_config").select("*").eq("organization_id", org.id),
        supabase.from("org_checklist_items").select("*").eq("organization_id", org.id).eq("enabled", true).order("sort_order"),
        supabase.from("org_checklist_items").select("category").eq("organization_id", org.id),
      ]);
      orgCfg = cfgData || [];

      // Map enabled items by category
      (enabledItems || []).forEach((item) => {
        if (!orgItemsByCategory[item.category]) orgItemsByCategory[item.category] = [];
        orgItemsByCategory[item.category].push(item);
      });

      // Which categories have any rows at all (were ever expanded/initialized in org settings)
      initializedCats = new Set((allItems || []).map((i) => i.category));

      // Copy org config to project config
      if (orgCfg.length) {
        await supabase.from("project_checklist_config").insert(
          orgCfg.map((c) => ({ project_id: project.id, category: c.category, enabled: c.enabled, label: c.label || null }))
        );
      }
      await supabase.from("project_checklist_config").upsert(
        { project_id: project.id, category: "project_specific", enabled: true, label: null },
        { onConflict: "project_id,category" }
      );
    }

    setProgress("Populating default checklist items...");

    let checklistItems = [];
    let sortIdx = 0;

    if (org?.id) {
      const customCatIds = (orgCfg || []).filter((c) => c.is_custom).map((c) => c.category);
      const allCatIds = [...CATEGORIES.map((c) => c.id), ...customCatIds];

      for (const catId of allCatIds) {
        const catOrgItems = orgItemsByCategory[catId];

        if (catOrgItems?.length > 0) {
          // Category was configured in org settings — use its items (with any text/section overrides)
          catOrgItems.forEach((item) => {
            checklistItems.push({
              project_id: project.id,
              item_id: item.item_id,
              category: catId,
              sub_section: item.section || tmplMeta[item.item_id]?.sub_section || null,
              phase: tmplMeta[item.item_id]?.phase || null,
              item_text: item.item_text,
              status: "pending",
              sort_order: sortIdx++,
            });
          });
        } else if (!initializedCats.has(catId)) {
          // Category was never opened in org settings → use the original template items
          CHECKLIST_TEMPLATE.filter((t) => t.category === catId).forEach((item) => {
            checklistItems.push({
              project_id: project.id,
              item_id: item.item_id,
              category: catId,
              sub_section: item.sub_section || null,
              phase: item.phase || null,
              item_text: item.text,
              status: "pending",
              sort_order: sortIdx++,
            });
          });
        }
        // If initialized but all items deleted/disabled → the category is intentionally empty
      }
    } else {
      // No org → full template
      checklistItems = CHECKLIST_TEMPLATE.map((item, idx) => ({
        project_id: project.id,
        item_id: item.item_id,
        category: item.category,
        sub_section: item.sub_section || null,
        phase: item.phase || null,
        item_text: item.text,
        status: "pending",
        sort_order: idx,
      }));
    }

    for (let i = 0; i < checklistItems.length; i += 50) {
      const { error: checklistError } = await supabase.from("checklists").insert(checklistItems.slice(i, i + 50));
      if (checklistError) { setError(checklistError.message); setLoading(false); setProgress(""); return; }
      setProgress(`Populating checklist... ${Math.min(i + 50, checklistItems.length)}/${checklistItems.length}`);
    }

    if (useTemplate && templateProjectId) {
      await applyTemplate(project.id, templateProjectId);
    }

    setLoading(false);
    setProgress("");
    onCreated();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "16px" }}>
      <div style={{ background: "#1e293b", borderRadius: "12px", padding: "32px", width: "100%", maxWidth: "500px", boxShadow: "0 4px 24px rgba(0,0,0,0.4)", maxHeight: "90vh", overflowY: "auto" }}>

        <h2 style={{ color: "#f1f5f9", margin: "0 0 24px", fontSize: "20px", fontFamily: "Manrope, sans-serif" }}>
          Create New Project
        </h2>

        {error && (
          <div style={{ background: "#450a0a", border: "1px solid #ef4444", borderRadius: "8px", padding: "12px", marginBottom: "16px", color: "#fca5a5", fontSize: "14px" }}>
            {error}
          </div>
        )}
        {progress && (
          <div style={{ background: "#011a3d", border: "1px solid #0095da", borderRadius: "8px", padding: "12px", marginBottom: "16px", color: "#33bdef", fontSize: "13px" }}>
            ⏳ {progress}
          </div>
        )}

        <form onSubmit={handleCreate} style={{ fontFamily: "Manrope, sans-serif" }}>
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Project Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required
              placeholder="e.g. Office Building QC" style={inputStyle} disabled={loading} />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional project description..." rows={2}
              style={{ ...inputStyle, resize: "vertical" }} disabled={loading} />
          </div>

          {/* Template toggle */}
          <div style={{ marginBottom: "20px", background: "#0f172a", borderRadius: "8px", padding: "14px", border: "1px solid #334155" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
              <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)}
                disabled={loading || pmProjects.length === 0}
                style={{ width: "16px", height: "16px", accentColor: "#0095da" }} />
              <span style={{ color: "#f1f5f9", fontSize: "14px", fontWeight: "500" }}>
                Use an existing project as template
              </span>
            </label>
            {pmProjects.length === 0 && (
              <p style={{ color: "#64748b", fontSize: "12px", margin: "8px 0 0 26px" }}>
                No existing projects to use as template.
              </p>
            )}

            {useTemplate && pmProjects.length > 0 && (
              <div style={{ marginTop: "12px", marginLeft: "26px" }}>
                <label style={labelStyle}>Select template project</label>
                <select value={templateProjectId} onChange={(e) => setTemplateProjectId(e.target.value)}
                  required={useTemplate} style={inputStyle} disabled={loading}>
                  <option value="">— choose a project —</option>
                  {pmProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <p style={{ color: "#64748b", fontSize: "11px", margin: "8px 0 0" }}>
                  Copies: checklist configuration, custom items, milestones & their item assignments. Members are not copied.
                </p>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <button type="button" onClick={onClose} disabled={loading}
              style={{ flex: 1, padding: "12px", background: "#334155", color: "#f1f5f9", border: "none", borderRadius: "8px", fontSize: "14px", cursor: loading ? "not-allowed" : "pointer" }}>
              Cancel
            </button>
            <button type="submit" disabled={loading || (useTemplate && !templateProjectId)}
              style={{ flex: 1, padding: "12px", background: "#0095da", color: "white", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: "600", cursor: (loading || (useTemplate && !templateProjectId)) ? "not-allowed" : "pointer" }}>
              {loading ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
