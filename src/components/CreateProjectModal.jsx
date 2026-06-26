import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { CHECKLIST_TEMPLATE, CATEGORIES } from "../checklistTemplate";

const inputStyle = {
  width: "100%", padding: "10px 12px", background: "#0f172a",
  border: "1px solid #334155", borderRadius: "8px", color: "#f1f5f9",
  fontSize: "14px", boxSizing: "border-box",
};
const labelStyle = { display: "block", color: "#94a3b8", fontSize: "13px", marginBottom: "6px" };

// Static lookup built once at module load time
const TMPL_META = {};
CHECKLIST_TEMPLATE.forEach((t) => { TMPL_META[t.item_id] = { sub_section: t.sub_section, phase: t.phase }; });

export default function CreateProjectModal({ onClose, onCreated, userId, org }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [templateProjectId, setTemplateProjectId] = useState("");
  const [pmProjects, setPmProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progressStep, setProgressStep] = useState("");
  const [progressPct, setProgressPct] = useState(0);

  // Org data pre-fetched on mount so create is instant
  const [orgData, setOrgData] = useState(null);
  const orgFetched = useRef(false);

  useEffect(() => {
    // Fetch projects for template picker
    if (org?.id) {
      supabase.from("projects").select("id, name")
        .eq("organization_id", org.id).is("archived_at", null)
        .order("created_at", { ascending: false })
        .then(({ data }) => setPmProjects(data || []));
    }

    // Pre-fetch org config + items while user fills out the form
    if (!org?.id || orgFetched.current) return;
    orgFetched.current = true;
    Promise.all([
      supabase.from("org_checklist_config").select("*").eq("organization_id", org.id),
      supabase.from("org_checklist_items").select("*").eq("organization_id", org.id).eq("enabled", true).order("sort_order"),
      supabase.from("org_checklist_items").select("category").eq("organization_id", org.id),
    ]).then(([{ data: cfg }, { data: items }, { data: init }]) => {
      const byCategory = {};
      (items || []).forEach((item) => {
        if (!byCategory[item.category]) byCategory[item.category] = [];
        byCategory[item.category].push(item);
      });
      setOrgData({
        cfg: cfg || [],
        byCategory,
        initializedCats: new Set((init || []).map((i) => i.category)),
      });
    });
  }, [org?.id]);

  // Build all checklist items in JS — zero DB calls
  const buildChecklistItems = (projectId) => {
    if (!org?.id || !orgData) {
      return CHECKLIST_TEMPLATE.map((item, idx) => ({
        project_id: projectId, item_id: item.item_id, category: item.category,
        sub_section: item.sub_section || null, phase: item.phase || null,
        item_text: item.text, status: "pending", sort_order: idx,
      }));
    }

    const { byCategory, initializedCats, cfg } = orgData;
    const customCatIds = cfg.filter((c) => c.is_custom).map((c) => c.category);
    const allCatIds = [...CATEGORIES.map((c) => c.id), ...customCatIds];

    const rows = [];
    let idx = 0;
    for (const catId of allCatIds) {
      const catItems = byCategory[catId];
      if (catItems?.length > 0) {
        catItems.forEach((item) => {
          rows.push({
            project_id: projectId, item_id: item.item_id, category: catId,
            sub_section: item.section || TMPL_META[item.item_id]?.sub_section || null,
            phase: TMPL_META[item.item_id]?.phase || null,
            item_text: item.item_text, status: "pending", sort_order: idx++,
          });
        });
      } else if (!initializedCats.has(catId)) {
        // Never configured in org settings → use original template
        CHECKLIST_TEMPLATE.filter((t) => t.category === catId).forEach((item) => {
          rows.push({
            project_id: projectId, item_id: item.item_id, category: catId,
            sub_section: item.sub_section || null, phase: item.phase || null,
            item_text: item.text, status: "pending", sort_order: idx++,
          });
        });
      }
      // Initialized but emptied → intentionally empty
    }
    return rows;
  };

  // Template copy (used when "use existing project as template" is checked)
  const applyTemplate = async (newProjectId, templateId) => {
    setProgressStep("Copying template configuration…");
    const [{ data: cfgs }, { data: customItems }, { data: milestones }] = await Promise.all([
      supabase.from("project_checklist_config").select("*").eq("project_id", templateId),
      supabase.from("checklists").select("*").eq("project_id", templateId).eq("is_custom", true),
      supabase.from("project_milestones").select("*").eq("project_id", templateId).order("date"),
    ]);

    const insertPromises = [];

    if (cfgs?.length) {
      insertPromises.push(
        supabase.from("project_checklist_config").insert(
          cfgs.map((c) => ({ project_id: newProjectId, category: c.category, enabled: c.enabled, label: c.label || null }))
        )
      );
    }
    if (customItems?.length) {
      insertPromises.push(
        supabase.from("checklists").insert(
          customItems.map((item) => ({
            project_id: newProjectId,
            item_id: `tmpl_${Date.now().toString(36)}_${item.item_id}`,
            category: item.category, sub_section: item.sub_section || null,
            phase: item.phase || null, item_text: item.item_text,
            status: "pending", is_custom: true,
          }))
        )
      );
    }
    await Promise.all(insertPromises);

    if (milestones?.length) {
      setProgressStep("Copying milestones…");
      const { data: newMilestones } = await supabase
        .from("project_milestones")
        .insert(milestones.map((m) => ({
          project_id: newProjectId, name: m.name, date: m.date,
          days_before_alert: m.days_before_alert,
        })))
        .select();

      if (newMilestones?.length) {
        const nameToNewId = {};
        newMilestones.forEach((m) => { nameToNewId[m.name] = m.id; });

        await Promise.all(milestones.map(async (oldMs) => {
          const newMsId = nameToNewId[oldMs.name];
          if (!newMsId) return;
          const { data: msItems } = await supabase
            .from("milestone_items").select("checklist_item_id").eq("milestone_id", oldMs.id);
          if (!msItems?.length) return;
          const { data: oldItems } = await supabase
            .from("checklists").select("id, item_id")
            .in("id", msItems.map((r) => r.checklist_item_id));
          const itemIds = (oldItems || []).map((i) => i.item_id);
          if (!itemIds.length) return;
          const { data: newItems } = await supabase
            .from("checklists").select("id").eq("project_id", newProjectId).in("item_id", itemIds);
          if (newItems?.length) {
            await supabase.from("milestone_items").insert(
              newItems.map((i) => ({ milestone_id: newMsId, checklist_item_id: i.id }))
            );
          }
        }));
      }
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setProgressPct(15);
    setProgressStep("Creating project…");

    // Step 1 – create the project record
    const { data: project, error: projError } = await supabase
      .from("projects")
      .insert({ name, description, created_by: userId, organization_id: org?.id || null })
      .select().single();
    if (projError) { setError(projError.message); setLoading(false); setProgressPct(0); return; }

    setProgressPct(40);
    setProgressStep("Building checklist…");

    // Step 2 – build items array entirely in JS (no network)
    const checklistItems = buildChecklistItems(project.id);

    // Build config rows (org config already in memory from pre-fetch)
    const cfgRows = [];
    if (org?.id && orgData?.cfg?.length) {
      orgData.cfg.forEach((c) => {
        cfgRows.push({ project_id: project.id, category: c.category, enabled: c.enabled, label: c.label || null });
      });
    }
    if (!cfgRows.some((r) => r.category === "project_specific")) {
      cfgRows.push({ project_id: project.id, category: "project_specific", enabled: true, label: null });
    }

    setProgressPct(60);
    setProgressStep("Saving to database…");

    // Step 3 – single parallel round-trip: member + config + ALL checklist items at once
    const [memberRes, , itemsRes] = await Promise.all([
      supabase.from("project_members").insert({
        project_id: project.id, user_id: userId, role: "project_manager", invited_by: userId,
      }),
      cfgRows.length
        ? supabase.from("project_checklist_config").insert(cfgRows)
        : Promise.resolve({ error: null }),
      checklistItems.length
        ? supabase.from("checklists").insert(checklistItems)
        : Promise.resolve({ error: null }),
    ]);

    if (memberRes.error) { setError(memberRes.error.message); setLoading(false); setProgressPct(0); return; }
    if (itemsRes.error)  { setError(itemsRes.error.message);  setLoading(false); setProgressPct(0); return; }

    setProgressPct(85);

    if (useTemplate && templateProjectId) {
      await applyTemplate(project.id, templateProjectId);
    }

    setProgressPct(100);
    setProgressStep("Done!");
    setTimeout(() => { setLoading(false); setProgressPct(0); onCreated(); }, 250);
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

        {/* Progress bar — shown only while creating */}
        {loading && (
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ color: "#33bdef", fontSize: "13px", fontFamily: "Manrope, sans-serif" }}>{progressStep}</span>
              <span style={{ color: "#64748b", fontSize: "12px", fontFamily: "Manrope, sans-serif" }}>{progressPct}%</span>
            </div>
            <div style={{ height: "6px", background: "#0f172a", borderRadius: "3px", overflow: "hidden", border: "1px solid #1e293b" }}>
              <div style={{
                height: "100%",
                width: `${progressPct}%`,
                background: progressPct === 100 ? "#4da447" : "#0095da",
                borderRadius: "3px",
                transition: "width 0.35s ease, background 0.2s",
              }} />
            </div>
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
              placeholder="Optional project description…" rows={2}
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
                  Copies checklist config, custom items, and milestones. Members are not copied.
                </p>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <button type="button" onClick={onClose} disabled={loading}
              style={{ flex: 1, padding: "12px", background: "#334155", color: "#f1f5f9", border: "none", borderRadius: "8px", fontSize: "14px", cursor: loading ? "not-allowed" : "pointer", fontFamily: "Manrope, sans-serif" }}>
              Cancel
            </button>
            <button type="submit" disabled={loading || (useTemplate && !templateProjectId)}
              style={{
                flex: 1, padding: "12px", background: "#0095da", color: "white", border: "none",
                borderRadius: "8px", fontSize: "14px", fontWeight: "600", fontFamily: "Manrope, sans-serif",
                cursor: (loading || (useTemplate && !templateProjectId)) ? "not-allowed" : "pointer",
                opacity: (loading || (useTemplate && !templateProjectId)) ? 0.7 : 1,
              }}>
              {loading ? "Creating…" : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
