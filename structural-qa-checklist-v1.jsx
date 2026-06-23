import React, { useState, useEffect, useRef } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, LabelList,
} from "recharts";
import {
  LayoutDashboard, Settings, CheckCircle2, Circle, MinusCircle,
  HelpCircle, Plus, Trash2, RotateCcw, AlertTriangle, Clock,
  User, Layers, RefreshCw, X, Eye, ShieldCheck,
} from "lucide-react";

const SCHEMA = 5;

/* ------------------------------------------------------------------ */
/*  Theme                                                              */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#eef1f4", panel: "#ffffff", ink: "#1b2733", sub: "#5b6b7a", line: "#dce2e8",
  brand: "#234a6e", brandDk: "#16324c",
  complete: "#1f8a4c", open: "#9aa7b4", overdue: "#d98014", outdated: "#cf3a3a",
  na: "#7a8896", review: "#6b53b8", partial: "#2f80c4",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

const ROLES = ["Engineer", "Reviewer", "Drafter", "PM"];

const PHASE_PRESETS = {
  "SD / DD / CD / Permit": ["SD", "DD", "CD", "Permit"],
  "30 / 60 / 90 / BID / Permit": ["30%", "60%", "90%", "BID", "Permit"],
};

/* Disciplines (sidebar tabs). general is always on. */
const CATEGORIES = [
  { id: "general",        label: "General",                 alwaysOn: true },
  { id: "metaldeck",      label: "Metal Deck / Diaphragm",  toggle: "metaldeck" },
  { id: "compositedeck",  label: "Composite Deck (Floor)",  toggle: "compositedeck" },
  { id: "steel",          label: "Steel Structure",          toggle: "steel" },
  { id: "baseplates",     label: "Base Plates / Anchorage",  toggle: "baseplates" },
  { id: "concrete",       label: "Concrete Frames (CIP)",    toggle: "concrete" },
  { id: "precast",        label: "Pre-Cast",                 toggle: "precast" },
  { id: "tiltup",         label: "Tilt-Up",                  toggle: "tiltup" },
  { id: "foundations",    label: "Foundations",              toggle: "foundations" },
  { id: "drafting",       label: "Drafting",                 toggle: "drafting" },
  { id: "tsd",            label: "TSD Model (Tekla)",         toggle: "tsd" },
  { id: "risafoundation", label: "RISAFoundation",            toggle: "risafoundation" },
  { id: "hilti",          label: "Hilti PROFIS",              toggle: "hilti" },
  { id: "spwall",         label: "spWall",                    toggle: "spwall" },
];

/* Applicability toggles, grouped, shown in the General tab. */
const TOGGLE_GROUPS = [
  { group: "Structural systems", items: [
    { id: "steel",         label: "Steel superstructure (beams / columns)" },
    { id: "concrete",      label: "Cast-in-place concrete frames" },
    { id: "precast",       label: "Pre-cast concrete" },
    { id: "tiltup",        label: "Tilt-up concrete panels" },
    { id: "concreteShearWalls", label: "Concrete shear walls" },
    { id: "metaldeck",     label: "Metal deck / diaphragm (roof)" },
    { id: "compositedeck", label: "Composite deck (floor)" },
    { id: "baseplates",    label: "Base plates & anchorage" },
    { id: "foundations",   label: "Foundations" },
  ]},
  { group: "Software", items: [
    { id: "tsd",            label: "Tekla Structural Designer" },
    { id: "risafoundation", label: "RISAFoundation" },
    { id: "hilti",          label: "Hilti PROFIS Engineering" },
    { id: "spwall",         label: "spWall (StructurePoint)" },
  ]},
  { group: "Workflow", items: [
    { id: "drafting", label: "Drafting / production" },
  ]},
  { group: "Project attributes", items: [
    { id: "fmGlobal",    label: "Must meet FM Global" },
    { id: "highSeismic", label: "High seismic (SDC D / E / F)" },
  ]},
];

/* ------------------------------------------------------------------ */
/*  Seed library                                                       */
/*  phase = due-by phase · reviewAt = review-by phase (optional)       */
/*  requires = toggle conditions · hideIfNA = parent check id          */
/* ------------------------------------------------------------------ */
const SEED_CHECKS = [
  // ---- GENERAL ----
  // Contract & project start
  { id: "gen-proposal", cat: "general", sub: "Contract & project start", phase: "SD", text: "Signed proposal / fee authorization on file for the project?" },
  { id: "gen-expansion", cat: "general", sub: "Contract & project start", phase: "SD", text: "Need for future-expansion provisions verified and addressed?" },
  { id: "gen-kickoff", cat: "general", sub: "Contract & project start", phase: "SD", text: "Project kickoff meeting held?" },
  { id: "gen-template", cat: "general", sub: "Contract & project start", phase: "DD", text: "Typical sheets started from the AG&E SE standard templates (not another project)?" },
  { id: "gen-principal-loads", cat: "general", sub: "Contract & project start", phase: "DD", text: "Design loads reviewed with a Principal?" },
  // Code & loads
  { id: "gen-loc",     cat: "general", sub: "Code & loads", phase: "SD", text: "Is the building location defined?" },
  { id: "gen-codeineffect", cat: "general", sub: "Code & loads", phase: "SD", text: "Building code in effect verified?" },
  { id: "gen-asce",    cat: "general", sub: "Code & loads", phase: "SD", text: "Have ASCE 7 Hazards (wind / seismic / snow / ice) been obtained for the site?" },
  { id: "gen-code",    cat: "general", sub: "Code & loads", phase: "SD", reviewAt: "CD", text: "Has the code search been created and checked?" },
  { id: "gen-rc",      cat: "general", sub: "Code & loads", phase: "SD", text: "Risk Category & importance factors confirmed?" },
  { id: "gen-official", cat: "general", sub: "Code & loads", phase: "SD", text: "All loadings verified with the Building Official (Contact Sheet completed)?" },
  { id: "gen-owner",   cat: "general", sub: "Code & loads", phase: "SD", text: "Owner's special structural loading requirements confirmed (live / wind loads, seismic importance factors, etc.)?" },
  { id: "gen-combos",  cat: "general", sub: "Code & loads", phase: "DD", text: "Governing load combinations (ASCE 7) established for the project?" },
  { id: "gen-crit",    cat: "general", sub: "Code & loads", phase: "DD", text: "Design criteria narrative drafted and shown on drawings?" },
  { id: "gen-wsasd",   cat: "general", sub: "Code & loads", phase: "DD", text: "Wind / seismic loads on drawings clearly noted as ASD or LRFD?" },
  { id: "gen-gravasd", cat: "general", sub: "Code & loads", phase: "DD", text: "Gravity loads and reactions on drawings clearly noted as ASD or LRFD?" },
  { id: "gen-mep",     cat: "general", sub: "Code & loads", phase: "DD", text: "MEP equipment weights list completed from cut sheets, with weights increased by 10%?" },
  { id: "gen-units",   cat: "general", sub: "Code & loads", phase: "DD", text: "Consistent units & sign conventions across all software?" },
  // Vibration
  { id: "gen-vib",     cat: "general", sub: "Vibration", phase: "DD", text: "Floor and frame vibrations addressed?" },
  { id: "gen-vib-issue", cat: "general", sub: "Vibration", phase: "DD", type: "choice", options: ["Yes", "No"], text: "Were any vibration issues identified during design?" },
  { id: "gen-vib-team", cat: "general", sub: "Vibration", phase: "DD", showIf: { check: "gen-vib-issue", answerIn: ["Yes"] }, text: "Vibration issues cleared with the Vibration Analysis team?" },
  // Rooftop screen walls
  { id: "gen-screen", cat: "general", sub: "Rooftop screen walls", phase: "DD", type: "choice", options: ["Yes", "No"], text: "Does the project have rooftop screen walls?" },
  { id: "gen-screen-wind", cat: "general", sub: "Rooftop screen walls", phase: "DD", showIf: { check: "gen-screen", answerIn: ["Yes"] }, text: "Additional wind loads from the screen walls included in the analysis?" },
  { id: "gen-screen-mass", cat: "general", sub: "Rooftop screen walls", phase: "DD", showIf: { check: "gen-screen", answerIn: ["Yes"] }, text: "Mechanical loads behind the screen wall included in the roof mass for seismic?" },
  // Fire & life safety
  { id: "gen-fm-ask", cat: "general", sub: "Fire & life safety", phase: "SD", text: "Architect confirmed whether the project must follow Factory Mutual (FM)? (set applicability in the General toggles above)" },
  { id: "gen-fm-checklist", cat: "general", sub: "Fire & life safety", phase: "DD", requires: [{ toggle: "fmGlobal", value: true }], text: "FM checklist completed?" },
  { id: "gen-fire", cat: "general", sub: "Fire & life safety", phase: "DD", type: "choice", options: ["Yes", "No"], text: "Do the floors and roof require a fire rating?" },
  { id: "gen-fire-slab", cat: "general", sub: "Fire & life safety", phase: "DD", showIf: { check: "gen-fire", answerIn: ["Yes"] }, text: "Does the floor slab thickness satisfy the fire-rating requirement?" },
  { id: "gen-firesep", cat: "general", sub: "Fire & life safety", phase: "DD", type: "choice", options: ["Yes", "No"], text: "Does the building require fire separations?" },
  { id: "gen-firesep-cols", cat: "general", sub: "Fire & life safety", phase: "DD", showIf: { check: "gen-firesep", answerIn: ["Yes"] }, text: "Double columns provided at the fire separations?" },
  // Sustainability
  { id: "gen-leed", cat: "general", sub: "Sustainability", phase: "SD", type: "choice", options: ["Yes", "No"], text: "Is the building pursuing LEED (or a similar program)?" },
  { id: "gen-leed-spec", cat: "general", sub: "Sustainability", phase: "DD", showIf: { check: "gen-leed", answerIn: ["Yes"] }, text: "Do the Submittals Table and Specifications reflect the LEED requirements?" },
  // Model coordination
  { id: "gen-slabedge", cat: "general", sub: "Model coordination", phase: "DD", text: "Slab edge file approved by the Architect?" },
  { id: "gen-openings", cat: "general", sub: "Model coordination", phase: "DD", text: "Confirmation email received from Architect and MEP that all openings are in the model?" },

  // ---- METAL DECK / DIAPHRAGM ----
  { id: "md-grav",   cat: "metaldeck", phase: "DD", text: "Is gravity design complete for the deck (load tables vs. span / loading)?" },
  { id: "md-snow",   cat: "metaldeck", phase: "DD", text: "Was snow drift accounted for in the deck design?" },
  { id: "md-stiff",  cat: "metaldeck", phase: "DD", text: "Was stiffness checked for each deck region considering the actual attachment pattern?" },
  { id: "md-teq",    cat: "metaldeck", phase: "DD", reviewAt: "CD",
    text: "Is deck thickness correctly entered in TSD using the equivalent thickness?",
    help: "Model the diaphragm as an equivalent plate whose in-plane shear rigidity matches the deck's published shear stiffness G' (kip/in) from the SDI DDM or manufacturer table for that profile, gauge, span, and fastener / sidelap pattern.\n\nEquivalent thickness:  t_eq = G' / G_material\n\nwhere G_material is the shear modulus of the material assigned to the equivalent slab in TSD (steel ≈ 11,150 ksi). Confirm units (G' in kip/in, G in ksi → t_eq in in), then verify the resulting drift against the published value." },
  { id: "md-shear",  cat: "metaldeck", phase: "DD", text: "Diaphragm shear demand ≤ allowable for the chosen profile / fastening?" },
  { id: "md-collect",cat: "metaldeck", phase: "DD", text: "Collector / drag forces and chord forces resolved and detailed?" },
  { id: "md-uplift", cat: "metaldeck", phase: "DD", text: "Net wind uplift checked against deck attachment capacity?" },
  { id: "md-fmuplift", cat: "metaldeck", phase: "DD", text: "FM Global uplift rating (e.g. 1-90) confirmed for the roof assembly?", requires: [{ toggle: "fmGlobal", value: true }] },
  { id: "md-drift",  cat: "metaldeck", phase: "CD", text: "Is diaphragm drift below the established limit?" },
  { id: "md-gauge",  cat: "metaldeck", phase: "CD", text: "Deck type, gauge, finish & fastener / sidelap pattern specified on drawings?" },
  { id: "md-constr", cat: "metaldeck", phase: "DD", text: "Bare-deck construction-stage load checked?" },

  // ---- COMPOSITE DECK (FLOOR) ----
  { id: "cmp-action", cat: "compositedeck", phase: "DD", text: "Composite action parameters (stud qty / spacing) consistent with the model?" },
  { id: "cmp-studs",  cat: "compositedeck", phase: "DD", text: "Shear stud design (count, capacity, spacing limits) complete?" },
  { id: "cmp-wet",    cat: "compositedeck", phase: "DD", text: "Wet-concrete / construction (unshored) load checked?" },
  { id: "cmp-defl",   cat: "compositedeck", phase: "DD", text: "Pre-composite & composite deflection (and ponding) checked?" },
  { id: "cmp-fire",   cat: "compositedeck", phase: "DD", text: "Required fire rating / assembly thickness coordinated?" },
  { id: "cmp-diaph",  cat: "compositedeck", phase: "DD", text: "Composite floor diaphragm shear / stiffness checked?" },
  { id: "cmp-gauge",  cat: "compositedeck", phase: "CD", text: "Composite deck type, gauge & topping thickness specified on drawings?" },

  // ---- STEEL ----
  // Framing & layout
  { id: "stl-template", cat: "steel", sub: "Framing & layout", phase: "DD", text: "Steel framing started from the AG&E SE template?" },
  { id: "stl-girder-flange", cat: "steel", sub: "Framing & layout", phase: "DD", text: "Big girders framed into the flanges of columns?" },
  { id: "stl-tw-girder", cat: "steel", sub: "Framing & layout", phase: "DD", requires: [{ toggle: "tiltup", value: true }], type: "choice", options: ["Yes", "No"], text: "Tilt-wall: do big girders frame into the edges of panels?" },
  { id: "stl-tw-girder-col", cat: "steel", sub: "Framing & layout", phase: "DD", requires: [{ toggle: "tiltup", value: true }], showIf: { check: "stl-tw-girder", answerIn: ["Yes"] }, text: "Adding columns at those locations discussed with the Architect?" },
  { id: "stl-hoist", cat: "steel", sub: "Framing & layout", phase: "DD", text: "Hoist beams provided where required in floor and roof framing?" },
  // Design & analysis
  { id: "stl-grades", cat: "steel", sub: "Design & analysis", phase: "SD", text: "Steel grades confirmed (A992 W-shapes, A572 plate, A500 HSS)?" },
  { id: "stl-loads",  cat: "steel", sub: "Design & analysis", phase: "DD", text: "Gravity loads applied (dead, live, collateral, snow, MEP allowances)?" },
  { id: "stl-lfrs",   cat: "steel", sub: "Design & analysis", phase: "SD", text: "Lateral force-resisting system defined (braced / moment / dual)?" },
  { id: "stl-ratios", cat: "steel", sub: "Design & analysis", phase: "DD", text: "All member utilization ratios ≤ 1.0 (strength)?" },
  { id: "stl-defl",   cat: "steel", sub: "Design & analysis", phase: "DD", text: "Deflection limits met (LL L/360, TL L/240, cladding limits)?" },
  { id: "stl-vibr",   cat: "steel", sub: "Design & analysis", phase: "DD", text: "Floor vibration / serviceability checked (AISC DG11)?" },
  { id: "stl-drift",  cat: "steel", sub: "Design & analysis", phase: "DD", text: "Story / building drift within code & cladding limits?" },
  { id: "stl-stab",   cat: "steel", sub: "Design & analysis", phase: "DD", text: "Stability / second-order (P-Δ) effects included per AISC Ch. C?" },
  { id: "stl-composite", cat: "steel", sub: "Design & analysis", phase: "DD", requires: [{ toggle: "compositedeck", value: true }], text: "Effect of openings and floor steps on the composite action of beams checked?" },
  { id: "stl-seis",   cat: "steel", sub: "Design & analysis", phase: "DD", requires: [{ toggle: "highSeismic", value: true }], text: "Seismic detailing (AISC 341) and R / Ω₀ / Cd consistent with the system?" },
  // Roof drainage & ponding
  { id: "stl-slope", cat: "steel", sub: "Roof drainage & ponding", phase: "DD", text: "Minimum 1/4 in/ft slope to all roof drains provided?" },
  { id: "stl-pond-confirm", cat: "steel", sub: "Roof drainage & ponding", phase: "DD", text: "Ponding depth around main roof drains and overflows confirmed with the Architect / plumbing engineer?" },
  { id: "stl-pond-depth", cat: "steel", sub: "Roof drainage & ponding", phase: "DD", type: "choice", options: ["Yes", "No"], text: "Is the ponding depth greater than 3 inches?" },
  { id: "stl-pond-analysis", cat: "steel", sub: "Roof drainage & ponding", phase: "DD", showIf: { check: "stl-pond-depth", answerIn: ["Yes"] }, text: "Ponding instability analysis performed (or confirmed not required)?" },
  { id: "stl-chord", cat: "steel", sub: "Roof drainage & ponding", phase: "DD", type: "choice", options: ["Yes", "No"], text: "Are perimeter roof chord angles used?" },
  { id: "stl-chord-scupper", cat: "steel", sub: "Roof drainage & ponding", phase: "DD", showIf: { check: "stl-chord", answerIn: ["Yes"] }, text: "Perimeter roof chord angle checked against the overflow scupper height for interference?" },
  // Diaphragm & detailing
  { id: "stl-deck-pattern", cat: "steel", sub: "Diaphragm & detailing", phase: "DD", requires: [{ toggle: "metaldeck", value: true }], text: "Metal deck diaphragm: 36/7 fastener pattern provided in corner and edge zones?" },
  { id: "stl-chord-sched", cat: "steel", sub: "Diaphragm & detailing", phase: "CD", showIf: { check: "stl-chord", answerIn: ["Yes"] }, text: "Diaphragm and chord schedules filled out to match the calculations?" },
  { id: "stl-ej",     cat: "steel", sub: "Diaphragm & detailing", phase: "DD", reviewAt: "Permit", text: "Is the expansion joint (EJ) spacing correctly determined and identified in plan?" },
  { id: "stl-camber", cat: "steel", sub: "Diaphragm & detailing", phase: "CD", text: "Camber specified where required?" },
  { id: "stl-conn",   cat: "steel", sub: "Diaphragm & detailing", phase: "CD", text: "Connection design scope defined with reactions on drawings?" },

  // ---- BASE PLATES ----
  { id: "bp-thk",   cat: "baseplates", phase: "DD", text: "Base plate thickness governed by bending checked?" },
  { id: "bp-weld",  cat: "baseplates", phase: "DD", text: "Column-to-base-plate weld designed for demand?" },
  { id: "bp-anc",   cat: "baseplates", phase: "DD", text: "Anchor type, diameter and embedment selected?" },
  { id: "bp-tens",  cat: "baseplates", phase: "DD", text: "Anchor tension / shear interaction checked?" },
  { id: "bp-brk",   cat: "baseplates", phase: "DD", text: "Concrete breakout / pryout / pullout checked (ACI 318 Ch. 17)?" },
  { id: "bp-edge",  cat: "baseplates", phase: "DD", text: "Edge distance & spacing adequate for assumed capacity?" },
  { id: "bp-crack", cat: "baseplates", phase: "DD", text: "Cracked vs. uncracked concrete assumption documented?" },
  { id: "bp-seis",  cat: "baseplates", phase: "DD", text: "Seismic anchorage provisions / ductility (17.10) satisfied?", requires: [{ toggle: "highSeismic", value: true }] },
  { id: "bp-si",    cat: "baseplates", phase: "CD", text: "Special inspection of anchors noted on drawings?" },

  // ---- CONCRETE FRAMES ----
  { id: "cf-fc",    cat: "concrete", phase: "SD", text: "Concrete strengths f'c defined by element?" },
  { id: "cf-rebar", cat: "concrete", phase: "SD", text: "Rebar grade and cover defined?" },
  { id: "cf-flex",  cat: "concrete", phase: "DD", text: "Flexure / shear / axial design complete for beams & columns?" },
  { id: "cf-joint", cat: "concrete", phase: "DD", text: "Beam-column joint shear checked?" },
  { id: "cf-dev",   cat: "concrete", phase: "CD", text: "Development & lap-splice lengths detailed?" },
  { id: "cf-defl",  cat: "concrete", phase: "DD", text: "Long-term deflection / crack control checked?" },
  { id: "cf-duct",  cat: "concrete", phase: "DD", text: "Ductile detailing (ACI 318 Ch. 18) for SDC?", requires: [{ toggle: "highSeismic", value: true }] },

  // ---- PRE-CAST ----
  { id: "pc-design",  cat: "precast", phase: "DD", text: "Pre-cast member design (flexure / shear / handling) complete or clearly delegated?" },
  { id: "pc-conn",    cat: "precast", phase: "DD", text: "Connection design (bearing, ties, corbels) defined?" },
  { id: "pc-bearing", cat: "precast", phase: "CD", text: "Bearing lengths & support conditions detailed?" },
  { id: "pc-topping", cat: "precast", phase: "DD", text: "Topping / diaphragm action at pre-cast floor or roof checked?" },
  { id: "pc-handle",  cat: "precast", phase: "CD", text: "Handling / erection / transport stresses addressed (or delegated)?" },
  { id: "pc-scope",   cat: "precast", phase: "DD", text: "Pre-cast scope & delegated-design responsibilities clearly delineated?" },

  // ---- TILT-UP ----
  { id: "tu-oop",   cat: "tiltup", phase: "DD", text: "Out-of-plane (slender wall, P-Δ) design complete per ACI 318 §11.8?" },
  { id: "tu-ip",    cat: "tiltup", phase: "DD", text: "In-plane shear / overturning of panels checked?" },
  { id: "tu-open",  cat: "tiltup", phase: "DD", text: "Reinforcement around openings / reveals designed?" },
  { id: "tu-conn",  cat: "tiltup", phase: "CD", text: "Panel-to-panel, panel-to-roof and panel-to-footing connections designed?" },
  { id: "tu-lift",  cat: "tiltup", phase: "CD", text: "Lifting / erection stresses addressed (or clearly delegated)?" },
  { id: "tu-brace", cat: "tiltup", phase: "CD", text: "Temporary bracing noted as deferred / delegated design?" },
  { id: "tu-found", cat: "tiltup", phase: "DD", text: "Footings under panels sized for panel + tributary loads?" },

  // ---- FOUNDATIONS ----
  // Geotech & coordination
  { id: "fd-geo",   cat: "foundations", sub: "Geotech & coordination", phase: "SD", text: "Geotechnical report received; bearing / lateral / settlement values captured?" },
  { id: "fd-perfletter", cat: "foundations", sub: "Geotech & coordination", phase: "SD", help: "If the report does not follow the AG&E SE Performance Letter, consult a Principal.", text: "Geotechnical report follows the AG&E SE Performance Letter?" },
  { id: "fd-sog", cat: "foundations", sub: "Geotech & coordination", phase: "DD", text: "Issuing a slab-on-grade letter discussed with a Principal?" },
  { id: "fd-multi", cat: "foundations", sub: "Geotech & coordination", phase: "DD", type: "choice", options: ["Yes", "No"], text: "Did the geotechnical report provide multiple foundation options?" },
  { id: "fd-multi-sel", cat: "foundations", sub: "Geotech & coordination", phase: "DD", showIf: { check: "fd-multi", answerIn: ["Yes"] }, text: "Selected foundation system discussed with the Principal?" },
  { id: "fd-subgrade", cat: "foundations", sub: "Geotech & coordination", phase: "CD", text: "All subgrade preparation notes copied verbatim from the geotechnical report?" },
  { id: "fd-mix", cat: "foundations", sub: "Geotech & coordination", phase: "DD", text: "Concrete mix designs meet the freeze-thaw requirements per code?" },
  { id: "fd-cement", cat: "foundations", sub: "Geotech & coordination", phase: "DD", text: "Geotechnical report reviewed for soil types requiring Type I/II cement, and specified accordingly?" },
  // Shallow foundations / footings
  { id: "fd-bear",  cat: "foundations", sub: "Footings", phase: "DD", text: "Footing sizes verified against allowable bearing (service)?" },
  { id: "fd-topgrade", cat: "foundations", sub: "Footings", phase: "DD", text: "Top of footings verified below exterior grades against the grading plan?" },
  { id: "fd-frost", cat: "foundations", sub: "Footings", phase: "DD", text: "Footings verified to bear below the frost depth against the grading plan?" },
  { id: "fd-void", cat: "foundations", sub: "Footings", phase: "DD", text: "Void form depth matches or exceeds the geotechnical report?" },
  { id: "fd-ot",    cat: "foundations", sub: "Footings", phase: "DD", text: "Overturning / sliding / uplift checked under lateral combinations?" },
  { id: "fd-punch", cat: "foundations", sub: "Footings", phase: "DD", text: "Punching / one-way shear checked (spread, mat, pile caps)?" },
  { id: "fd-reinf", cat: "foundations", sub: "Footings", phase: "CD", text: "Flexural reinforcement designed & detailed?" },
  { id: "fd-deadonly", cat: "foundations", sub: "Footings", phase: "DD", text: "Footings / piers checked separately for dead load only (in addition to DL + sustained LL)?" },
  { id: "fd-dowels", cat: "foundations", sub: "Footings", phase: "CD", text: "Pier / footing dowels into the superstructure sized for the required loading?" },
  { id: "fd-gb",    cat: "foundations", sub: "Footings", phase: "DD", text: "Grade beams / tie beams designed where required?" },
  { id: "fd-ecc", cat: "foundations", sub: "Footings", phase: "DD", requires: [{ toggle: "tiltup", value: true }], text: "Tilt-wall: footings checked for eccentric loading?" },
  // Piers / deep foundations
  { id: "fd-piers", cat: "foundations", sub: "Piers / deep foundations", phase: "SD", type: "choice", options: ["Yes", "No"], text: "Does the project use drilled piers / deep foundations?" },
  { id: "fd-pile",  cat: "foundations", sub: "Piers / deep foundations", phase: "DD", showIf: { check: "fd-piers", answerIn: ["Yes"] }, text: "Pier / pile capacities (axial, lateral, uplift) within geotech limits?" },
  { id: "fd-pier-boring", cat: "foundations", sub: "Piers / deep foundations", phase: "DD", showIf: { check: "fd-piers", answerIn: ["Yes"] }, text: "Piers verified not to extend deeper than the boring depths?" },
  { id: "fd-pier-rock", cat: "foundations", sub: "Piers / deep foundations", phase: "DD", showIf: { check: "fd-piers", answerIn: ["Yes"] }, text: "Pier penetration into bedrock discounts (and adds) the top \"X\" feet per the geotechnical recommendations?" },
  { id: "fd-pier-uplift", cat: "foundations", sub: "Piers / deep foundations", phase: "DD", showIf: { check: "fd-piers", answerIn: ["Yes"] }, text: "Piers checked for uplift?" },
  { id: "fd-pier-squash", cat: "foundations", sub: "Piers / deep foundations", phase: "DD", showIf: { check: "fd-piers", answerIn: ["Yes"] }, text: "Piers checked for squash loads?" },
  { id: "fd-pier-fc", cat: "foundations", sub: "Piers / deep foundations", phase: "DD", showIf: { check: "fd-piers", answerIn: ["Yes"] }, text: "Pier f'c shown matches the squash-load calculations?" },
  { id: "fd-pier-aci", cat: "foundations", sub: "Piers / deep foundations", phase: "DD", showIf: { check: "fd-piers", answerIn: ["Yes"] }, requires: [{ toggle: "concrete", value: true }], text: "Concrete frame: pier f'c verified against ACI 318 Table 19.3.2.1 and against the column strength above?" },
  { id: "fd-pier-anchor", cat: "foundations", sub: "Piers / deep foundations", phase: "CD", showIf: { check: "fd-piers", answerIn: ["Yes"] }, text: "All anchor bolts confirmed to fit within the pier reinforcing cage?" },
  { id: "fd-pier-sched", cat: "foundations", sub: "Piers / deep foundations", phase: "CD", showIf: { check: "fd-piers", answerIn: ["Yes"] }, text: "Pier schedule in calculations matches the pier schedule in drawings?" },
  // Slab & lateral
  { id: "fd-slab-lat", cat: "foundations", sub: "Slab & lateral", phase: "DD", type: "choice", options: ["Slab is part", "Slab is not part"], text: "Is the ground floor slab part of the lateral system?" },
  { id: "fd-slab-reinf", cat: "foundations", sub: "Slab & lateral", phase: "DD", showIf: { check: "fd-slab-lat", answerIn: ["Slab is part"] }, text: "Ground floor slab reinforced appropriately for its role in the lateral system?" },
  { id: "fd-slab-foot", cat: "foundations", sub: "Slab & lateral", phase: "DD", showIf: { check: "fd-slab-lat", answerIn: ["Slab is not part"] }, text: "Lateral resistance checked in individual footings / piers?" },

  // ---- DRAFTING ----
  { id: "dr-beamtag",  cat: "drafting", phase: "CD", perLevel: true, text: "Are all beams tagged?" },
  { id: "dr-foottag",  cat: "drafting", phase: "CD", text: "Are all footings tagged?" },
  { id: "dr-eod",      cat: "drafting", phase: "CD", perLevel: true, text: "Are all EOD (edge-of-deck / slab) dims called out on plans?" },
  { id: "dr-beamdims", cat: "drafting", phase: "CD", perLevel: true, sketch: "beamspans", text: "Are dims between beams called out where beam spans are non-uniform between columns?", help: "Only dimension beam spacing where it is non-uniform. If beams between two columns are equally spaced, no dims are needed; if the spacing varies, each span must be dimensioned. (Final drawing will follow standard drafting.)" },
  { id: "dr-colelev",  cat: "drafting", phase: "CD", text: "Are all column bottom elevations equal to the footing top elevations?" },
  { id: "dr-dynamo",   cat: "drafting", phase: "CD", text: "Is the TSD QC-check Dynamo script run?" },
  { id: "dr-defldiag", cat: "drafting", phase: "CD", text: "Are deflection diagrams created?" },
  { id: "dr-defl0",    cat: "drafting", phase: "CD", perLevel: true, text: "Is deflection 0\" at all columns?", hideIfNA: "dr-defldiag", help: "Deflection must read 0\" at every column. This check confirms the correct reference level was used: if the wrong reference is selected, the deflections will be wrong and will not be 0\" at the columns." },
  { id: "dr-grids",    cat: "drafting", phase: "CD", text: "Are all grids labeled and dimensioned?" },
  { id: "dr-sections", cat: "drafting", phase: "CD", perLevel: true, reviewAt: "CD", reviewerRole: "engineer", text: "Do all detail / section call-outs match the cut details? (review by PM / reviewer engineer required)" },
  { id: "dr-gennotes", cat: "drafting", phase: "DD", text: "Are the general notes current for this phase?" },
  { id: "dr-matsched", cat: "drafting", phase: "DD", text: "Are the material schedules current for this phase?" },
  { id: "dr-title",    cat: "drafting", phase: "CD", text: "Title block, scale, north arrow & sheet index correct?" },
  { id: "dr-revcloud", cat: "drafting", phase: "CD", reviewAt: "Permit", text: "Are revisions clouded & delta-tagged (post-issue)?" },

  // ---- TSD MODEL ----
  // Setup & coordination
  { id: "tsd-units", cat: "tsd", sub: "Setup & coordination", phase: "SD", text: "Model units & sign conventions confirmed?" },
  { id: "tsd-code",  cat: "tsd", sub: "Setup & coordination", phase: "SD", text: "Design code, ASCE 7 edition & combinations set correctly?" },
  { id: "tsd-revit-grids", cat: "tsd", sub: "Setup & coordination", phase: "DD", text: "Are the elevations and grids equal to Revit?" },
  { id: "tsd-revit-base",  cat: "tsd", sub: "Setup & coordination", phase: "DD", text: "Is each column base elevation equal to Revit?" },
  { id: "tsd-minsizes", cat: "tsd", sub: "Setup & coordination", phase: "DD", text: "Are minimum member sizes followed per the AG&E Mission Critical Design Guide?" },
  { id: "tsd-self",  cat: "tsd", sub: "Setup & coordination", phase: "DD", text: "Self-weight included once (no double counting)?" },
  { id: "tsd-diaph", cat: "tsd", sub: "Setup & coordination", phase: "DD", text: "Diaphragm type (rigid / semi-rigid) appropriate; deck t_eq applied?" },
  { id: "tsd-mass",  cat: "tsd", sub: "Setup & coordination", phase: "DD", text: "Seismic mass / modal results sanity-checked?" },
  { id: "tsd-pd",    cat: "tsd", sub: "Setup & coordination", phase: "DD", text: "P-Δ / second-order analysis enabled where required?" },
  { id: "tsd-val",   cat: "tsd", sub: "Setup & coordination", phase: "CD", text: "All validation warnings & analysis errors reviewed / resolved?" },
  { id: "tsd-draw",  cat: "tsd", sub: "Setup & coordination", phase: "CD", text: "Model geometry reconciled against architectural & drawings?" },
  { id: "tsd-revitpush", cat: "tsd", sub: "Setup & coordination", phase: "CD", reviewAt: "Permit", text: "Are the correct sizes pushed to Revit via the TSD–Revit link?" },
  // Members, materials & releases
  { id: "tsd-mat",   cat: "tsd", sub: "Members, materials & releases", phase: "DD", text: "Are all materials correctly set / assigned?" },
  { id: "tsd-propsets", cat: "tsd", sub: "Members, materials & releases", phase: "DD", text: "Are the property sets correctly defined for each member (use Review View to check)?" },
  { id: "tsd-supp",  cat: "tsd", sub: "Members, materials & releases", phase: "DD", text: "Do supports / restraints reflect the real boundary conditions?" },
  { id: "tsd-rel",   cat: "tsd", sub: "Members, materials & releases", phase: "DD", text: "Are member releases correctly defined?" },
  { id: "tsd-brace", cat: "tsd", sub: "Members, materials & releases", phase: "DD", text: "Are the brace work points correct?" },
  { id: "tsd-topflange", cat: "tsd", sub: "Members, materials & releases", phase: "DD", text: "For beams not connected to a diaphragm, is the top flange modeled as continuously unbraced?" },
  { id: "tsd-momplan", cat: "tsd", sub: "Members, materials & releases", phase: "CD", reviewAt: "Permit", text: "Are all moment connections for beams in TSD identified in plan?" },
  { id: "tsd-axplan",  cat: "tsd", sub: "Members, materials & releases", phase: "CD", text: "Are all axial releases identified in plan?" },
  // Expansion joints (answer-driven branching)
  { id: "tsd-ej-has",  cat: "tsd", sub: "Expansion joints (EJs)", phase: "DD", type: "choice", options: ["Yes", "No"], text: "Does the building have expansion joints (EJs)?" },
  { id: "tsd-ej-type", cat: "tsd", sub: "Expansion joints (EJs)", phase: "DD", type: "choice", options: ["Double columns", "Slide bearings"], showIf: { check: "tsd-ej-has", answerIn: ["Yes"] }, text: "Are the EJs formed by double columns or slide bearings?" },
  { id: "tsd-ej-spacing", cat: "tsd", sub: "Expansion joints (EJs)", phase: "DD", showIf: { check: "tsd-ej-type", answerIn: ["Double columns"] }, text: "Is the spacing between the double columns correct?" },
  { id: "tsd-ej-rel",  cat: "tsd", sub: "Expansion joints (EJs)", phase: "DD", showIf: { check: "tsd-ej-type", answerIn: ["Slide bearings"] }, text: "Are the EJ releases correctly set?" },
  { id: "tsd-ej-slots", cat: "tsd", sub: "Expansion joints (EJs)", phase: "CD", showIf: { check: "tsd-ej-type", answerIn: ["Slide bearings"] }, text: "Are the slots sized from the maximum deflections and updated on the drawings?" },
  // Concrete shear walls (only if present)
  { id: "tsd-sw-model", cat: "tsd", sub: "Concrete shear walls", phase: "DD", requires: [{ toggle: "concreteShearWalls", value: true }], text: "Are all concrete shear walls modeled in TSD?" },
  { id: "tsd-sw-open",  cat: "tsd", sub: "Concrete shear walls", phase: "DD", requires: [{ toggle: "concreteShearWalls", value: true }], text: "Are the shear-wall openings correctly modeled?" },
  { id: "tsd-sw-flat",  cat: "tsd", sub: "Concrete shear walls", phase: "DD", requires: [{ toggle: "concreteShearWalls", value: true }], text: "Are all walls connected to the floors / roof using a TSD flat bar?" },
  { id: "tsd-sw-base",  cat: "tsd", sub: "Concrete shear walls", phase: "DD", requires: [{ toggle: "concreteShearWalls", value: true }], text: "Is the wall base support condition modeled consistently with the details?" },
  // Slab on metal deck (only if composite / SOMD floor present)
  { id: "tsd-somd-props", cat: "tsd", sub: "Slab on metal deck (SOMD)", phase: "DD", requires: [{ toggle: "compositedeck", value: true }], text: "Are the slab profile, f'c and diaphragm properties correctly set for the SOMD?" },
  { id: "tsd-somd-span",  cat: "tsd", sub: "Slab on metal deck (SOMD)", phase: "DD", requires: [{ toggle: "compositedeck", value: true }], text: "Is the span direction consistent with the drawings?" },
  { id: "tsd-somd-sep",   cat: "tsd", sub: "Slab on metal deck (SOMD)", phase: "DD", requires: [{ toggle: "compositedeck", value: true }], text: "Are the slabs separated at each bay?" },
  { id: "tsd-somd-open",  cat: "tsd", sub: "Slab on metal deck (SOMD)", phase: "DD", requires: [{ toggle: "compositedeck", value: true }], text: "Are all slab openings modeled, with framing around them?" },
  { id: "tsd-somd-over",  cat: "tsd", sub: "Slab on metal deck (SOMD)", phase: "DD", requires: [{ toggle: "compositedeck", value: true }], text: "Are all slab overhangs modeled correctly per the drawings?" },
  // Footings — SUGGESTED placeholders (your list appeared to be cut off)
  { id: "tsd-ft-support", cat: "tsd", sub: "Footings", phase: "DD", requires: [{ toggle: "foundations", value: true }], text: "Are the correct footing / support types assigned at each column base?" },
  { id: "tsd-ft-fixity",  cat: "tsd", sub: "Footings", phase: "DD", requires: [{ toggle: "foundations", value: true }], text: "Are support fixities (pinned / fixed) consistent with the foundation details?" },
  { id: "tsd-ft-react",   cat: "tsd", sub: "Footings", phase: "DD", requires: [{ toggle: "foundations", value: true }], text: "Are the design reactions exported for foundation design at the correct load combinations?" },
  { id: "tsd-ft-uplift",  cat: "tsd", sub: "Footings", phase: "DD", requires: [{ toggle: "foundations", value: true }], text: "Are uplift / net-tension reactions at footings flagged and addressed?" },

  // ---- RISAFOUNDATION ----
  { id: "rf-import", cat: "risafoundation", phase: "DD", text: "Column / wall reactions imported correctly from the superstructure?" },
  { id: "rf-soil",   cat: "risafoundation", phase: "DD", text: "Soil spring / bearing (subgrade modulus) input per geotech?" },
  { id: "rf-combos", cat: "risafoundation", phase: "DD", text: "Load combinations match the governing code set?" },
  { id: "rf-mesh",   cat: "risafoundation", phase: "DD", text: "Mesh density adequate (convergence checked for mats)?" },
  { id: "rf-soilp",  cat: "risafoundation", phase: "DD", text: "Soil bearing pressures within allowable (no / limited uplift)?" },
  { id: "rf-results",cat: "risafoundation", phase: "CD", text: "Reinforcement results transferred to drawings & rounded sensibly?" },

  // ---- HILTI PROFIS ----
  { id: "hp-prod",  cat: "hilti", phase: "DD", text: "Correct anchor product & approval (ESR / code) selected?" },
  { id: "hp-loads", cat: "hilti", phase: "DD", text: "Applied loads match base-plate reactions (correct combos)?" },
  { id: "hp-crack", cat: "hilti", phase: "DD", text: "Concrete condition (cracked / uncracked) set correctly?" },
  { id: "hp-edge",  cat: "hilti", phase: "DD", text: "Edge distances, spacing & member thickness match the real condition?" },
  { id: "hp-seis",  cat: "hilti", phase: "DD", text: "Seismic design option enabled where applicable?", requires: [{ toggle: "highSeismic", value: true }] },
  { id: "hp-report",cat: "hilti", phase: "CD", text: "Final PROFIS report saved to the project folder?" },

  // ---- spWall ----
  { id: "sw-geom",  cat: "spwall", phase: "DD", text: "Wall geometry, thickness & f'c entered correctly?" },
  { id: "sw-loads", cat: "spwall", phase: "DD", text: "Axial, in-plane shear & out-of-plane moments match the model?" },
  { id: "sw-reinf", cat: "spwall", phase: "DD", text: "Reinforcement layout (curtains, boundary elements) defined?" },
  { id: "sw-pm",    cat: "spwall", phase: "DD", text: "P-M interaction & demand points within the capacity envelope?" },
  { id: "sw-slen",  cat: "spwall", phase: "DD", text: "Slenderness / second-order effects considered?" },
  { id: "sw-crack", cat: "spwall", phase: "CD", text: "Crack width / deflection serviceability acceptable?" },
];

const DEFAULT_TOGGLES = {
  steel: true, concrete: false, precast: false, tiltup: false, concreteShearWalls: false,
  metaldeck: true, compositedeck: true, baseplates: true, foundations: true,
  tsd: true, risafoundation: true, hilti: true, spwall: false,
  drafting: true, fmGlobal: false, highSeismic: false,
};

function freshState() {
  return {
    schemaVersion: SCHEMA,
    rev: 0,
    project: { name: "New Project", number: "", client: "", criteria: "" },
    phases: ["SD", "DD", "CD", "Permit"],
    currentPhase: "DD",
    phaseDates: {},
    levels: ["Roof"],
    toggles: { ...DEFAULT_TOGGLES },
    library: SEED_CHECKS.map((c) => ({ ...c })),
    status: {},
  };
}

function migrate(st) {
  if (st && st.schemaVersion === SCHEMA) { st.rev = st.rev || 0; st.phaseDates = st.phaseDates || {}; st.levels = st.levels || ["Roof"]; return st; }
  const base = freshState();
  if (st) {
    base.rev = (st.rev || 0) + 1;
    base.project = { ...base.project, ...(st.project || {}) };
    base.phases = st.phases || base.phases;
    base.currentPhase = st.currentPhase || base.currentPhase;
    base.phaseDates = st.phaseDates || base.phaseDates;
    base.levels = st.levels || base.levels;
    base.toggles = { ...base.toggles, ...(st.toggles || {}) };
    const oldById = Object.fromEntries((st.library || []).map((c) => [c.id, c]));
    base.library = SEED_CHECKS.map((c) => {
      const o = oldById[c.id];
      return o ? { ...c, phase: o.phase || c.phase, text: o.text || c.text } : { ...c };
    });
    const have = new Set(base.library.map((c) => c.id));
    base.library.push(...(st.library || []).filter((c) => c.custom && !have.has(c.id)));
    const ids = new Set(base.library.map((c) => c.id));
    base.status = Object.fromEntries(Object.entries(st.status || {}).filter(([k]) => ids.has(k)));
  }
  return base;
}

/* ------------------------------------------------------------------ */
/*  UI atoms                                                           */
/* ------------------------------------------------------------------ */
const SKETCHES = {
  beamspans: `<svg viewBox="0 0 360 150" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:#fff;border-radius:6px;margin-top:8px">
    <g stroke="#1b2733" stroke-width="1.4" fill="none">
      <!-- left: equally spaced -->
      <line x1="30" y1="22" x2="150" y2="22"/><line x1="30" y1="118" x2="150" y2="118"/>
      <line x1="30" y1="14" x2="30" y2="30"/><line x1="150" y1="14" x2="150" y2="30"/>
      <line x1="30" y1="110" x2="30" y2="126"/><line x1="150" y1="110" x2="150" y2="126"/>
      <line x1="60" y1="30" x2="60" y2="110"/><line x1="90" y1="30" x2="90" y2="110"/><line x1="120" y1="30" x2="120" y2="110"/>
      <!-- right: unequally spaced with dims -->
      <line x1="210" y1="22" x2="330" y2="22"/><line x1="210" y1="118" x2="330" y2="118"/>
      <line x1="210" y1="14" x2="210" y2="30"/><line x1="330" y1="14" x2="330" y2="30"/>
      <line x1="210" y1="110" x2="210" y2="126"/><line x1="330" y1="110" x2="330" y2="126"/>
      <line x1="232" y1="30" x2="232" y2="110"/><line x1="272" y1="30" x2="272" y2="110"/><line x1="300" y1="30" x2="300" y2="110"/>
      <line x1="210" y1="80" x2="330" y2="80" stroke-dasharray="0"/>
    </g>
    <g fill="#234a6e" font-size="9" font-family="monospace">
      <text x="36" y="142">equal — no dims</text>
      <text x="216" y="142">unequal — dim each span</text>
    </g>
  </svg>`,
};

function InfoHint({ text, sketch }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="qa-hintbtn" onClick={() => setOpen((o) => !o)} aria-label="Help"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", color: C.sub }}>
        <HelpCircle size={15} />
      </button>
      {open && (
        <span style={{
          position: "absolute", zIndex: 50, top: "120%", left: "50%", transform: "translateX(-50%)",
          width: sketch ? 360 : 330, background: C.ink, color: "#eef2f6", fontSize: 12.5, lineHeight: 1.55,
          padding: "10px 12px", borderRadius: 8, boxShadow: "0 8px 24px rgba(15,30,45,.28)", whiteSpace: "pre-wrap",
        }}>
          {text}
          {sketch && SKETCHES[sketch] && <span style={{ display: "block" }} dangerouslySetInnerHTML={{ __html: SKETCHES[sketch] }} />}
        </span>
      )}
    </span>
  );
}

function Stat({ label, value, color, sub }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "13px 15px", flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: C.sub, fontFamily: C.mono }}>{label}</div>
      <div style={{ fontSize: 27, fontWeight: 700, color: color || C.ink, lineHeight: 1.1, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const panelStyle = () => ({ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 });
const panelHeadStyle = () => ({ fontSize: 13, margin: "0 0 10px", color: C.sub, textTransform: "uppercase", letterSpacing: ".05em", fontFamily: C.mono });
const inputStyle = () => ({ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, outline: "none", color: C.ink });
const pillStyle = () => ({ display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer", color: C.ink, fontWeight: 500 });
const miniBtn = () => ({ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 7px", cursor: "pointer", fontSize: 12, display: "inline-flex", color: C.sub });
const badge = (color) => ({ display: "inline-flex", alignItems: "center", gap: 3, color, background: color + "1a", borderRadius: 6, padding: "1px 7px", fontWeight: 600, fontSize: 11 });

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function computeDue(phaseDates, phase, daysBefore) {
  const iso = phaseDates && phase ? phaseDates[phase] : null;
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - (Number(daysBefore) || 0));
  d.setHours(0, 0, 0, 0);
  return d;
}
function dueBadge(due) {
  if (!due) return null;
  const t = startOfToday();
  if (due.getTime() < t.getTime()) return "pastdue";
  if (due.getTime() === t.getTime()) return "duetoday";
  return null;
}
function fmtDate(d) { return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""; }

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
export default function App() {
  const [state, setState] = useState(null);
  const [user, setUser] = useState("");
  const [role, setRole] = useState("Engineer");
  const [view, setView] = useState("dashboard");
  const [storageOK, setStorageOK] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const lastSaved = useRef("");
  const revRef = useRef(0);

  useEffect(() => {
    (async () => {
      let st = null;
      try { const r = await window.storage.get("qa-state", true); if (r && r.value) st = JSON.parse(r.value); } catch {}
      st = migrate(st);
      revRef.current = st.rev || 0;
      lastSaved.current = JSON.stringify(st);
      setState(st);
      try { await window.storage.set("qa-state", lastSaved.current, true); } catch { setStorageOK(false); }
      try { const u = await window.storage.get("qa-user", false); if (u && u.value) setUser(u.value); } catch {}
      try { const rr = await window.storage.get("qa-role", false); if (rr && rr.value) setRole(rr.value); } catch {}
    })();
  }, []);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await window.storage.get("qa-state", true);
        if (r && r.value && r.value !== lastSaved.current) {
          const remote = JSON.parse(r.value);
          if ((remote.rev || 0) > revRef.current) {
            revRef.current = remote.rev || 0;
            lastSaved.current = r.value;
            setState(remote);
          }
        }
      } catch {}
    }, 12000);
    return () => clearInterval(t);
  }, []);

  const save = async (next) => {
    setState(next); // optimistic
    try {
      const r = await window.storage.get("qa-state", true);
      const remote = r && r.value ? JSON.parse(r.value) : null;
      let merged;
      if (remote && typeof remote.rev === "number" && remote.rev >= revRef.current) {
        // remote reflects at least our last write -> safe to merge in others' edits
        merged = { status: mergeStatus(state.status, next.status, remote.status || {}), rev: remote.rev + 1 };
        ["schemaVersion", "project", "phases", "currentPhase", "phaseDates", "levels", "toggles", "library"].forEach((k) => {
          merged[k] = next[k] !== state[k] ? next[k] : (k in remote ? remote[k] : next[k]);
        });
      } else {
        // no remote, or the read is stale/older than our state -> our state is authoritative
        merged = { ...next, rev: revRef.current + 1 };
      }
      const str = JSON.stringify(merged);
      await window.storage.set("qa-state", str, true);
      revRef.current = merged.rev;
      lastSaved.current = str;
      setState(merged);
    } catch { setStorageOK(false); }
  };
  const saveUser = async (n) => { setUser(n); try { await window.storage.set("qa-user", n, false); } catch {} };
  const saveRole = async (r) => { setRole(r); try { await window.storage.set("qa-role", r, false); } catch {} };
  const manualSync = async () => {
    setSyncing(true);
    try { const r = await window.storage.get("qa-state", true); if (r && r.value) { const remote = JSON.parse(r.value); revRef.current = remote.rev || 0; lastSaved.current = r.value; setState(remote); } } catch {}
    setTimeout(() => setSyncing(false), 500);
  };

  if (!state) return <div style={{ fontFamily: "system-ui", padding: 40, color: C.sub }}>Loading checklist…</div>;

  const phaseIdx = (p) => state.phases.indexOf(p);
  const curIdx = phaseIdx(state.currentPhase);
  const statusOf = (id) => state.status[id]?.state || "open";
  const stampOf = (id) => state.status[id];
  const validReview = (c) => c.reviewAt && phaseIdx(c.reviewAt) > -1 ? c.reviewAt : null;

  const checkVisible = (c) => {
    const cat = CATEGORIES.find((x) => x.id === c.cat);
    if (cat && cat.toggle && !state.toggles[cat.toggle]) return false;
    if (c.requires) for (const r of c.requires) if (state.toggles[r.toggle] !== r.value) return false;
    if (c.hideIfNA) {
      const parent = state.library.find((p) => p.id === c.hideIfNA);
      if (!parent || !checkVisible(parent)) return false;
      if ((state.status[parent.id]?.state) === "na") return false;
    }
    if (c.showIf) {
      const parent = state.library.find((p) => p.id === c.showIf.check);
      if (!parent || !checkVisible(parent)) return false;
      const ans = state.status[parent.id]?.answer;
      if (!c.showIf.answerIn.includes(ans)) return false;
    }
    return true;
  };
  const visibleChecks = state.library.filter(checkVisible);

  const perLevelLevels = ["Foundation", ...(state.levels || [])];
  const unitsOf = (c) => (c.perLevel ? perLevelLevels.map((l) => `${c.id}::${l}`) : [c.id]);

  const metricsFor = (checks) => {
    let complete = 0, partial = 0, na = 0, pastdue = 0, duetoday = 0, outdated = 0, pendingReview = 0, relevant = 0, doneFraction = 0;
    checks.forEach((c) => {
      const units = unitsOf(c);
      let allComplete = true, anyUnit = false;
      units.forEach((u) => {
        const st = state.status[u], s = st?.state || "open";
        if (s === "na") { na++; allComplete = false; return; }
        anyUnit = true; relevant++;
        if (s === "complete") {
          complete++; doneFraction += 1;
          if (st && phaseIdx(st.phase) > -1 && phaseIdx(st.phase) < curIdx) outdated++;
        } else if (s === "partial") {
          partial++; doneFraction += (st.pct || 0) / 100; allComplete = false;
        } else { allComplete = false; }
        if (s !== "complete") {
          const due = computeDue(state.phaseDates, c.phase, c.daysBefore);
          if (due) { const b = dueBadge(due); if (b === "pastdue") pastdue++; else if (b === "duetoday") duetoday++; }
          else if (phaseIdx(c.phase) > -1 && phaseIdx(c.phase) <= curIdx) pastdue++;
        }
      });
      const ra = validReview(c);
      if (ra && phaseIdx(ra) <= curIdx && anyUnit && allComplete && !state.status[c.id]?.review) pendingReview++;
    });
    const open = relevant - complete - partial;
    const pct = relevant ? Math.round((doneFraction / relevant) * 100) : 0;
    return { total: checks.length, complete, partial, na, open, pastdue, duetoday, outdated, pendingReview, relevant, pct };
  };
  const M = metricsFor(visibleChecks);

  /* mutations */
  const setStatus = (id, newState) => {
    const cur = state.status[id]?.state;
    const next = { ...state, status: { ...state.status } };
    if (newState === "open" || (cur === newState && newState !== "open")) delete next.status[id];
    else next.status[id] = { state: newState, by: user || "Unknown", role, at: new Date().toISOString(), phase: state.currentPhase };
    save(next);
  };
  const setReview = (id) => {
    const cur = state.status[id] || {};
    const entry = { ...cur };
    if (cur.review) delete entry.review;
    else entry.review = { by: user || "Unknown", role, at: new Date().toISOString(), phase: state.currentPhase };
    const next = { ...state, status: { ...state.status } };
    if (!entry.state && !entry.answer && !entry.review) delete next.status[id];
    else next.status[id] = entry;
    save(next);
  };
  const setPartial = (id, pct) => {
    const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    const cur = state.status[id] || {};
    const next = { ...state, status: { ...state.status, [id]: { ...cur, state: "partial", pct: p, by: user || "Unknown", role, at: new Date().toISOString(), phase: state.currentPhase } } };
    save(next);
  };
  const setAnswer = (id, option) => {
    const cur = state.status[id];
    const next = { ...state, status: { ...state.status } };
    if (cur && cur.answer === option) delete next.status[id];
    else next.status[id] = { state: "complete", answer: option, by: user || "Unknown", role, at: new Date().toISOString(), phase: state.currentPhase };
    save(next);
  };
  const setField = (id, key, val) => save({ ...state, library: state.library.map((c) => c.id === id ? { ...c, [key]: val || undefined } : c) });
  const addCheck = (cat, text) => {
    if (!text.trim()) return;
    const id = `${cat}-x${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    save({ ...state, library: [...state.library, { id, cat, phase: state.currentPhase, text: text.trim(), custom: true }] });
  };
  const removeCheck = (id) => {
    const status = { ...state.status };
    Object.keys(status).forEach((k) => { if (k === id || k.startsWith(`${id}::`)) delete status[k]; });
    save({ ...state, library: state.library.filter((c) => c.id !== id), status });
  };

  const enabledCats = CATEGORIES.filter((c) => c.alwaysOn || state.toggles[c.toggle]);
  const rowProps = { state, user, statusOf, stampOf, curIdx, phaseIdx, validReview, setStatus, setReview, setAnswer, setPartial, setField, addCheck, removeCheck, phaseDates: state.phaseDates, perLevelLevels };

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: C.ink, background: C.bg, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{`
        .qa-nav{transition:background .12s,color .12s}.qa-nav:hover{background:#e3e9ef}
        .qa-stbtn{transition:transform .08s}.qa-stbtn:hover{transform:translateY(-1px)}
        .qa-hintbtn:hover{color:${C.brand}}.qa-row:hover{background:#f7f9fb}
        select,input,button{font-family:inherit}
        @media (prefers-reduced-motion: reduce){*{transition:none!important}}
      `}</style>

      <header style={{ background: C.brandDk, color: "#fff", padding: "0 18px", minHeight: 58, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Layers size={20} /><div style={{ fontWeight: 700 }}>AG&amp;E QA Checklist</div>
          <span style={{ fontFamily: C.mono, fontSize: 12, opacity: .65 }}>/ structural</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12, opacity: .8 }}>Phase</span>
          <select value={state.currentPhase} onChange={(e) => save({ ...state, currentPhase: e.target.value })}
            style={{ background: C.brand, color: "#fff", border: "none", borderRadius: 7, padding: "6px 9px", fontWeight: 600, fontFamily: C.mono }}>
            {state.phases.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.1)", borderRadius: 7, padding: "4px 9px" }}>
          <User size={15} />
          <input placeholder="your name" value={user} onChange={(e) => saveUser(e.target.value)}
            style={{ background: "transparent", border: "none", color: "#fff", outline: "none", width: 96, fontSize: 13 }} />
          <select value={role} onChange={(e) => saveRole(e.target.value)}
            style={{ background: "transparent", color: "#cfe0ee", border: "none", fontSize: 12, outline: "none" }}>
            {ROLES.map((r) => <option key={r} value={r} style={{ color: "#000" }}>{r}</option>)}
          </select>
        </div>
        <button className="qa-stbtn" onClick={manualSync} title="Sync now"
          style={{ background: "rgba(255,255,255,.1)", border: "none", color: "#fff", borderRadius: 7, padding: 7, cursor: "pointer", display: "flex" }}>
          <RefreshCw size={15} />
        </button>
      </header>

      {!storageOK && (
        <div style={{ background: "#fdecd2", color: "#7a4b06", padding: "8px 16px", fontSize: 13 }}>
          Working offline — shared sync is unavailable in this preview. Changes stay in this session only.
        </div>
      )}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <nav style={{ width: 240, background: C.panel, borderRight: `1px solid ${C.line}`, padding: 10, overflowY: "auto" }}>
          {[{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }, { id: "setup", label: "Project Setup", icon: Settings }].map((n) => {
            const Icon = n.icon;
            return <button key={n.id} className="qa-nav" onClick={() => setView(n.id)} style={navStyle(view === n.id)}><Icon size={16} /> {n.label}</button>;
          })}
          <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: C.sub, fontFamily: C.mono, margin: "14px 8px 6px" }}>Sectors</div>
          {enabledCats.map((cat) => {
            const m = metricsFor(visibleChecks.filter((c) => c.cat === cat.id));
            return (
              <button key={cat.id} className="qa-nav" onClick={() => setView(cat.id)} style={navStyle(view === cat.id)}>
                <span style={{ flex: 1, textAlign: "left" }}>{cat.label}</span>
                {cat.id !== "general" || m.total > 0 ? <span style={{ fontFamily: C.mono, fontSize: 11, color: m.pct === 100 ? C.complete : C.sub }}>{m.pct}%</span> : null}
              </button>
            );
          })}
        </nav>

        <main style={{ flex: 1, overflowY: "auto", padding: 22 }}>
          {view === "dashboard" && <Dashboard M={M} state={state} metricsFor={metricsFor} visibleChecks={visibleChecks} enabledCats={enabledCats} />}
          {view === "setup" && <Setup state={state} save={save} />}
          {view === "general" && (
            <GeneralView state={state} save={save} checks={visibleChecks.filter((c) => c.cat === "general")} {...rowProps} />
          )}
          {enabledCats.some((c) => c.id === view && c.id !== "general") && (
            <CategoryView cat={CATEGORIES.find((c) => c.id === view)} checks={visibleChecks.filter((c) => c.cat === view)} {...rowProps} />
          )}
        </main>
      </div>
    </div>
  );
}

function navStyle(active) {
  return { display: "flex", alignItems: "center", gap: 9, width: "100%", background: active ? C.brand : "transparent", color: active ? "#fff" : C.ink, border: "none", borderRadius: 8, padding: "9px 11px", fontSize: 13.5, fontWeight: active ? 600 : 500, cursor: "pointer", marginBottom: 3, textAlign: "left" };
}

/* ------------------------------------------------------------------ */
/*  Dashboard                                                          */
/* ------------------------------------------------------------------ */
function Dashboard({ M, state, metricsFor, visibleChecks, enabledCats }) {
  const pieData = [
    { name: "Done", value: M.complete, color: C.complete },
    { name: "Partial", value: M.partial, color: C.partial },
    { name: "Open", value: M.open, color: C.open },
    { name: "N/A", value: M.na, color: C.na },
  ].filter((d) => d.value > 0);
  const barData = enabledCats.map((cat) => ({ name: cat.label.replace(/ \(.*\)/, ""), pct: metricsFor(visibleChecks.filter((c) => c.cat === cat.id)).pct }));

  return (
    <div style={{ maxWidth: 1020 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 2px" }}>{state.project.name || "Project"} <span style={{ fontFamily: C.mono, fontSize: 14, color: C.sub }}>{state.project.number}</span></h1>
      <p style={{ color: C.sub, marginTop: 0, fontSize: 13.5 }}>Current phase <b style={{ fontFamily: C.mono, color: C.brand }}>{state.currentPhase}</b> · {M.relevant} applicable items</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "16px 0" }}>
        <Stat label="Done" value={`${M.pct}%`} color={C.complete} sub={`${M.complete} done · ${M.partial} partial`} />
        <Stat label="Not complete" value={`${100 - M.pct}%`} color={C.open} sub={`${M.open} open`} />
        <Stat label="Past due" value={M.pastdue} color={C.outdated} sub="due date passed" />
        <Stat label="Due today" value={M.duetoday} color={C.overdue} sub="due today" />
        <Stat label="Pending review" value={M.pendingReview} color={C.review} sub="awaiting reviewer" />
        <Stat label="N/A" value={M.na} color={C.na} sub="not applicable" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16 }}>
        <div style={panelStyle()}>
          <h3 style={panelHeadStyle()}>Overall status</h3>
          <div style={{ height: 230 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie><RTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap", fontSize: 12.5 }}>
            {pieData.map((d) => <span key={d.name} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} /> {d.name} ({d.value})</span>)}
          </div>
        </div>
        <div style={panelStyle()}>
          <h3 style={panelHeadStyle()}>Completion by sector</h3>
          <div style={{ height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 32 }}>
                <CartesianGrid horizontal={false} stroke={C.line} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: C.sub }} unit="%" />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: C.ink }} />
                <RTooltip formatter={(v) => `${v}%`} />
                <Bar dataKey="pct" radius={[0, 5, 5, 0]} fill={C.brand} barSize={14}>
                  <LabelList dataKey="pct" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 11, fill: C.sub }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ ...panelStyle(), marginTop: 16, fontSize: 12.5, color: C.sub, lineHeight: 1.6 }}>
        <b style={{ color: C.ink }}>How status is computed:</b>{" "}
        Each check is due a set number of days before its phase's issuance date (set in Project Setup).{" "}
        <span style={{ color: C.outdated, fontWeight: 600 }}>Past due</span> = not complete and the due date has passed (or, if no date is set, its phase is at/before the current one).{" "}
        <span style={{ color: C.overdue, fontWeight: 600 }}>Due today</span> = due date is today.{" "}
        <span style={{ color: C.partial, fontWeight: 600 }}>Partial</span> items count by their percentage toward completion.{" "}
        <span style={{ color: C.review, fontWeight: 600 }}>Pending review</span> = all parts done, review phase reached, no reviewer sign-off yet.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */
function Setup({ state, save }) {
  const [newPhase, setNewPhase] = useState("");
  const [newLevel, setNewLevel] = useState("");
  const upd = (patch) => save({ ...state, ...patch });
  const updProj = (patch) => save({ ...state, project: { ...state.project, ...patch } });
  const applyPreset = (name) => { const phases = PHASE_PRESETS[name]; save({ ...state, phases, currentPhase: phases.includes(state.currentPhase) ? state.currentPhase : phases[0] }); };
  const addPhase = () => { const p = newPhase.trim(); if (p && !state.phases.includes(p)) { upd({ phases: [...state.phases, p] }); setNewPhase(""); } };
  const removePhase = (p) => { if (state.phases.length > 1) upd({ phases: state.phases.filter((x) => x !== p), currentPhase: state.currentPhase === p ? state.phases.filter((x) => x !== p)[0] : state.currentPhase }); };
  const movePhase = (i, d) => { const ph = [...state.phases], j = i + d; if (j < 0 || j >= ph.length) return; [ph[i], ph[j]] = [ph[j], ph[i]]; upd({ phases: ph }); };
  const setPhaseDate = (p, v) => save({ ...state, phaseDates: { ...state.phaseDates, [p]: v || undefined } });
  const levels = state.levels || ["Roof"];
  const addLevel = () => { const l = newLevel.trim(); if (l && !levels.includes(l)) { upd({ levels: [...levels, l] }); setNewLevel(""); } };
  const removeLevel = (l) => { if (levels.length > 1) upd({ levels: levels.filter((x) => x !== l) }); };
  const moveLevel = (i, d) => { const lv = [...levels], j = i + d; if (j < 0 || j >= lv.length) return; [lv[i], lv[j]] = [lv[j], lv[i]]; upd({ levels: lv }); };

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 16px" }}>Project Setup</h1>
      <div style={{ ...panelStyle(), marginBottom: 16 }}>
        <h3 style={panelHeadStyle()}>Project information</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Project name" value={state.project.name} onChange={(v) => updProj({ name: v })} />
          <Field label="Project number" value={state.project.number} onChange={(v) => updProj({ number: v })} mono />
          <Field label="Client" value={state.project.client} onChange={(v) => updProj({ client: v })} />
          <Field label="Design criteria ref." value={state.project.criteria} onChange={(v) => updProj({ criteria: v })} />
        </div>
      </div>
      <div style={{ ...panelStyle(), marginBottom: 16 }}>
        <h3 style={panelHeadStyle()}>Phases &amp; issuance dates</h3>
        <p style={{ fontSize: 12.5, color: C.sub, marginTop: -4 }}>Set the issuance date for each phase. A check's due date = issuance date − its "days before". Phases can be added anytime (e.g. permit addendums).</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {Object.keys(PHASE_PRESETS).map((n) => <button key={n} onClick={() => applyPreset(n)} style={pillStyle()}>{n}</button>)}
        </div>
        {state.phases.map((p, i) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
            <span style={{ fontFamily: C.mono, fontWeight: 600, flex: 1 }}>{i + 1}. {p}</span>
            <input type="date" value={state.phaseDates?.[p] || ""} onChange={(e) => setPhaseDate(p, e.target.value)}
              style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: "4px 7px", fontSize: 12, fontFamily: C.mono, color: C.brand }} />
            <button onClick={() => movePhase(i, -1)} style={miniBtn()}>↑</button>
            <button onClick={() => movePhase(i, 1)} style={miniBtn()}>↓</button>
            <button onClick={() => removePhase(p)} style={{ ...miniBtn(), color: C.outdated }}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input placeholder="Add phase (e.g. Permit Addendum 1)" value={newPhase} onChange={(e) => setNewPhase(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPhase()} style={inputStyle()} />
          <button onClick={addPhase} style={{ ...pillStyle(), background: C.brand, color: "#fff", borderColor: C.brand }}><Plus size={14} /> Add</button>
        </div>
      </div>
      <div style={{ ...panelStyle(), marginBottom: 16 }}>
        <h3 style={panelHeadStyle()}>Building levels</h3>
        <p style={{ fontSize: 12.5, color: C.sub, marginTop: -4 }}>Per-level drafting checks (beam tags, EOD dims, beam dims, section call-outs, deflection) are tracked once per level. "Foundation" is always included automatically.</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.line}`, color: C.sub }}>
          <span style={{ fontFamily: C.mono, fontWeight: 600, flex: 1 }}>Foundation</span>
          <span style={{ fontSize: 11, fontStyle: "italic" }}>always included</span>
        </div>
        {levels.map((l, i) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
            <span style={{ fontFamily: C.mono, fontWeight: 600, flex: 1 }}>{l}</span>
            <button onClick={() => moveLevel(i, -1)} style={miniBtn()}>↑</button>
            <button onClick={() => moveLevel(i, 1)} style={miniBtn()}>↓</button>
            <button onClick={() => removeLevel(l)} style={{ ...miniBtn(), color: C.outdated }}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input placeholder="Add level (e.g. Level 2, Mezzanine, Platform)" value={newLevel} onChange={(e) => setNewLevel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLevel()} style={inputStyle()} />
          <button onClick={addLevel} style={{ ...pillStyle(), background: C.brand, color: "#fff", borderColor: C.brand }}><Plus size={14} /> Add</button>
        </div>
      </div>
      <div style={panelStyle()}>
        <h3 style={panelHeadStyle()}>Reset</h3>
        <p style={{ fontSize: 12.5, color: C.sub, marginTop: -4 }}>Applicable sectors are now set in the General tab.</p>
        <button onClick={() => { if (window.confirm("Reset all checks, phases and sign-offs to the built-in defaults?")) save(freshState()); }}
          style={{ ...pillStyle(), color: C.outdated, borderColor: C.outdated }}><RotateCcw size={14} /> Reset to defaults</button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, mono }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 11.5, color: C.sub, fontFamily: C.mono, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle(), marginTop: 4, fontFamily: mono ? C.mono : "inherit" }} />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/*  General tab = applicability toggles + general checks               */
/* ------------------------------------------------------------------ */
function GeneralView({ state, save, checks, ...rp }) {
  const updToggle = (id, v) => save({ ...state, toggles: { ...state.toggles, [id]: v } });
  return (
    <div style={{ maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>General</h1>
      <p style={{ color: C.sub, marginTop: 0, fontSize: 13.5 }}>Mark which systems, software and attributes apply. Unchecking one removes its sector and all its checks.</p>

      <div style={{ ...panelStyle(), marginBottom: 18 }}>
        <h3 style={panelHeadStyle()}>Applicable to this project</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
          {TOGGLE_GROUPS.map((g) => (
            <div key={g.group}>
              <div style={{ fontSize: 11, color: C.brand, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", margin: "8px 0 2px" }}>{g.group}</div>
              {g.items.map((t) => (
                <label key={t.id} className="qa-row" style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px", borderRadius: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!state.toggles[t.id]} onChange={(e) => updToggle(t.id, e.target.checked)} style={{ width: 16, height: 16, accentColor: C.brand }} />
                  <span style={{ fontSize: 13.5 }}>{t.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      <h3 style={{ ...panelHeadStyle(), fontSize: 14, color: C.ink }}>General checks</h3>
      <CheckList catId="general" checks={checks} state={state} {...rp} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Category view                                                      */
/* ------------------------------------------------------------------ */
function CategoryView({ cat, checks, state, statusOf, ...rp }) {
  const m = (() => {
    let complete = 0, na = 0;
    checks.forEach((c) => { const s = statusOf(c.id); if (s === "complete") complete++; else if (s === "na") na++; });
    const relevant = checks.length - na;
    return { complete, relevant, pct: relevant ? Math.round((complete / relevant) * 100) : 0 };
  })();
  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 2px" }}>{cat.label}</h1>
        <span style={{ fontFamily: C.mono, fontSize: 14, color: m.pct === 100 ? C.complete : C.sub }}>{m.pct}% · {m.complete}/{m.relevant}</span>
      </div>
      <p style={{ color: C.sub, marginTop: 0, fontSize: 13 }}>Set status under your name & phase. Use <b>Review by</b> to require a separate reviewer sign-off.</p>
      <CheckList catId={cat.id} checks={checks} state={state} statusOf={statusOf} {...rp} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable check list (panel of rows + add control)                  */
/* ------------------------------------------------------------------ */
function CheckList({ catId, checks, state, user, statusOf, stampOf, curIdx, phaseIdx, validReview, setStatus, setReview, setAnswer, setPartial, setField, addCheck, removeCheck, phaseDates, perLevelLevels }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const groups = [];
  const idx = {};
  checks.forEach((c) => {
    const key = c.sub || "";
    if (!(key in idx)) { idx[key] = groups.length; groups.push({ key, items: [] }); }
    groups[idx[key]].items.push(c);
  });
  const lastId = checks.length ? checks[checks.length - 1].id : null;
  return (
    <>
      <div style={{ ...panelStyle(), padding: 0, overflow: "hidden" }}>
        {groups.map((g) => (
          <div key={g.key || "_"}>
            {g.key && (
              <div style={{ background: "#f1f4f7", borderBottom: `1px solid ${C.line}`, padding: "7px 14px", fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: C.brand, fontFamily: C.mono }}>{g.key}</div>
            )}
            {g.items.map((c) => (
              <CheckRow key={c.id} c={c} last={c.id === lastId} user={user} statusOf={statusOf} stampOf={stampOf}
                phases={state.phases} curIdx={curIdx} phaseIdx={phaseIdx} validReview={validReview} phaseDates={phaseDates} perLevelLevels={perLevelLevels}
                setStatus={setStatus} setReview={setReview} setAnswer={setAnswer} setPartial={setPartial} setField={setField} removeCheck={removeCheck} />
            ))}
          </div>
        ))}
        {checks.length === 0 && <div style={{ padding: 18, color: C.sub, fontSize: 13.5 }}>No checks here yet — add the first one below.</div>}
      </div>
      <div style={{ marginTop: 12, marginBottom: 8 }}>
        {!adding ? (
          <button onClick={() => setAdding(true)} style={pillStyle()}><Plus size={14} /> Add a check</button>
        ) : (
          <div style={{ ...panelStyle(), display: "flex", gap: 8 }}>
            <input autoFocus value={text} placeholder="New check question…" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { addCheck(catId, text); setText(""); setAdding(false); } if (e.key === "Escape") setAdding(false); }} style={inputStyle()} />
            <button onClick={() => { addCheck(catId, text); setText(""); setAdding(false); }} style={{ ...pillStyle(), background: C.brand, color: "#fff", borderColor: C.brand }}>Add</button>
            <button onClick={() => { setAdding(false); setText(""); }} style={miniBtn()}><X size={14} /></button>
          </div>
        )}
      </div>
    </>
  );
}

const STATES3 = [
  { key: "complete", label: "Done", icon: CheckCircle2, color: C.complete },
  { key: "na",       label: "N/A",  icon: MinusCircle,  color: C.na },
  { key: "open",     label: "Open", icon: Circle,       color: C.open },
];
const fmtStamp = (s) => `${new Date(s.at).toLocaleDateString()} ${new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

/* compact Done/N/A/Open control with optional Partial */
function StatusControl({ value, pct, bulk, onSet, onPartial }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <div style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden" }}>
        {STATES3.map((s, i) => {
          const active = value === s.key;
          const filled = active && s.key !== "open";
          return (
            <button key={s.key} className="qa-stbtn" title={s.label} onClick={() => onSet(s.key)}
              style={{ display: "flex", alignItems: "center", gap: 4, background: filled ? s.color : active ? "#eef1f4" : "#fff", color: filled ? "#fff" : s.color, border: "none", borderLeft: i ? `1px solid ${C.line}` : "none", padding: "6px 9px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
              <s.icon size={15} /> {s.label}
            </button>
          );
        })}
        {bulk && (
          <button className="qa-stbtn" title="Partially done" onClick={() => onPartial(value === "partial" ? pct : 50)}
            style={{ display: "flex", alignItems: "center", gap: 4, background: value === "partial" ? C.partial : "#fff", color: value === "partial" ? "#fff" : C.partial, border: "none", borderLeft: `1px solid ${C.line}`, padding: "6px 9px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
            ◐ Partial
          </button>
        )}
      </div>
      {bulk && value === "partial" && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <input type="number" min={0} max={100} value={pct ?? 0} onChange={(e) => onPartial(e.target.value)}
            style={{ width: 52, border: `1px solid ${C.partial}`, borderRadius: 6, padding: "4px 6px", fontSize: 12, fontFamily: C.mono, color: C.partial, fontWeight: 700 }} />
          <span style={{ fontSize: 12, color: C.partial, fontWeight: 700 }}>%</span>
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Single check row                                                   */
/* ------------------------------------------------------------------ */
function CheckRow({ c, last, user, statusOf, stampOf, phases, curIdx, phaseIdx, validReview, phaseDates, perLevelLevels, setStatus, setReview, setAnswer, setPartial, setField, removeCheck }) {
  const reviewAt = validReview(c);
  const bulk = !c.perLevel && c.type !== "choice" && (c.cat === "baseplates" || (c.cat === "foundations" && (c.sub === "Footings" || c.sub === "Piers / deep foundations")));
  const due = computeDue(phaseDates, c.phase, c.daysBefore);
  const dueB = dueBadge(due);

  const base = stampOf(c.id);
  const status = statusOf(c.id);

  // per-level completion
  const levelUnits = c.perLevel ? perLevelLevels.map((l) => ({ level: l, id: `${c.id}::${l}`, st: stampOf(`${c.id}::${l}`), s: statusOf(`${c.id}::${l}`) })) : null;
  const allLevelsDone = levelUnits ? levelUnits.every((u) => u.s === "complete" || u.s === "na") && levelUnits.some((u) => u.s === "complete") : status === "complete";
  const needsReview = reviewAt && phaseIdx(reviewAt) <= curIdx && allLevelsDone && !(base && base.review);
  const completers = c.perLevel ? levelUnits.filter((u) => u.s === "complete").map((u) => u.st?.by).filter(Boolean) : (base?.by && status === "complete" ? [base.by] : []);
  const selfOnly = completers.length > 0 && completers.every((b) => b === user);

  const DueBadge = () => dueB ? (
    <span style={badge(dueB === "pastdue" ? C.outdated : C.overdue)}>
      <Clock size={11} /> {dueB === "pastdue" ? "PAST DUE" : "DUE TODAY"}
    </span>
  ) : null;

  return (
    <div className="qa-row" style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderBottom: last ? "none" : `1px solid ${C.line}`, flexWrap: "wrap" }}>
      {/* control (single-row checks only) */}
      {!c.perLevel && (c.type === "choice" ? (
        <div style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 8, overflow: "hidden" }}>
          {c.options.map((opt, i) => {
            const active = base && base.answer === opt;
            return (
              <button key={opt} className="qa-stbtn" onClick={() => setAnswer(c.id, opt)}
                style={{ background: active ? C.brand : "#fff", color: active ? "#fff" : C.brand, border: "none", borderLeft: i ? `1px solid ${C.line}` : "none", padding: "6px 11px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                {opt}
              </button>
            );
          })}
        </div>
      ) : (
        <StatusControl value={status} pct={base?.pct} bulk={bulk} onSet={(k) => setStatus(c.id, k)} onPartial={(p) => setPartial(c.id, p)} />
      ))}

      {/* text + stamps */}
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 14, lineHeight: 1.45, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ textDecoration: status === "na" ? "line-through" : "none", color: status === "na" ? C.sub : C.ink }}>{c.text}</span>
          {c.help && <InfoHint text={c.help} sketch={c.sketch} />}
          {c.custom && <span style={{ fontFamily: C.mono, fontSize: 10, color: C.sub, border: `1px solid ${C.line}`, borderRadius: 5, padding: "0 5px" }}>custom</span>}
          {!c.perLevel && status !== "complete" && status !== "na" && <DueBadge />}
          {needsReview && <span style={badge(C.review)}><Eye size={11} /> needs review</span>}
        </div>

        {/* per-level sub-rows */}
        {c.perLevel && (
          <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 5 }}>
            {levelUnits.map((u) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: C.mono, fontSize: 12, fontWeight: 600, width: 88, color: C.sub }}>{u.level}</span>
                <StatusControl value={u.s} bulk={false} onSet={(k) => setStatus(u.id, k)} onPartial={() => {}} />
                <span style={{ fontSize: 11.5, color: u.s === "na" ? C.na : C.complete }}>
                  {u.st ? `${u.s === "na" ? "N/A" : "✓"} ${u.st.by} · ${fmtStamp(u.st)}` : ""}
                </span>
                {u.s !== "complete" && u.s !== "na" && <DueBadge />}
              </div>
            ))}
          </div>
        )}

        {/* single-row stamp line */}
        {!c.perLevel && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 5, fontSize: 12, color: C.sub, flexWrap: "wrap" }}>
            {base ? (
              <span style={{ color: status === "na" ? C.na : status === "partial" ? C.partial : C.complete, fontWeight: 500 }}>
                {c.type === "choice" ? `Answer: ${base.answer}` : status === "na" ? "N/A" : status === "partial" ? `Partial ${base.pct || 0}%` : "✓ Done"} · {base.by} <span style={{ opacity: .7 }}>({base.role})</span> · <span style={{ fontFamily: C.mono }}>{base.phase}</span> · {fmtStamp(base)}
              </span>
            ) : <span>{c.type === "choice" ? "Not answered" : "Not yet checked"}</span>}
            {base && base.review && (
              <span style={{ color: C.review, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <ShieldCheck size={13} /> Reviewed · {base.review.by} <span style={{ opacity: .7 }}>({base.review.role})</span>
              </span>
            )}
          </div>
        )}
        {c.perLevel && base && base.review && (
          <div style={{ marginTop: 5, fontSize: 12, color: C.review, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ShieldCheck size={13} /> Reviewed · {base.review.by} ({base.review.role})
          </div>
        )}
      </div>

      {/* phase / days / review controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10.5, color: C.sub, fontFamily: C.mono }}>Done by</span>
          <select value={phases.includes(c.phase) ? c.phase : ""} onChange={(e) => setField(c.id, "phase", e.target.value)}
            style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: "3px 6px", fontFamily: C.mono, fontSize: 12, color: C.brand, fontWeight: 600 }}>
            <option value="">— unassigned</option>
            {phases.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10.5, color: C.sub, fontFamily: C.mono }}>days before</span>
          <input type="number" min={1} value={c.daysBefore ?? ""} placeholder="—"
            onChange={(e) => setField(c.id, "daysBefore", e.target.value ? Math.max(1, parseInt(e.target.value, 10) || 1) : "")}
            style={{ width: 52, border: `1px solid ${C.line}`, borderRadius: 7, padding: "3px 6px", fontFamily: C.mono, fontSize: 12, color: C.ink }} />
        </div>
        {due && <span style={{ fontSize: 10.5, color: dueB === "pastdue" ? C.outdated : dueB === "duetoday" ? C.overdue : C.sub, fontFamily: C.mono }}>due {fmtDate(due)}</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10.5, color: C.sub, fontFamily: C.mono }}>Review by</span>
          <select value={c.reviewAt || ""} onChange={(e) => setField(c.id, "reviewAt", e.target.value)}
            style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: "3px 6px", fontFamily: C.mono, fontSize: 12, color: c.reviewAt ? C.review : C.sub, fontWeight: 600 }}>
            <option value="">—</option>
            {phases.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {reviewAt && (
          allLevelsDone ? (
            (base && base.review) ? (
              <button className="qa-stbtn" onClick={() => setReview(c.id)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${C.review}`, background: C.review, color: "#fff", borderRadius: 7, padding: "4px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                <ShieldCheck size={13} /> Reviewed
              </button>
            ) : selfOnly ? (
              <span title="A reviewer must be different from who completed the item" style={{ fontSize: 11, color: C.sub, fontStyle: "italic", textAlign: "right", maxWidth: 130 }}>can't review own work</span>
            ) : (
              <button className="qa-stbtn" onClick={() => setReview(c.id)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${C.line}`, background: "#fff", color: C.review, borderRadius: 7, padding: "4px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                <ShieldCheck size={13} /> Mark reviewed
              </button>
            )
          ) : <span style={{ fontSize: 11, color: C.sub, fontStyle: "italic" }}>review at {reviewAt}</span>
        )}
        {c.custom && <button onClick={() => removeCheck(c.id)} title="Delete check" style={{ ...miniBtn(), color: C.outdated, border: "none", padding: 2 }}><Trash2 size={14} /></button>}
      </div>
    </div>
  );
}
