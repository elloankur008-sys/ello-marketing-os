// Ellocent Marketing OS — Full-Stack Governance & Real-Time Operations Engine (v2.0.0)
(function () {
  "use strict";

  const STORAGE_KEY = "ellocent_marketing_os_state_v2";
  let state = null;
  let activeView = "overview";
  let selectedContentId = null;
  let seoStrategy = "MOBILE";
  let serverConfig = {
    supabaseConfigured: false,
    supabaseUrl: "",
    supabaseAnonKey: "",
    composioConfigured: false,
    geminiServerConfigured: false,
    pagespeedServerConfigured: false
  };
  let supabaseClient = null;
  let currentUser = null;
  let realtimeChannel = null;

  function deepClone(obj) {
    if (obj === undefined || obj === null) return {};
    return JSON.parse(JSON.stringify(obj));
  }

  function nowTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function computeSha256(text) {
    try {
      if (window.crypto && window.crypto.subtle) {
        const enc = new TextEncoder().encode(text);
        const buf = await window.crypto.subtle.digest("SHA-256", enc);
        return Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
    } catch (_) {}
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ("00000000" + (h >>> 0).toString(16)).slice(-8).repeat(4);
  }

  function mergeWithSeed(saved) {
    const base = deepClone(window.ELLOCENT_SEED_DATA || {});
    if (!saved || typeof saved !== "object") return base;
    const merged = Object.assign({}, base, saved);
    merged.roles = Object.assign({}, base.roles, saved.roles || {});
    merged.apiKeys = Object.assign({ gemini: "", pagespeed: "" }, saved.apiKeys || {});
    if (!Array.isArray(merged.workspaces) || merged.workspaces.length === 0) {
      merged.workspaces = base.workspaces;
    }
    if (!merged.workspaces.some((w) => w.id === merged.currentWorkspaceId)) {
      merged.currentWorkspaceId = merged.workspaces[0].id;
    }
    if (!merged.roles[merged.currentRole]) {
      merged.currentRole = "Platform Admin";
    }
    merged.brandProfiles = Object.assign({}, base.brandProfiles, saved.brandProfiles || {});
    merged.campaigns = Array.isArray(saved.campaigns) ? saved.campaigns : [];
    merged.contentAssets = Array.isArray(saved.contentAssets) ? saved.contentAssets : [];
    merged.seoAudits = Array.isArray(saved.seoAudits) ? saved.seoAudits : [];
    merged.paidMedia = {
      campaigns: saved.paidMedia && Array.isArray(saved.paidMedia.campaigns) ? saved.paidMedia.campaigns : [],
      budgetDiffs: saved.paidMedia && Array.isArray(saved.paidMedia.budgetDiffs) ? saved.paidMedia.budgetDiffs : []
    };
    merged.leads = Array.isArray(saved.leads) ? saved.leads : [];
    merged.automations = Array.isArray(saved.automations) ? saved.automations : [];
    merged.automationRuns = Array.isArray(saved.automationRuns) ? saved.automationRuns : [];
    merged.competitors = Array.isArray(saved.competitors) ? saved.competitors : [];
    merged.composioConnections = Array.isArray(saved.composioConnections) ? saved.composioConnections : [];
    merged.integrations = base.integrations;
    merged.auditEvents = Array.isArray(saved.auditEvents) ? saved.auditEvents : base.auditEvents;
    return merged;
  }

  function initLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state = raw ? mergeWithSeed(JSON.parse(raw)) : mergeWithSeed(null);
    } catch (err) {
      state = mergeWithSeed(null);
    }
    saveLocalState();
  }

  function saveLocalState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error("Failed to save local state:", err);
    }
  }

  // Phase 2: Load public runtime config & initialize Supabase Cloud + Realtime if configured
  async function initCloudBridge() {
    try {
      const resp = await fetch("/api/config", { cache: "no-store" });
      if (resp.ok) {
        serverConfig = await resp.json();
      }
    } catch (_) {
      // Static local preview without Netlify Functions running
    }

    if (serverConfig.supabaseConfigured && serverConfig.supabaseUrl && serverConfig.supabaseAnonKey) {
      try {
        const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
        supabaseClient = mod.createClient(serverConfig.supabaseUrl, serverConfig.supabaseAnonKey);
        const { data } = await supabaseClient.auth.getSession();
        currentUser = data?.session?.user || null;

        supabaseClient.auth.onAuthStateChange(async (_event, session) => {
          currentUser = session?.user || null;
          if (currentUser) {
            await syncFromSupabase();
            subscribeSupabaseRealtime();
          }
          renderApp();
        });

        if (currentUser) {
          await syncFromSupabase();
          subscribeSupabaseRealtime();
        }
      } catch (err) {
        console.warn("Supabase client initialization skipped:", err.message);
      }
    }
  }

  async function syncFromSupabase() {
    if (!supabaseClient || !currentUser) return;
    try {
      const { data: wsRows } = await supabaseClient.from("workspaces").select("*");
      if (Array.isArray(wsRows) && wsRows.length > 0) {
        state.workspaces = wsRows.map((w) => ({
          id: w.id,
          name: w.name,
          domain: w.domain,
          currency: w.currency || "USD",
          timezone: w.timezone || "Asia/Kolkata",
          retainerStatus: w.retainer_status || "Active",
          monthlyRetainer: Number(w.monthly_retainer || 0),
          aiSpentUsd: Number(w.ai_spent_usd || 0),
          aiBudgetUsd: Number(w.ai_budget_usd || 100)
        }));
        if (!state.workspaces.some((w) => w.id === state.currentWorkspaceId)) {
          state.currentWorkspaceId = state.workspaces[0].id;
        }
      }

      const { data: memberRows } = await supabaseClient
        .from("workspace_memberships")
        .select("*")
        .eq("workspace_id", state.currentWorkspaceId)
        .eq("user_id", currentUser.id);
      if (memberRows && memberRows[0] && state.roles[memberRows[0].role]) {
        state.currentRole = memberRows[0].role;
      }

      const wsId = state.currentWorkspaceId;
      const [cmpRes, cntRes, seoRes, paidRes, diffRes, leadRes, evtRes] = await Promise.all([
        supabaseClient.from("campaigns").select("*").eq("workspace_id", wsId),
        supabaseClient.from("content_assets").select("*").eq("workspace_id", wsId),
        supabaseClient.from("seo_audits").select("*").eq("workspace_id", wsId).order("audited_at", { ascending: false }),
        supabaseClient.from("paid_campaigns").select("*").eq("workspace_id", wsId),
        supabaseClient.from("budget_diffs").select("*").eq("workspace_id", wsId),
        supabaseClient.from("leads").select("*").eq("workspace_id", wsId).order("created_at", { ascending: false }),
        supabaseClient.from("audit_events").select("*").eq("workspace_id", wsId).order("timestamp", { ascending: false }).limit(50)
      ]);

      if (cmpRes.data) {
        state.campaigns = cmpRes.data.map((c) => ({
          id: c.id,
          workspaceId: c.workspace_id,
          name: c.name,
          objective: c.objective,
          channel: c.channel,
          status: c.status,
          budgetCap: Number(c.budget_cap || 0),
          spent: Number(c.spent || 0),
          owner: c.owner,
          startDate: c.start_date,
          endDate: c.end_date,
          checklist: Array.isArray(c.checklist) ? c.checklist : []
        }));
      }
      if (cntRes.data) {
        state.contentAssets = cntRes.data.map((a) => ({
          id: a.id,
          workspaceId: a.workspace_id,
          title: a.title,
          channel: a.channel,
          status: a.status,
          version: Number(a.version || 1),
          scheduledDate: a.scheduled_date || "",
          destinationUrl: a.destination_url || "",
          body: a.body || "",
          approvedHash: a.approved_hash || ""
        }));
      }
      if (seoRes.data) {
        state.seoAudits = seoRes.data.map((s) => ({
          id: s.id,
          workspaceId: s.workspace_id,
          domain: s.domain,
          strategy: s.strategy || "MOBILE",
          auditedAt: s.audited_at,
          pagesCrawled: Number(s.pages_crawled || 1),
          perfScore: Number(s.perf_score || 0),
          seoScore: Number(s.seo_score || 0),
          accessScore: Number(s.access_score || 0),
          lcp: s.lcp || "",
          cls: s.cls || "",
          findings: Array.isArray(s.findings) ? s.findings : []
        }));
      }
      if (paidRes.data) {
        state.paidMedia.campaigns = paidRes.data.map((p) => ({
          id: p.id,
          workspaceId: p.workspace_id,
          platform: p.platform,
          name: p.name,
          status: p.status,
          dailyBudget: Number(p.daily_budget || 0),
          spend: Number(p.spend || 0),
          conversions: Number(p.conversions || 0)
        }));
      }
      if (diffRes.data) {
        state.paidMedia.budgetDiffs = diffRes.data.map((d) => ({
          id: d.id,
          workspaceId: d.workspace_id,
          campaignId: d.campaign_id,
          campaignName: d.campaign_name,
          currentValue: Number(d.current_value || 0),
          proposedValue: Number(d.proposed_value || 0),
          rationale: d.rationale,
          rollbackPlan: d.rollback_plan,
          proposedBy: d.proposed_by,
          status: d.status
        }));
      }
      if (leadRes.data) {
        state.leads = leadRes.data.map((l) => ({
          id: l.id,
          workspaceId: l.workspace_id,
          name: l.name,
          company: l.company,
          email: l.email,
          stage: l.stage,
          emailOptIn: Boolean(l.email_opt_in),
          whatsappOptIn: Boolean(l.whatsapp_opt_in),
          suppressed: Boolean(l.suppressed),
          consentSource: l.consent_source
        }));
      }
      if (evtRes.data) {
        state.auditEvents = evtRes.data.map((e) => ({
          id: e.id,
          workspaceId: e.workspace_id,
          timestamp: String(e.timestamp || "").replace("T", " ").slice(0, 19),
          actor: e.actor,
          action: e.action,
          target: e.target,
          correlationId: e.correlation_id
        }));
      }
      saveLocalState();
    } catch (err) {
      console.warn("Supabase sync notice:", err.message);
    }
  }

  function subscribeSupabaseRealtime() {
    if (!supabaseClient || !currentUser) return;
    if (realtimeChannel) {
      supabaseClient.removeChannel(realtimeChannel);
    }
    realtimeChannel = supabaseClient
      .channel("ellocent-realtime-ops")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, async () => {
        await syncFromSupabase();
        renderApp();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_events" }, async () => {
        await syncFromSupabase();
        renderApp();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "content_assets" }, async () => {
        await syncFromSupabase();
        renderApp();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "budget_diffs" }, async () => {
        await syncFromSupabase();
        renderApp();
      })
      .subscribe();
  }

  async function cloudUpsert(table, row) {
    if (!supabaseClient || !currentUser) return;
    try {
      await supabaseClient.from(table).upsert(row);
    } catch (err) {
      console.warn(`Cloud upsert failed on ${table}:`, err.message);
    }
  }

  function currentWorkspace() {
    return state.workspaces.find((w) => w.id === state.currentWorkspaceId) || state.workspaces[0];
  }

  function currentRoleObj() {
    return state.roles[state.currentRole] || state.roles["Platform Admin"];
  }

  function currentBrand() {
    const ws = currentWorkspace();
    if (!state.brandProfiles[ws.id]) {
      state.brandProfiles[ws.id] = {
        workspaceId: ws.id,
        version: "v1.0",
        brandName: ws.name,
        tagline: "",
        voiceTone: "Clear, factual, compliant",
        targetAudience: "",
        bannedClaims: [],
        requiredDisclaimers: { email: "", whatsapp: "", paid: "" }
      };
    }
    return state.brandProfiles[ws.id];
  }

  function logAudit(action, target) {
    const evt = {
      id: uid("evt"),
      workspaceId: state.currentWorkspaceId,
      timestamp: nowTimestamp(),
      actor: currentUser ? `${state.currentRole} (${currentUser.email})` : state.currentRole,
      action,
      target,
      correlationId: `corr-${Date.now().toString(36)}`
    };
    state.auditEvents.unshift(evt);
    if (state.auditEvents.length > 250) {
      state.auditEvents.length = 250;
    }
    if (supabaseClient && currentUser) {
      supabaseClient.from("audit_events").insert({
        id: evt.id,
        workspace_id: evt.workspaceId,
        actor: evt.actor,
        action: evt.action,
        target: evt.target,
        correlation_id: evt.correlationId
      }).then(() => {});
    }
  }

  function injectHelperStyles() {
    if (document.getElementById("ello-real-helper-styles")) return;
    const style = document.createElement("style");
    style.id = "ello-real-helper-styles";
    style.textContent = `
      .ello-grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 18px; }
      .ello-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 18px; }
      .ello-kpi-val { font-size: 25px; font-weight: 700; margin: 6px 0 4px; color: #0f172a; }
      .ello-kpi-lbl { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #64748b; }
      .ello-kpi-sub { font-size: 12px; color: #64748b; }
      .ello-row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .ello-row-gap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ello-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .ello-table th { text-align: left; padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
      .ello-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; color: #1e293b; }
      .ello-pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
      .ello-pill-green { background: #dcfce7; color: #166534; }
      .ello-pill-amber { background: #fef3c7; color: #92400e; }
      .ello-pill-red { background: #fee2e2; color: #991b1b; }
      .ello-pill-blue { background: #dbeafe; color: #1e40af; }
      .ello-pill-slate { background: #f1f5f9; color: #334155; }
      .ello-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
      .ello-field label { font-size: 12px; font-weight: 600; color: #334155; }
      .ello-input, .ello-select, .ello-textarea {
        width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #cbd5e1;
        border-radius: 6px; font-size: 13px; font-family: inherit; background: #fff; color: #0f172a;
      }
      .ello-textarea { min-height: 104px; resize: vertical; }
      .ello-empty { text-align: center; padding: 26px 18px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; color: #475569; }
      .ello-modal-backdrop {
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.58); z-index: 9999;
        display: flex; align-items: center; justify-content: center; padding: 16px;
      }
      .ello-modal {
        background: #fff; border-radius: 10px; max-width: 540px; width: 100%; max-height: 90vh;
        overflow-y: auto; padding: 20px 22px; box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25);
      }
      .ello-banner-role {
        background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px;
        margin-bottom: 16px; font-size: 12.5px; color: #334155; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
      }
      button:disabled, .btn:disabled { opacity: 0.45 !important; cursor: not-allowed !important; pointer-events: none; }
    `;
    document.head.appendChild(style);
  }

  function renderTopControls() {
    const wsSelect = document.getElementById("workspaceSelect");
    if (wsSelect) {
      wsSelect.innerHTML = state.workspaces
        .map((w) => `<option value="${escapeHtml(w.id)}" ${w.id === state.currentWorkspaceId ? "selected" : ""}>${escapeHtml(w.name)}</option>`)
        .join("");

      const role = currentRoleObj();
      let addProjBtn = document.getElementById("addProjectTopBtn");
      if (!addProjBtn && wsSelect.parentElement) {
        addProjBtn = document.createElement("button");
        addProjBtn.id = "addProjectTopBtn";
        addProjBtn.type = "button";
        addProjBtn.className = "btn btn-primary";
        addProjBtn.style.cssText = "padding: 5px 10px; font-size: 12px; margin-left: 6px; white-space: nowrap;";
        addProjBtn.textContent = "+ Add Project";
        addProjBtn.addEventListener("click", openAddProjectModal);
        wsSelect.parentElement.appendChild(addProjBtn);
      }
      if (addProjBtn) {
        addProjBtn.style.display = role.canManageProjects ? "inline-flex" : "none";
      }
    }

    const roleSelect = document.getElementById("roleSelect");
    const roleGroup = document.getElementById("roleControlGroup");
    if (roleSelect) {
      roleSelect.innerHTML = Object.keys(state.roles)
        .map((rKey) => `<option value="${escapeHtml(rKey)}" ${rKey === state.currentRole ? "selected" : ""}>${escapeHtml(rKey)}</option>`)
        .join("");
      // When authenticated via Supabase Cloud, lock role to server-assigned membership role
      roleSelect.disabled = Boolean(supabaseClient && currentUser);
      if (roleGroup) {
        roleGroup.title = supabaseClient && currentUser
          ? "Role locked by verified Supabase membership"
          : "Switch role to test RBAC view & action gating";
      }
    }

    const ws = currentWorkspace();
    const aiPill = document.getElementById("aiTelemetryPill");
    if (aiPill && ws) {
      const pct = ws.aiBudgetUsd > 0 ? ((ws.aiSpentUsd / ws.aiBudgetUsd) * 100).toFixed(1) : "0.0";
      aiPill.textContent = `AI Cap: $${Number(ws.aiSpentUsd || 0).toFixed(2)} / $${Number(ws.aiBudgetUsd || 0).toFixed(2)} (${pct}%)`;
    }

    const authSlot = document.getElementById("authSessionSlot");
    if (authSlot) {
      if (supabaseClient && currentUser) {
        authSlot.innerHTML = `<span class="ello-pill ello-pill-green">${escapeHtml(currentUser.email)}</span> <button type="button" class="btn btn-secondary" id="cloudSignOutBtn" style="padding:5px 9px; font-size:12px;">Sign Out</button>`;
        const outBtn = document.getElementById("cloudSignOutBtn");
        if (outBtn) {
          outBtn.onclick = async () => {
            await supabaseClient.auth.signOut();
            currentUser = null;
            renderApp();
          };
        }
      } else if (serverConfig.supabaseConfigured) {
        authSlot.innerHTML = `<button type="button" class="btn btn-primary" id="cloudSignInBtn" style="padding:5px 10px; font-size:12px;">Cloud Sign In</button>`;
        const inBtn = document.getElementById("cloudSignInBtn");
        if (inBtn) inBtn.onclick = openAuthModal;
      } else {
        authSlot.innerHTML = `<span class="ello-pill ello-pill-slate">Local Sandbox</span>`;
      }
    }

    const dot = document.getElementById("cloudStatusDot");
    const statusTxt = document.getElementById("cloudStatusText");
    if (dot && statusTxt) {
      if (supabaseClient && currentUser) {
        dot.className = "status-dot status-cloud";
        statusTxt.textContent = "Supabase Cloud + Realtime Live";
      } else if (serverConfig.supabaseConfigured) {
        dot.className = "status-dot status-local";
        statusTxt.textContent = "Cloud Configured (Sign In to Sync)";
      } else {
        dot.className = "status-dot status-local";
        statusTxt.textContent = "Local Persistence (Add Env Vars for Cloud)";
      }
    }

    const resetBtn = document.getElementById("resetDemoBtn");
    if (resetBtn) {
      resetBtn.style.display = currentRoleObj().canManageAdmin ? "inline-flex" : "none";
    }
  }

  function applyRoleNavigationVisibility() {
    const role = currentRoleObj();
    const allowed = new Set(role.allowedViews || ["overview"]);
    document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
      const v = btn.getAttribute("data-view");
      const isAllowed = allowed.has(v);
      btn.style.display = isAllowed ? "" : "none";
      btn.classList.toggle("active", v === activeView);
    });

    const wsId = state.currentWorkspaceId;
    const pendingContent = state.contentAssets.filter((c) => c.workspaceId === wsId && c.status === "Pending Approval").length;
    const pendingDiffs = state.paidMedia.budgetDiffs.filter((d) => d.workspaceId === wsId && d.status === "Pending Approval").length;
    const totalPending = pendingContent + pendingDiffs;
    const badge = document.getElementById("navApprovalCount");
    if (badge) {
      badge.textContent = String(totalPending);
      badge.style.display = totalPending > 0 ? "inline-flex" : "none";
    }

    if (!allowed.has(activeView)) {
      activeView = "overview";
    }
  }

  function openAuthModal() {
    if (!supabaseClient) return;
    closeModal();
    const wrap = document.createElement("div");
    wrap.id = "elloModalRoot";
    wrap.className = "ello-modal-backdrop";
    wrap.innerHTML = `
      <div class="ello-modal">
        <div class="ello-row-between" style="margin-bottom:12px;">
          <h3 style="margin:0; font-size:17px;">Ellocent Cloud Sign In (Supabase Auth)</h3>
          <button type="button" class="btn btn-secondary" id="closeModalBtn" style="padding:4px 10px;">✕</button>
        </div>
        <p style="margin:0 0 14px; font-size:13px; color:#475569;">Sign in to sync multi-user workspaces, Row-Level Security permissions, and real-time Composio triggers.</p>
        <form id="cloudAuthForm">
          <div class="ello-field">
            <label>Work Email *</label>
            <input class="ello-input" type="email" name="email" required placeholder="you@ellocentlabs.com" />
          </div>
          <div class="ello-field">
            <label>Password *</label>
            <input class="ello-input" type="password" name="password" required minlength="6" placeholder="Minimum 6 characters" />
          </div>
          <div id="authStatusMsg" style="font-size:12.5px; color:#b91c1c; margin-bottom:10px;"></div>
          <div class="ello-row-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cloudSignUpBtn">Create Account</button>
            <button type="submit" class="btn btn-primary">Sign In</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(wrap);
    document.getElementById("closeModalBtn").onclick = closeModal;

    const form = document.getElementById("cloudAuthForm");
    const msg = document.getElementById("authStatusMsg");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      msg.style.color = "#2563eb";
      msg.textContent = "Authenticating...";
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: String(fd.get("email") || "").trim(),
        password: String(fd.get("password") || "")
      });
      if (error) {
        msg.style.color = "#b91c1c";
        msg.textContent = error.message;
      } else {
        closeModal();
      }
    });

    document.getElementById("cloudSignUpBtn").addEventListener("click", async () => {
      const fd = new FormData(form);
      const email = String(fd.get("email") || "").trim();
      const password = String(fd.get("password") || "");
      if (!email || password.length < 6) {
        msg.textContent = "Enter a valid email and 6+ character password first.";
        return;
      }
      msg.style.color = "#2563eb";
      msg.textContent = "Creating account...";
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) {
        msg.style.color = "#b91c1c";
        msg.textContent = error.message;
      } else if (data?.user) {
        await supabaseClient.from("workspace_memberships").insert({
          workspace_id: "ws_ellocent",
          user_id: data.user.id,
          role: "Platform Admin"
        });
        msg.style.color = "#166534";
        msg.textContent = "Account created! Check email if confirmation is enabled, or sign in now.";
      }
    });
  }

  function openAddProjectModal() {
    if (!currentRoleObj().canManageProjects) return;
    closeModal();
    const wrap = document.createElement("div");
    wrap.id = "elloModalRoot";
    wrap.className = "ello-modal-backdrop";
    wrap.innerHTML = `
      <div class="ello-modal">
        <div class="ello-row-between" style="margin-bottom:14px;">
          <h3 style="margin:0; font-size:17px;">Add New Project / Client Workspace</h3>
          <button type="button" class="btn btn-secondary" id="closeModalBtn" style="padding:4px 10px;">✕</button>
        </div>
        <p style="margin:0 0 14px; font-size:13px; color:#475569;">Creates an isolated workspace with its own brand rules, campaigns, SEO audits, leads, Composio connections, and AI cap.</p>
        <form id="newProjectForm">
          <div class="ello-field">
            <label>Project / Client Name *</label>
            <input class="ello-input" name="name" required placeholder="e.g., Axholme Pest Control" />
          </div>
          <div class="ello-field">
            <label>Primary Website Domain *</label>
            <input class="ello-input" name="domain" required placeholder="e.g., axholmepestcontrol.co.uk" />
          </div>
          <div class="ello-grid-2" style="margin-bottom:0;">
            <div class="ello-field">
              <label>Currency</label>
              <select class="ello-select" name="currency">
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹)</option>
                <option value="GBP">GBP (£)</option>
                <option value="AUD">AUD (A$)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
            <div class="ello-field">
              <label>Timezone</label>
              <select class="ello-select" name="timezone">
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>
          <div class="ello-grid-2" style="margin-bottom:0;">
            <div class="ello-field">
              <label>Workspace Status</label>
              <input class="ello-input" name="retainerStatus" value="Active — Client Project" />
            </div>
            <div class="ello-field">
              <label>Monthly AI Budget Cap ($)</label>
              <input class="ello-input" type="number" min="0" step="1" name="aiBudgetUsd" value="100" />
            </div>
          </div>
          <div class="ello-field">
            <label>Brand Positioning / Tagline</label>
            <input class="ello-input" name="tagline" placeholder="Short description of services & ICP" />
          </div>
          <div class="ello-field">
            <label>Banned Claims (comma-separated)</label>
            <input class="ello-input" name="bannedClaims" placeholder="e.g., 100% guaranteed, instant results" />
          </div>
          <div class="ello-row-gap" style="justify-content:flex-end; margin-top:16px;">
            <button type="button" class="btn btn-secondary" id="cancelModalBtn">Cancel</button>
            <button type="submit" class="btn btn-primary">Create Project Workspace</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(wrap);
    document.getElementById("closeModalBtn").onclick = closeModal;
    document.getElementById("cancelModalBtn").onclick = closeModal;
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) closeModal();
    });
    document.getElementById("newProjectForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get("name") || "").trim();
      const domain = String(fd.get("domain") || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
      if (!name || !domain) return;
      const newId = uid("ws");
      const banned = String(fd.get("bannedClaims") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const newWs = {
        id: newId,
        name,
        domain,
        currency: String(fd.get("currency") || "USD"),
        timezone: String(fd.get("timezone") || "Asia/Kolkata"),
        retainerStatus: String(fd.get("retainerStatus") || "Active — Client Project"),
        monthlyRetainer: 0,
        aiSpentUsd: 0,
        aiBudgetUsd: Math.max(0, Number(fd.get("aiBudgetUsd") || 100))
      };
      state.workspaces.push(newWs);
      state.brandProfiles[newId] = {
        workspaceId: newId,
        version: "v1.0",
        brandName: name,
        tagline: String(fd.get("tagline") || "").trim(),
        voiceTone: "Clear, factual, brand-compliant",
        targetAudience: "",
        bannedClaims: banned,
        requiredDisclaimers: { email: "", whatsapp: "", paid: "" }
      };
      state.currentWorkspaceId = newId;

      if (supabaseClient && currentUser) {
        await supabaseClient.from("workspaces").insert({
          id: newWs.id,
          name: newWs.name,
          domain: newWs.domain,
          currency: newWs.currency,
          timezone: newWs.timezone,
          retainer_status: newWs.retainerStatus,
          ai_budget_usd: newWs.aiBudgetUsd
        });
        await supabaseClient.from("workspace_memberships").insert({
          workspace_id: newWs.id,
          user_id: currentUser.id,
          role: state.currentRole
        });
      }

      logAudit("PROJECT_WORKSPACE_CREATED", `${name} (${domain})`);
      saveLocalState();
      closeModal();
      renderApp();
    });
  }

  function closeModal() {
    const existing = document.getElementById("elloModalRoot");
    if (existing) existing.remove();
  }

  function roleBannerHtml() {
    const role = currentRoleObj();
    const ws = currentWorkspace();
    return `
      <div class="ello-banner-role">
        <div>
          <strong>Active Project:</strong> ${escapeHtml(ws.name)} (${escapeHtml(ws.domain)}) &nbsp;•&nbsp;
          <strong>Role:</strong> ${escapeHtml(role.label)} (${escapeHtml(role.tier)}) — <span style="color:#64748b;">${escapeHtml(role.description)}</span>
        </div>
        <div class="ello-row-gap">
          ${role.canManageProjects ? `<button type="button" class="btn btn-primary" data-action="open-add-project" style="padding:5px 11px; font-size:12px;">+ New Project</button>` : `<span class="ello-pill ello-pill-slate">Role-Scoped View</span>`}
        </div>
      </div>
    `;
  }

  function renderOverview(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const wsId = ws.id;
    const campaigns = state.campaigns.filter((c) => c.workspaceId === wsId);
    const liveCampaigns = campaigns.filter((c) => c.status === "Live").length;
    const assets = state.contentAssets.filter((a) => a.workspaceId === wsId);
    const approvedAssets = assets.filter((a) => a.status === "Approved").length;
    const pendingContent = assets.filter((a) => a.status === "Pending Approval").length;
    const pendingDiffs = state.paidMedia.budgetDiffs.filter((d) => d.workspaceId === wsId && d.status === "Pending Approval").length;
    const totalPending = pendingContent + pendingDiffs;
    const leads = state.leads.filter((l) => l.workspaceId === wsId);
    const qualifiedLeads = leads.filter((l) => ["Qualified", "Proposal Sent", "Won"].includes(l.stage)).length;
    const audits = state.seoAudits.filter((s) => s.workspaceId === wsId);
    const latestAudit = audits[0] || null;
    const events = state.auditEvents.filter((e) => e.workspaceId === wsId).slice(0, 8);

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Command Overview — ${escapeHtml(ws.name)}</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Live operational state for <strong>${escapeHtml(ws.domain)}</strong> • Currency: ${escapeHtml(ws.currency)} • Timezone: ${escapeHtml(ws.timezone)}</p>
        </div>
        <div class="ello-row-gap">
          ${role.canRunSeo ? `<button type="button" class="btn btn-primary" data-goto="seo">Run Live SEO Audit</button>` : ""}
          ${role.allowedViews.includes("integrations") ? `<button type="button" class="btn btn-secondary" data-goto="integrations">Connect Real-Time Tools (Composio)</button>` : ""}
        </div>
      </div>

      <div class="ello-grid-4">
        <div class="card" style="padding:16px;">
          <div class="ello-kpi-lbl">Campaigns</div>
          <div class="ello-kpi-val">${campaigns.length}</div>
          <div class="ello-kpi-sub">${liveCampaigns} Live • ${campaigns.length - liveCampaigns} Pre-Flight</div>
        </div>
        <div class="card" style="padding:16px;">
          <div class="ello-kpi-lbl">Content Assets</div>
          <div class="ello-kpi-val">${assets.length}</div>
          <div class="ello-kpi-sub">${approvedAssets} SHA-256 Approved • ${pendingContent} Pending</div>
        </div>
        <div class="card" style="padding:16px;">
          <div class="ello-kpi-lbl">Approvals Queue</div>
          <div class="ello-kpi-val">${totalPending}</div>
          <div class="ello-kpi-sub">${pendingContent} Content • ${pendingDiffs} Budget Diffs</div>
        </div>
        <div class="card" style="padding:16px;">
          <div class="ello-kpi-lbl">CRM Leads &amp; SEO</div>
          <div class="ello-kpi-val">${leads.length} <span style="font-size:14px; font-weight:500; color:#64748b;">leads</span></div>
          <div class="ello-kpi-sub">${qualifiedLeads} Qualified • SEO: ${latestAudit ? `${latestAudit.seoScore}/100` : "Not audited"}</div>
        </div>
      </div>

      ${campaigns.length === 0 && assets.length === 0 && leads.length === 0 && !latestAudit ? `
        <div class="card" style="padding:20px; margin-bottom:18px;">
          <h3 style="margin:0 0 6px; font-size:16px;">Clean Workspace Ready — Zero Demo Data</h3>
          <p style="margin:0 0 14px; font-size:13px; color:#475569;">Every metric, audit, and CRM lead in this workspace comes from real live runs or connected Composio/webhook pipelines:</p>
          <div class="ello-row-gap">
            ${role.canRunSeo ? `<button type="button" class="btn btn-primary" data-goto="seo">1. Run Live Google Lighthouse Audit on ${escapeHtml(ws.domain)}</button>` : ""}
            ${role.canEditContent ? `<button type="button" class="btn btn-secondary" data-goto="content">2. Draft or AI-Generate Policy-Safe Copy</button>` : ""}
            ${role.allowedViews.includes("integrations") ? `<button type="button" class="btn btn-secondary" data-goto="integrations">3. Connect HubSpot / GSC / Ads via Composio</button>` : ""}
          </div>
        </div>
      ` : ""}

      <div class="ello-grid-2">
        <div class="card" style="padding:18px;">
          <div class="ello-row-between" style="margin-bottom:12px;">
            <h3 style="margin:0; font-size:15px;">Active Campaigns (${campaigns.length})</h3>
            ${role.allowedViews.includes("campaigns") ? `<button type="button" class="btn btn-secondary" data-goto="campaigns" style="padding:4px 10px; font-size:12px;">Open Module</button>` : ""}
          </div>
          ${campaigns.length === 0 ? `<div class="ello-empty">No campaigns created yet for ${escapeHtml(ws.name)}.</div>` : `
            <table class="ello-table">
              <thead><tr><th>Campaign</th><th>Channel</th><th>Status</th><th>Cap</th></tr></thead>
              <tbody>
                ${campaigns.map((c) => `
                  <tr>
                    <td><strong>${escapeHtml(c.name)}</strong><br><span style="font-size:11.5px; color:#64748b;">${escapeHtml(c.objective)}</span></td>
                    <td>${escapeHtml(c.channel)}</td>
                    <td><span class="ello-pill ${c.status === "Live" ? "ello-pill-green" : "ello-pill-amber"}">${escapeHtml(c.status)}</span></td>
                    <td>${escapeHtml(ws.currency)} ${Number(c.budgetCap || 0).toLocaleString()}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          `}
        </div>

        <div class="card" style="padding:18px;">
          <div class="ello-row-between" style="margin-bottom:12px;">
            <h3 style="margin:0; font-size:15px;">Recent Governance &amp; Audit Trail</h3>
            <span class="ello-pill ello-pill-slate">Append-Only</span>
          </div>
          ${events.length === 0 ? `<div class="ello-empty">No events recorded yet.</div>` : `
            <table class="ello-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
              <tbody>
                ${events.map((ev) => `
                  <tr>
                    <td style="white-space:nowrap; font-size:11.5px; color:#64748b;">${escapeHtml(ev.timestamp)}</td>
                    <td>${escapeHtml(ev.actor)}</td>
                    <td><code style="font-size:11px;">${escapeHtml(ev.action)}</code></td>
                    <td>${escapeHtml(ev.target)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          `}
        </div>
      </div>
    `;
  }

  function renderCampaigns(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const campaigns = state.campaigns.filter((c) => c.workspaceId === ws.id);

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Campaigns, UTM Builder &amp; 10-Point Pre-Flight Gatekeeper</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Standardize attribution UTMs and verify all 10 governance controls before launching Live.</p>
        </div>
      </div>

      ${role.canEditContent ? `
        <div class="ello-grid-2">
          <div class="card" style="padding:18px;">
            <h3 style="margin:0 0 12px; font-size:15px;">Create Real Campaign</h3>
            <form id="createCampaignForm">
              <div class="ello-grid-2" style="margin-bottom:0;">
                <div class="ello-field">
                  <label>Campaign Name *</label>
                  <input class="ello-input" name="name" required placeholder="e.g., Q4 Enterprise Search" />
                </div>
                <div class="ello-field">
                  <label>Objective *</label>
                  <input class="ello-input" name="objective" required placeholder="e.g., Demo Bookings" />
                </div>
              </div>
              <div class="ello-grid-2" style="margin-bottom:0;">
                <div class="ello-field">
                  <label>Channel</label>
                  <input class="ello-input" name="channel" value="Google Search + LinkedIn" />
                </div>
                <div class="ello-field">
                  <label>Budget Cap (${escapeHtml(ws.currency)})</label>
                  <input class="ello-input" type="number" min="0" step="1" name="budgetCap" value="1000" />
                </div>
              </div>
              <button type="submit" class="btn btn-primary">+ Add Campaign</button>
            </form>
          </div>

          <div class="card" style="padding:18px;">
            <h3 style="margin:0 0 12px; font-size:15px;">Governed UTM Attribution Builder</h3>
            <form id="utmBuilderForm">
              <div class="ello-field">
                <label>Landing Page URL</label>
                <input class="ello-input" name="baseUrl" value="https://${escapeHtml(ws.domain)}/" required />
              </div>
              <div class="ello-grid-2" style="margin-bottom:0;">
                <div class="ello-field">
                  <label>utm_source</label>
                  <input class="ello-input" name="source" value="linkedin" required />
                </div>
                <div class="ello-field">
                  <label>utm_medium</label>
                  <input class="ello-input" name="medium" value="paid_social" required />
                </div>
              </div>
              <div class="ello-field">
                <label>utm_campaign</label>
                <input class="ello-input" name="campaign" value="q4_enterprise_launch" required />
              </div>
              <button type="submit" class="btn btn-secondary">Generate &amp; Copy Tracked URL</button>
              <div id="utmResultBox" style="margin-top:8px; font-size:12px; color:#2563eb; word-break:break-all;"></div>
            </form>
          </div>
        </div>
      ` : ""}

      ${campaigns.length === 0 ? `<div class="ello-empty">No campaigns yet in <strong>${escapeHtml(ws.name)}</strong>.</div>` : campaigns.map((cmp) => {
        const doneCount = cmp.checklist.filter((i) => i.done).length;
        const allDone = doneCount === cmp.checklist.length;
        return `
          <div class="card" style="padding:18px; margin-bottom:16px;">
            <div class="ello-row-between" style="margin-bottom:10px;">
              <div>
                <h3 style="margin:0; font-size:16px;">${escapeHtml(cmp.name)}</h3>
                <div style="font-size:12.5px; color:#64748b; margin-top:2px;">
                  Objective: <strong>${escapeHtml(cmp.objective)}</strong> • Channel: ${escapeHtml(cmp.channel)} • Budget Cap: <strong>${escapeHtml(ws.currency)} ${Number(cmp.budgetCap).toLocaleString()}</strong>
                </div>
              </div>
              <div class="ello-row-gap">
                <span class="ello-pill ${cmp.status === "Live" ? "ello-pill-green" : "ello-pill-amber"}">${escapeHtml(cmp.status)} (${doneCount}/${cmp.checklist.length})</span>
                ${role.canApprove && cmp.status !== "Live" ? `
                  <button type="button" class="btn btn-success" data-launch-campaign="${escapeHtml(cmp.id)}" ${allDone ? "" : "disabled"}>
                    Launch Live
                  </button>
                ` : ""}
              </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:8px; margin-top:12px;">
              ${cmp.checklist.map((item) => `
                <label style="display:flex; align-items:center; gap:8px; font-size:12.5px; padding:6px 10px; background:#f8fafc; border-radius:6px; cursor:${role.canEditContent ? "pointer" : "default"};">
                  <input type="checkbox" data-toggle-chk="${escapeHtml(cmp.id)}:${escapeHtml(item.id)}" ${item.done ? "checked" : ""} ${role.canEditContent ? "" : "disabled"} />
                  <span>${escapeHtml(item.label)}</span>
                </label>
              `).join("")}
            </div>
          </div>
        `;
      }).join("")}
    `;

    const utmForm = document.getElementById("utmBuilderForm");
    if (utmForm) {
      utmForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(utmForm);
        try {
          const u = new URL(String(fd.get("baseUrl") || "").trim());
          u.searchParams.set("utm_source", String(fd.get("source") || "").trim().toLowerCase());
          u.searchParams.set("utm_medium", String(fd.get("medium") || "").trim().toLowerCase());
          u.searchParams.set("utm_campaign", String(fd.get("campaign") || "").trim().toLowerCase().replace(/\s+/g, "_"));
          const finalUrl = u.toString();
          document.getElementById("utmResultBox").textContent = `Copied: ${finalUrl}`;
          if (navigator.clipboard) await navigator.clipboard.writeText(finalUrl);
        } catch (err) {
          document.getElementById("utmResultBox").textContent = "Enter a valid URL starting with https://";
        }
      });
    }

    const form = document.getElementById("createCampaignForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get("name") || "").trim();
        const objective = String(fd.get("objective") || "").trim();
        if (!name || !objective) return;
        const cmp = {
          id: uid("cmp"),
          workspaceId: ws.id,
          name,
          objective,
          channel: String(fd.get("channel") || "Multi-Channel").trim(),
          status: "Pre-Flight",
          budgetCap: Math.max(0, Number(fd.get("budgetCap") || 0)),
          spent: 0,
          owner: state.currentRole,
          startDate: nowTimestamp().slice(0, 10),
          endDate: "",
          checklist: [
            { id: "chk_1", label: "Brand voice & banned-claims lint passed", done: false },
            { id: "chk_2", label: "Destination URL HTTP 200 verified", done: false },
            { id: "chk_3", label: "UTM taxonomy & CRM attribution validated", done: false },
            { id: "chk_4", label: "Hard budget cap & pacing ceiling locked", done: false },
            { id: "chk_5", label: "Conversion tracking & webhook verified", done: false },
            { id: "chk_6", label: "Consent & privacy notice visible on forms", done: false },
            { id: "chk_7", label: "Creative specs & alt text verified", done: false },
            { id: "chk_8", label: "Approver SHA-256 sign-off logged", done: false },
            { id: "chk_9", label: "Brand safety & negative exclusions applied", done: false },
            { id: "chk_10", label: "Rollback trigger threshold configured", done: false }
          ]
        };
        state.campaigns.unshift(cmp);
        await cloudUpsert("campaigns", {
          id: cmp.id,
          workspace_id: cmp.workspaceId,
          name: cmp.name,
          objective: cmp.objective,
          channel: cmp.channel,
          status: cmp.status,
          budget_cap: cmp.budgetCap,
          owner: cmp.owner,
          start_date: cmp.startDate,
          checklist: cmp.checklist
        });
        logAudit("CAMPAIGN_CREATED", name);
        saveLocalState();
        renderApp();
      });
    }

    container.querySelectorAll("[data-toggle-chk]").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const [cmpId, chkId] = cb.getAttribute("data-toggle-chk").split(":");
        const cmp = state.campaigns.find((c) => c.id === cmpId);
        if (!cmp) return;
        const item = cmp.checklist.find((i) => i.id === chkId);
        if (item) item.done = cb.checked;
        if (!cb.checked && cmp.status === "Live") cmp.status = "Pre-Flight";
        await cloudUpsert("campaigns", {
          id: cmp.id,
          workspace_id: cmp.workspaceId,
          name: cmp.name,
          objective: cmp.objective,
          channel: cmp.channel,
          status: cmp.status,
          budget_cap: cmp.budgetCap,
          checklist: cmp.checklist
        });
        logAudit("PREFLIGHT_CHECK_UPDATED", `${cmp.name} (${chkId}=${cb.checked})`);
        saveLocalState();
        renderApp();
      });
    });

    container.querySelectorAll("[data-launch-campaign]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cmp = state.campaigns.find((c) => c.id === btn.getAttribute("data-launch-campaign"));
        if (!cmp || !cmp.checklist.every((i) => i.done)) return;
        cmp.status = "Live";
        await cloudUpsert("campaigns", {
          id: cmp.id,
          workspace_id: cmp.workspaceId,
          name: cmp.name,
          objective: cmp.objective,
          channel: cmp.channel,
          status: cmp.status,
          budget_cap: cmp.budgetCap,
          checklist: cmp.checklist
        });
        logAudit("CAMPAIGN_LAUNCHED_LIVE", cmp.name);
        saveLocalState();
        renderApp();
      });
    });
  }

  function evaluatePolicy(body, channel, url) {
    const brand = currentBrand();
    const lower = (body || "").toLowerCase();
    const violations = [];
    (brand.bannedClaims || []).forEach((claim) => {
      if (claim && lower.includes(claim.toLowerCase())) {
        violations.push(`Banned claim detected: "${claim}"`);
      }
    });
    const chKey = (channel || "").toLowerCase().includes("whatsapp")
      ? "whatsapp"
      : (channel || "").toLowerCase().includes("email")
      ? "email"
      : (channel || "").toLowerCase().includes("paid") || (channel || "").toLowerCase().includes("ads")
      ? "paid"
      : "";
    if (chKey && brand.requiredDisclaimers && brand.requiredDisclaimers[chKey]) {
      const req = brand.requiredDisclaimers[chKey].trim();
      if (req && !lower.includes(req.toLowerCase())) {
        violations.push(`Missing required ${chKey} disclaimer: "${req}"`);
      }
    }
    if (url && !/^https?:\/\/.+/i.test(url.trim())) {
      violations.push("Destination URL must start with http:// or https://");
    }
    return violations;
  }

  function renderContentStudio(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const brand = currentBrand();
    const assets = state.contentAssets.filter((a) => a.workspaceId === ws.id);
    if (assets.length > 0 && !assets.some((a) => a.id === selectedContentId)) {
      selectedContentId = assets[0].id;
    }
    const activeAsset = assets.find((a) => a.id === selectedContentId) || null;
    const violations = activeAsset ? evaluatePolicy(activeAsset.body, activeAsset.channel, activeAsset.destinationUrl) : [];

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Content Studio, Gemini AI Copywriter &amp; Policy Guardrails</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Budget-capped AI drafting, deterministic brand compliance scanning, and SHA-256 version-locked approvals.</p>
        </div>
        ${role.canEditContent ? `<button type="button" class="btn btn-primary" id="newAssetBtn">+ New Content Draft</button>` : ""}
      </div>

      ${assets.length > 0 ? `
        <div class="ello-row-gap" style="margin-bottom:14px;">
          ${assets.map((a) => `
            <button type="button" class="btn ${a.id === selectedContentId ? "btn-primary" : "btn-secondary"}" data-select-asset="${escapeHtml(a.id)}" style="font-size:12px;">
              ${escapeHtml(a.channel)}: ${escapeHtml(a.title.slice(0, 32))}${a.title.length > 32 ? "..." : ""} (v${a.version})
            </button>
          `).join("")}
        </div>
      ` : ""}

      ${!activeAsset ? `
        <div class="ello-empty">No content drafts yet for <strong>${escapeHtml(ws.name)}</strong>. ${role.canEditContent ? `Click <strong>+ New Content Draft</strong> to start drafting.` : "No drafts assigned for review."}</div>
      ` : `
        <div class="ello-grid-2">
          <div class="card" style="padding:18px;">
            <div class="ello-row-between" style="margin-bottom:10px;">
              <div>
                <h3 style="margin:0; font-size:15px;">Draft Editor &amp; AI Copy Assist</h3>
                <div style="font-size:12px; color:#64748b;">Version v${activeAsset.version}${activeAsset.approvedHash ? ` • Hash ${escapeHtml(activeAsset.approvedHash.slice(0, 16))}` : ""}</div>
              </div>
              <span class="ello-pill ${activeAsset.status === "Approved" ? "ello-pill-green" : "ello-pill-amber"}">${escapeHtml(activeAsset.status)}</span>
            </div>

            ${role.canEditContent ? `
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin-bottom:12px;">
                <div style="font-size:12px; font-weight:600; color:#334155; margin-bottom:6px;">Policy-Safe Gemini AI Draft Generator (Respects Brand Rules &amp; AI Cap)</div>
                <div class="ello-row-gap">
                  <input class="ello-input" id="aiTopicInput" style="flex:1; min-width:200px;" placeholder="Brief / topic (e.g., Enterprise Cloud Migration Case Study)" />
                  <button type="button" class="btn btn-primary" id="generateAiDraftBtn" style="white-space:nowrap;">Generate AI Draft</button>
                </div>
                <div id="aiDraftStatus" style="font-size:12px; color:#2563eb; margin-top:6px;"></div>
              </div>
            ` : ""}

            <form id="editAssetForm">
              <div class="ello-grid-2" style="margin-bottom:0;">
                <div class="ello-field">
                  <label>Target Channel</label>
                  <select class="ello-select" name="channel" ${role.canEditContent ? "" : "disabled"}>
                    ${["LinkedIn Article", "LinkedIn Sponsored", "Blog / SEO Pillar", "Email Nurture", "WhatsApp Broadcast", "Google Search Ad"].map((ch) => `
                      <option value="${escapeHtml(ch)}" ${activeAsset.channel === ch ? "selected" : ""}>${escapeHtml(ch)}</option>
                    `).join("")}
                  </select>
                </div>
                <div class="ello-field">
                  <label>Scheduled Publish Date</label>
                  <input class="ello-input" type="date" name="scheduledDate" value="${escapeHtml(activeAsset.scheduledDate || "")}" ${role.canEditContent ? "" : "disabled"} />
                </div>
              </div>
              <div class="ello-field">
                <label>Headline / Asset Title</label>
                <input class="ello-input" id="assetTitleInput" name="title" value="${escapeHtml(activeAsset.title)}" ${role.canEditContent ? "" : "disabled"} />
              </div>
              <div class="ello-field">
                <label>Destination URL</label>
                <input class="ello-input" name="destinationUrl" value="${escapeHtml(activeAsset.destinationUrl || `https://${ws.domain}`)}" ${role.canEditContent ? "" : "disabled"} />
              </div>
              <div class="ello-field">
                <label>Body Copy / Script (${(activeAsset.body || "").length} chars)</label>
                <textarea class="ello-textarea" id="assetBodyInput" name="body" ${role.canEditContent ? "" : "disabled"}>${escapeHtml(activeAsset.body)}</textarea>
              </div>
              <div class="ello-row-gap">
                ${role.canEditContent ? `<button type="submit" class="btn btn-primary">Save &amp; Scan Policy</button>` : ""}
                ${role.canApprove && activeAsset.status !== "Approved" ? `
                  <button type="button" class="btn btn-success" id="approveAssetBtn" ${violations.length > 0 ? "disabled" : ""}>
                    Sign Off &amp; SHA-256 Lock
                  </button>
                ` : ""}
              </div>
            </form>
          </div>

          <div class="card" style="padding:18px;">
            <div class="ello-row-between" style="margin-bottom:10px;">
              <div>
                <h3 style="margin:0; font-size:15px;">Deterministic Quality &amp; Policy Scanner</h3>
                <div style="font-size:12px; color:#64748b;">Evaluated against Brand Profile ${escapeHtml(brand.version)}</div>
              </div>
              <span class="ello-pill ${violations.length === 0 ? "ello-pill-green" : "ello-pill-red"}">${violations.length === 0 ? "ALL CHECKS PASSED" : `${violations.length} ISSUE(S)`}</span>
            </div>
            ${violations.length === 0 ? `
              <div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; padding:10px 12px; border-radius:6px; font-size:12.5px; margin-bottom:14px;">
                <strong>Clean Compliance Scan:</strong> Zero banned claims detected, required disclaimers verified, and destination URL format valid.
              </div>
            ` : `
              <div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:10px 12px; border-radius:6px; font-size:12.5px; margin-bottom:14px;">
                <strong>Policy Violations Blocking Approval:</strong>
                <ul style="margin:6px 0 0 18px; padding:0;">
                  ${violations.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}
                </ul>
              </div>
            `}
            <div style="border:1px solid #e2e8f0; border-radius:8px; padding:14px; background:#f8fafc;">
              <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#64748b; margin-bottom:6px;">Live ${escapeHtml(activeAsset.channel)} Preview</div>
              <div style="font-weight:700; font-size:14px; color:#0f172a; margin-bottom:6px;">${escapeHtml(activeAsset.title)}</div>
              <div style="font-size:13px; color:#334155; white-space:pre-wrap; line-height:1.5;">${escapeHtml(activeAsset.body)}</div>
              ${activeAsset.destinationUrl ? `<div style="margin-top:8px; font-size:12px; color:#2563eb;">${escapeHtml(activeAsset.destinationUrl)}</div>` : ""}
            </div>
          </div>
        </div>
      `}
    `;

    const newBtn = document.getElementById("newAssetBtn");
    if (newBtn) {
      newBtn.addEventListener("click", async () => {
        const asset = {
          id: uid("cnt"),
          workspaceId: ws.id,
          title: "New Content Asset",
          channel: "LinkedIn Article",
          status: "Pending Approval",
          version: 1,
          scheduledDate: nowTimestamp().slice(0, 10),
          destinationUrl: `https://${ws.domain}`,
          body: "",
          approvedHash: ""
        };
        state.contentAssets.unshift(asset);
        selectedContentId = asset.id;
        await cloudUpsert("content_assets", {
          id: asset.id,
          workspace_id: asset.workspaceId,
          title: asset.title,
          channel: asset.channel,
          status: asset.status,
          version: asset.version,
          scheduled_date: asset.scheduledDate,
          destination_url: asset.destinationUrl,
          body: asset.body,
          approved_hash: asset.approvedHash
        });
        logAudit("CONTENT_DRAFT_CREATED", asset.id);
        saveLocalState();
        renderApp();
      });
    }

    const aiBtn = document.getElementById("generateAiDraftBtn");
    if (aiBtn && activeAsset) {
      aiBtn.addEventListener("click", async () => {
        const statusEl = document.getElementById("aiDraftStatus");
        const topic = String(document.getElementById("aiTopicInput").value || "").trim() || activeAsset.title;
        if (Number(ws.aiSpentUsd || 0) >= Number(ws.aiBudgetUsd || 0)) {
          statusEl.style.color = "#b91c1c";
          statusEl.textContent = "Workspace AI budget cap reached.";
          return;
        }
        aiBtn.disabled = true;
        statusEl.style.color = "#2563eb";
        statusEl.textContent = "Generating brand-compliant copy via Gemini...";

        try {
          let generated = null;
          // Prefer server-side /api/ai-draft when GEMINI_API_KEY is configured on Netlify
          const serverResp = await fetch("/api/ai-draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topic,
              channel: activeAsset.channel,
              brandProfile: brand,
              aiSpentUsd: ws.aiSpentUsd,
              aiBudgetUsd: ws.aiBudgetUsd
            })
          });
          if (serverResp.ok) {
            generated = await serverResp.json();
          } else if (state.apiKeys && state.apiKeys.gemini) {
            const prompt = `Write a compliant ${activeAsset.channel} post for ${brand.brandName} about "${topic}". Voice: ${brand.voiceTone}. Never use: ${(brand.bannedClaims || []).join(", ")}. Return JSON {"title":"...","body":"..."}.`;
            const directResp = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(state.apiKeys.gemini)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: { responseMimeType: "application/json" }
                })
              }
            );
            const directData = await directResp.json();
            if (!directResp.ok) throw new Error(directData?.error?.message || "Gemini API error");
            generated = JSON.parse(directData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
            generated.estimatedCostUsd = 0.02;
          } else {
            const errBody = await serverResp.json().catch(() => ({}));
            throw new Error(errBody.error || "Configure GEMINI_API_KEY in Netlify Env Vars or Integrations tab.");
          }

          if (activeAsset.status === "Approved") {
            activeAsset.version += 1;
            activeAsset.status = "Pending Approval";
            activeAsset.approvedHash = "";
          }
          activeAsset.title = generated.title || activeAsset.title;
          activeAsset.body = generated.body || activeAsset.body;
          ws.aiSpentUsd = Number((Number(ws.aiSpentUsd || 0) + Number(generated.estimatedCostUsd || 0.02)).toFixed(2));
          logAudit("AI_DRAFT_GENERATED", `${activeAsset.title} ($${generated.estimatedCostUsd || 0.02})`);
          saveLocalState();
          renderApp();
        } catch (err) {
          aiBtn.disabled = false;
          statusEl.style.color = "#b91c1c";
          statusEl.textContent = err.message;
        }
      });
    }

    container.querySelectorAll("[data-select-asset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedContentId = btn.getAttribute("data-select-asset");
        renderApp();
      });
    });

    const editForm = document.getElementById("editAssetForm");
    if (editForm && activeAsset) {
      editForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(editForm);
        const nextTitle = String(fd.get("title") || "").trim() || activeAsset.title;
        const nextChannel = String(fd.get("channel") || activeAsset.channel);
        const nextDate = String(fd.get("scheduledDate") || "");
        const nextUrl = String(fd.get("destinationUrl") || "").trim();
        const nextBody = String(fd.get("body") || "");

        const changed = nextTitle !== activeAsset.title || nextBody !== activeAsset.body || nextChannel !== activeAsset.channel;
        if (activeAsset.status === "Approved" && changed) {
          activeAsset.version += 1;
          activeAsset.status = "Pending Approval";
          activeAsset.approvedHash = "";
        }
        activeAsset.title = nextTitle;
        activeAsset.channel = nextChannel;
        activeAsset.scheduledDate = nextDate;
        activeAsset.destinationUrl = nextUrl;
        activeAsset.body = nextBody;
        await cloudUpsert("content_assets", {
          id: activeAsset.id,
          workspace_id: activeAsset.workspaceId,
          title: activeAsset.title,
          channel: activeAsset.channel,
          status: activeAsset.status,
          version: activeAsset.version,
          scheduled_date: activeAsset.scheduledDate,
          destination_url: activeAsset.destinationUrl,
          body: activeAsset.body,
          approved_hash: activeAsset.approvedHash
        });
        logAudit("CONTENT_UPDATED", `${activeAsset.title} (v${activeAsset.version})`);
        saveLocalState();
        renderApp();
      });
    }

    const approveBtn = document.getElementById("approveAssetBtn");
    if (approveBtn && activeAsset) {
      approveBtn.addEventListener("click", async () => {
        const hash = await computeSha256(`${activeAsset.id}|v${activeAsset.version}|${activeAsset.title}|${activeAsset.body}`);
        activeAsset.status = "Approved";
        activeAsset.approvedHash = hash;
        await cloudUpsert("content_assets", {
          id: activeAsset.id,
          workspace_id: activeAsset.workspaceId,
          title: activeAsset.title,
          channel: activeAsset.channel,
          status: activeAsset.status,
          version: activeAsset.version,
          scheduled_date: activeAsset.scheduledDate,
          destination_url: activeAsset.destinationUrl,
          body: activeAsset.body,
          approved_hash: activeAsset.approvedHash
        });
        logAudit("CONTENT_APPROVED_SHA256", `${activeAsset.title} (${hash.slice(0, 12)})`);
        saveLocalState();
        renderApp();
      });
    }
  }

  function renderCalendar(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const assets = state.contentAssets.filter((a) => a.workspaceId === ws.id);

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Calendar &amp; Hash-Verified Publishing</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Only SHA-256 approved content assets can be marked Published.</p>
        </div>
      </div>
      <div class="card" style="padding:18px;">
        ${assets.length === 0 ? `<div class="ello-empty">No scheduled content items in <strong>${escapeHtml(ws.name)}</strong> yet.</div>` : `
          <table class="ello-table">
            <thead><tr><th>Scheduled Date</th><th>Asset</th><th>Channel</th><th>Governance Status</th><th>Publish Action</th></tr></thead>
            <tbody>
              ${assets.map((a) => `
                <tr>
                  <td>${escapeHtml(a.scheduledDate || "Unscheduled")}</td>
                  <td><strong>${escapeHtml(a.title)}</strong> (v${a.version})</td>
                  <td>${escapeHtml(a.channel)}</td>
                  <td><span class="ello-pill ${a.status === "Published" ? "ello-pill-blue" : a.status === "Approved" ? "ello-pill-green" : "ello-pill-amber"}">${escapeHtml(a.status)}</span></td>
                  <td>
                    ${a.status === "Approved" && (role.canApprove || role.canEditContent) ? `
                      <button type="button" class="btn btn-primary" data-publish-asset="${escapeHtml(a.id)}" style="padding:4px 10px; font-size:12px;">Mark Published</button>
                    ` : a.status === "Published" ? `<span style="font-size:12px; color:#166534;">Published</span>` : `<span style="font-size:12px; color:#64748b;">Awaiting SHA-256 Approval</span>`}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;

    container.querySelectorAll("[data-publish-asset]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const asset = state.contentAssets.find((a) => a.id === btn.getAttribute("data-publish-asset"));
        if (!asset || asset.status !== "Approved") return;
        asset.status = "Published";
        await cloudUpsert("content_assets", {
          id: asset.id,
          workspace_id: asset.workspaceId,
          title: asset.title,
          channel: asset.channel,
          status: asset.status,
          version: asset.version,
          scheduled_date: asset.scheduledDate,
          destination_url: asset.destinationUrl,
          body: asset.body,
          approved_hash: asset.approvedHash
        });
        logAudit("CONTENT_PUBLISHED", `${asset.title} (v${asset.version})`);
        saveLocalState();
        renderApp();
      });
    });
  }

  function renderSeoAudits(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const audits = state.seoAudits.filter((s) => s.workspaceId === ws.id);
    const latest = audits[0] || null;
    const totalCrawled = audits.reduce((acc, a) => acc + Number(a.pagesCrawled || 1), 0);

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">SEO &amp; Website Intelligence (Mobile + Desktop Lighthouse)</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Live Google PageSpeed / Lighthouse v5 diagnostics with Core Web Vitals (LCP &amp; CLS).</p>
        </div>
      </div>

      <div class="card" style="padding:18px; margin-bottom:18px;">
        <h3 style="margin:0 0 4px; font-size:15px;">Run Real Live Website SEO &amp; Core Web Vitals Audit</h3>
        <p style="margin:0 0 12px; font-size:12.5px; color:#64748b;">Queries Google's live PageSpeed / Lighthouse API over HTTPS ($0 cost).</p>
        <form id="liveSeoForm" class="ello-row-gap">
          <input class="ello-input" id="seoUrlInput" style="max-width:420px;" value="https://${escapeHtml(ws.domain)}" placeholder="https://example.com" ${role.canRunSeo ? "" : "disabled"} />
          <select class="ello-select" id="seoStrategySelect" style="width:140px;" ${role.canRunSeo ? "" : "disabled"}>
            <option value="MOBILE" ${seoStrategy === "MOBILE" ? "selected" : ""}>Mobile</option>
            <option value="DESKTOP" ${seoStrategy === "DESKTOP" ? "selected" : ""}>Desktop</option>
          </select>
          <button type="submit" class="btn btn-primary" id="runSeoBtn" ${role.canRunSeo ? "" : "disabled"}>Run Live SEO Audit</button>
        </form>
        <div id="seoStatusMsg" style="margin-top:8px; font-size:12.5px; color:#2563eb;"></div>
      </div>

      <div class="ello-grid-4">
        <div class="card" style="padding:16px;">
          <div class="ello-kpi-lbl">SEO Score (${latest ? escapeHtml(latest.strategy || "MOBILE") : "—"})</div>
          <div class="ello-kpi-val">${latest ? `${latest.seoScore} / 100` : "—"}</div>
          <div class="ello-kpi-sub">${latest ? escapeHtml(latest.domain) : "Run live audit above"}</div>
        </div>
        <div class="card" style="padding:16px;">
          <div class="ello-kpi-lbl">Performance &amp; CWV</div>
          <div class="ello-kpi-val">${latest ? `${latest.perfScore} / 100` : "—"}</div>
          <div class="ello-kpi-sub">${latest && latest.lcp ? `LCP: ${escapeHtml(latest.lcp)} • CLS: ${escapeHtml(latest.cls)}` : "Core Web Vitals"}</div>
        </div>
        <div class="card" style="padding:16px;">
          <div class="ello-kpi-lbl">Accessibility</div>
          <div class="ello-kpi-val">${latest ? `${latest.accessScore} / 100` : "—"}</div>
          <div class="ello-kpi-sub">WCAG &amp; Semantic Checks</div>
        </div>
        <div class="card" style="padding:16px;">
          <div class="ello-kpi-lbl">Pages Audited</div>
          <div class="ello-kpi-val">${totalCrawled}</div>
          <div class="ello-kpi-sub">${latest ? `${(latest.findings || []).length} open finding(s)` : "0 audits stored"}</div>
        </div>
      </div>

      <div class="card" style="padding:18px; margin-bottom:18px;">
        <h3 style="margin:0 0 12px; font-size:15px;">Evidence-Backed Technical Findings</h3>
        ${!latest || !latest.findings || latest.findings.length === 0 ? `
          <div class="ello-empty">${latest ? "No failing Lighthouse SEO/Performance audits reported for this URL." : `Enter <strong>https://${escapeHtml(ws.domain)}</strong> above and click <strong>Run Live SEO Audit</strong>.`}</div>
        ` : `
          <table class="ello-table">
            <thead><tr><th>Severity</th><th>URL</th><th>Issue</th><th>Diagnostic Metric</th></tr></thead>
            <tbody>
              ${latest.findings.map((f) => `
                <tr>
                  <td><span class="ello-pill ${f.severity === "High" ? "ello-pill-red" : "ello-pill-amber"}">${escapeHtml(f.severity)}</span></td>
                  <td style="word-break:break-all; font-size:12px;">${escapeHtml(f.url)}</td>
                  <td>${escapeHtml(f.issue)}</td>
                  <td>${escapeHtml(f.fix)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>

      ${audits.length > 1 ? `
        <div class="card" style="padding:18px;">
          <h3 style="margin:0 0 12px; font-size:15px;">Audit Trend History (${audits.length} runs)</h3>
          <table class="ello-table">
            <thead><tr><th>Timestamp</th><th>Domain</th><th>Device</th><th>SEO</th><th>Perf</th><th>LCP</th><th>CLS</th></tr></thead>
            <tbody>
              ${audits.map((a) => `
                <tr>
                  <td style="font-size:12px;">${escapeHtml(a.auditedAt)}</td>
                  <td>${escapeHtml(a.domain)}</td>
                  <td><span class="ello-pill ello-pill-slate">${escapeHtml(a.strategy || "MOBILE")}</span></td>
                  <td><strong>${a.seoScore}</strong></td>
                  <td>${a.perfScore}</td>
                  <td>${escapeHtml(a.lcp || "—")}</td>
                  <td>${escapeHtml(a.cls || "—")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : ""}
    `;

    const stratSel = document.getElementById("seoStrategySelect");
    if (stratSel) {
      stratSel.addEventListener("change", () => {
        seoStrategy = stratSel.value;
      });
    }

    const form = document.getElementById("liveSeoForm");
    if (form && role.canRunSeo) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        let targetUrl = String(document.getElementById("seoUrlInput").value || "").trim();
        if (!targetUrl) return;
        if (!/^https?:\/\//i.test(targetUrl)) targetUrl = "https://" + targetUrl;
        const statusEl = document.getElementById("seoStatusMsg");
        const runBtn = document.getElementById("runSeoBtn");
        runBtn.disabled = true;
        statusEl.style.color = "#2563eb";
        statusEl.textContent = `Running live ${seoStrategy} Google Lighthouse audit on ${targetUrl} (10–20 seconds)...`;

        try {
          const keyParam = state.apiKeys && state.apiKeys.pagespeed ? `&key=${encodeURIComponent(state.apiKeys.pagespeed)}` : "";
          const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=${seoStrategy}&category=PERFORMANCE&category=SEO&category=ACCESSIBILITY${keyParam}`;
          const resp = await fetch(endpoint);
          const data = await resp.json();
          if (!resp.ok || !data.lighthouseResult) {
            throw new Error((data.error && data.error.message) || `HTTP ${resp.status}`);
          }
          const cats = data.lighthouseResult.categories || {};
          const auditsMap = data.lighthouseResult.audits || {};
          const seoScore = Math.round(((cats.seo && cats.seo.score) || 0) * 100);
          const perfScore = Math.round(((cats.performance && cats.performance.score) || 0) * 100);
          const accessScore = Math.round(((cats.accessibility && cats.accessibility.score) || 0) * 100);
          const lcp = auditsMap["largest-contentful-paint"]?.displayValue || "—";
          const cls = auditsMap["cumulative-layout-shift"]?.displayValue || "—";

          const findings = [];
          Object.values(auditsMap).forEach((a) => {
            if (a && typeof a.score === "number" && a.score < 0.9 && a.title) {
              findings.push({
                severity: a.score < 0.5 ? "High" : "Medium",
                url: targetUrl,
                issue: a.title,
                fix: a.displayValue || "Optimize resource per Lighthouse diagnostic."
              });
            }
          });

          const auditObj = {
            id: uid("seo"),
            workspaceId: ws.id,
            domain: targetUrl.replace(/^https?:\/\//i, ""),
            strategy: seoStrategy,
            auditedAt: nowTimestamp(),
            pagesCrawled: 1,
            perfScore,
            seoScore,
            accessScore,
            lcp,
            cls,
            findings: findings.slice(0, 12)
          };
          state.seoAudits.unshift(auditObj);
          await cloudUpsert("seo_audits", {
            id: auditObj.id,
            workspace_id: auditObj.workspaceId,
            domain: auditObj.domain,
            strategy: auditObj.strategy,
            pages_crawled: 1,
            perf_score: perfScore,
            seo_score: seoScore,
            access_score: accessScore,
            lcp,
            cls,
            findings: auditObj.findings
          });
          logAudit("LIVE_SEO_AUDIT_COMPLETED", `${targetUrl} [${seoStrategy}] (SEO ${seoScore}, Perf ${perfScore})`);
          saveLocalState();
          renderApp();
        } catch (err) {
          runBtn.disabled = false;
          statusEl.style.color = "#b91c1c";
          statusEl.textContent = `Live PageSpeed API notice: ${err.message}`;
        }
      });
    }
  }

  function renderPaidMedia(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const campaigns = state.paidMedia.campaigns.filter((c) => c.workspaceId === ws.id);
    const diffs = state.paidMedia.budgetDiffs.filter((d) => d.workspaceId === ws.id);

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Paid Media &amp; Governed Budget Diffs</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Track live ad campaigns and route all budget increases through human sign-off with rollback rules.</p>
        </div>
      </div>

      ${role.canProposePaidDiff ? `
        <div class="ello-grid-2">
          <div class="card" style="padding:18px;">
            <h3 style="margin:0 0 12px; font-size:15px;">Add Paid Media Campaign</h3>
            <form id="addPaidCampaignForm">
              <div class="ello-grid-2" style="margin-bottom:0;">
                <div class="ello-field">
                  <label>Platform</label>
                  <select class="ello-select" name="platform">
                    <option value="Google Ads">Google Ads</option>
                    <option value="LinkedIn Ads">LinkedIn Ads</option>
                    <option value="Meta Ads">Meta Ads</option>
                  </select>
                </div>
                <div class="ello-field">
                  <label>Daily Budget (${escapeHtml(ws.currency)})</label>
                  <input class="ello-input" type="number" min="0" step="1" name="dailyBudget" value="50" required />
                </div>
              </div>
              <div class="ello-field">
                <label>Campaign Name *</label>
                <input class="ello-input" name="name" required placeholder="e.g., Search — Core Services" />
              </div>
              <div class="ello-grid-2" style="margin-bottom:0;">
                <div class="ello-field">
                  <label>Actual Spend (${escapeHtml(ws.currency)})</label>
                  <input class="ello-input" type="number" min="0" step="0.01" name="spend" value="0" />
                </div>
                <div class="ello-field">
                  <label>Conversions</label>
                  <input class="ello-input" type="number" min="0" step="1" name="conversions" value="0" />
                </div>
              </div>
              <button type="submit" class="btn btn-primary">+ Save Paid Campaign</button>
            </form>
          </div>

          <div class="card" style="padding:18px;">
            <h3 style="margin:0 0 12px; font-size:15px;">Propose Budget Diff (Routes to Approvals)</h3>
            ${campaigns.length === 0 ? `<div class="ello-empty">Add a paid campaign first to propose a budget diff.</div>` : `
              <form id="proposeDiffForm">
                <div class="ello-field">
                  <label>Select Campaign</label>
                  <select class="ello-select" name="campaignId">
                    ${campaigns.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} (Current: ${escapeHtml(ws.currency)} ${c.dailyBudget}/day)</option>`).join("")}
                  </select>
                </div>
                <div class="ello-field">
                  <label>Proposed New Daily Budget (${escapeHtml(ws.currency)})</label>
                  <input class="ello-input" type="number" min="1" step="1" name="proposedValue" required />
                </div>
                <div class="ello-field">
                  <label>Evidence &amp; Rationale *</label>
                  <input class="ello-input" name="rationale" required placeholder="e.g., Trailing 7d CPA 22% below target cap" />
                </div>
                <div class="ello-field">
                  <label>Rollback Trigger *</label>
                  <input class="ello-input" name="rollbackPlan" required placeholder="e.g., Auto-revert if 48h CPA exceeds target" />
                </div>
                <button type="submit" class="btn btn-primary">Submit Budget Diff Proposal</button>
              </form>
            `}
          </div>
        </div>
      ` : ""}

      <div class="card" style="padding:18px; margin-bottom:18px;">
        <h3 style="margin:0 0 12px; font-size:15px;">Active Paid Media Campaigns (${campaigns.length})</h3>
        ${campaigns.length === 0 ? `<div class="ello-empty">No paid media campaigns logged yet for ${escapeHtml(ws.name)}.</div>` : `
          <table class="ello-table">
            <thead><tr><th>Platform</th><th>Campaign</th><th>Daily Budget</th><th>Spend</th><th>Conversions</th><th>CPA</th></tr></thead>
            <tbody>
              ${campaigns.map((c) => {
                const cpa = c.conversions > 0 ? (c.spend / c.conversions).toFixed(2) : "—";
                return `
                  <tr>
                    <td>${escapeHtml(c.platform)}</td>
                    <td><strong>${escapeHtml(c.name)}</strong></td>
                    <td>${escapeHtml(ws.currency)} ${Number(c.dailyBudget).toLocaleString()}</td>
                    <td>${escapeHtml(ws.currency)} ${Number(c.spend).toLocaleString()}</td>
                    <td>${c.conversions}</td>
                    <td>${cpa === "—" ? "—" : `${escapeHtml(ws.currency)} ${cpa}`}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        `}
      </div>

      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px; font-size:15px;">Budget Diff Proposals (${diffs.length})</h3>
        ${diffs.length === 0 ? `<div class="ello-empty">No budget diff proposals submitted yet.</div>` : `
          <table class="ello-table">
            <thead><tr><th>Campaign</th><th>Change</th><th>Rationale &amp; Rollback</th><th>Status</th></tr></thead>
            <tbody>
              ${diffs.map((d) => `
                <tr>
                  <td><strong>${escapeHtml(d.campaignName)}</strong></td>
                  <td>${escapeHtml(ws.currency)} ${d.currentValue} → <strong>${escapeHtml(ws.currency)} ${d.proposedValue}</strong></td>
                  <td>${escapeHtml(d.rationale)}<br><span style="font-size:11.5px; color:#64748b;">Rollback: ${escapeHtml(d.rollbackPlan)}</span></td>
                  <td><span class="ello-pill ${d.status === "Approved" ? "ello-pill-green" : d.status === "Rejected" ? "ello-pill-red" : "ello-pill-amber"}">${escapeHtml(d.status)}</span></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;

    const addPaidForm = document.getElementById("addPaidCampaignForm");
    if (addPaidForm) {
      addPaidForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(addPaidForm);
        const name = String(fd.get("name") || "").trim();
        if (!name) return;
        const pm = {
          id: uid("pm"),
          workspaceId: ws.id,
          platform: String(fd.get("platform") || "Google Ads"),
          name,
          status: "Active",
          dailyBudget: Math.max(0, Number(fd.get("dailyBudget") || 0)),
          spend: Math.max(0, Number(fd.get("spend") || 0)),
          conversions: Math.max(0, Number(fd.get("conversions") || 0))
        };
        state.paidMedia.campaigns.unshift(pm);
        await cloudUpsert("paid_campaigns", {
          id: pm.id,
          workspace_id: pm.workspaceId,
          platform: pm.platform,
          name: pm.name,
          status: pm.status,
          daily_budget: pm.dailyBudget,
          spend: pm.spend,
          conversions: pm.conversions
        });
        logAudit("PAID_CAMPAIGN_ADDED", name);
        saveLocalState();
        renderApp();
      });
    }

    const diffForm = document.getElementById("proposeDiffForm");
    if (diffForm) {
      diffForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(diffForm);
        const cmp = state.paidMedia.campaigns.find((c) => c.id === fd.get("campaignId"));
        if (!cmp) return;
        const proposedValue = Number(fd.get("proposedValue") || cmp.dailyBudget);
        const diff = {
          id: uid("diff"),
          workspaceId: ws.id,
          campaignId: cmp.id,
          campaignName: cmp.name,
          currentValue: cmp.dailyBudget,
          proposedValue,
          rationale: String(fd.get("rationale") || "").trim(),
          rollbackPlan: String(fd.get("rollbackPlan") || "").trim(),
          proposedBy: state.currentRole,
          status: "Pending Approval"
        };
        state.paidMedia.budgetDiffs.unshift(diff);
        await cloudUpsert("budget_diffs", {
          id: diff.id,
          workspace_id: diff.workspaceId,
          campaign_id: diff.campaignId,
          campaign_name: diff.campaignName,
          current_value: diff.currentValue,
          proposed_value: diff.proposedValue,
          rationale: diff.rationale,
          rollback_plan: diff.rollbackPlan,
          proposed_by: diff.proposedBy,
          status: diff.status
        });
        logAudit("BUDGET_DIFF_PROPOSED", `${cmp.name}: ${cmp.dailyBudget} -> ${proposedValue}`);
        saveLocalState();
        renderApp();
      });
    }
  }

  function renderLeads(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const leads = state.leads.filter((l) => l.workspaceId === ws.id);

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Leads / CRM &amp; Consent-Gated Ingestion</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Ingests real-time Composio CRM triggers, bulk consent-verified CSVs, and manual leads.</p>
        </div>
        ${role.canSendMessaging ? `
          <div class="ello-row-gap">
            <input type="file" id="csvLeadFileInput" accept=".csv,text/csv" style="display:none;" />
            <button type="button" class="btn btn-secondary" id="importCsvLeadsBtn">Import Consent-Verified CSV</button>
          </div>
        ` : ""}
      </div>
      <div id="csvImportStatus" style="margin-bottom:12px; font-size:12.5px; color:#166534;"></div>

      ${role.canSendMessaging ? `
        <div class="card" style="padding:18px; margin-bottom:18px;">
          <h3 style="margin:0 0 12px; font-size:15px;">Add Real Lead with Consent Provenance</h3>
          <form id="addLeadForm" class="ello-grid-4" style="margin-bottom:0; align-items:end;">
            <div class="ello-field" style="margin-bottom:0;">
              <label>Full Name *</label>
              <input class="ello-input" name="name" required placeholder="Contact name" />
            </div>
            <div class="ello-field" style="margin-bottom:0;">
              <label>Company *</label>
              <input class="ello-input" name="company" required placeholder="Company name" />
            </div>
            <div class="ello-field" style="margin-bottom:0;">
              <label>Email *</label>
              <input class="ello-input" type="email" name="email" required placeholder="name@company.com" />
            </div>
            <div class="ello-field" style="margin-bottom:0;">
              <label>Consent Source *</label>
              <input class="ello-input" name="consentSource" required placeholder="e.g., Website Demo Form" />
            </div>
            <div style="display:flex; gap:12px; align-items:center; font-size:12.5px;">
              <label><input type="checkbox" name="emailOptIn" checked /> Email Opt-In</label>
              <label><input type="checkbox" name="whatsappOptIn" /> WhatsApp Opt-In</label>
            </div>
            <div>
              <button type="submit" class="btn btn-primary" style="width:100%;">+ Add Lead</button>
            </div>
          </form>
        </div>
      ` : ""}

      <div class="card" style="padding:18px;">
        ${leads.length === 0 ? `<div class="ello-empty">No real leads recorded yet for <strong>${escapeHtml(ws.name)}</strong>. Connect HubSpot via Composio or import a CSV with columns: <code>name,company,email,consent_source</code>.</div>` : `
          <table class="ello-table">
            <thead><tr><th>Lead</th><th>Email</th><th>Consent Provenance</th><th>Stage</th><th>Outreach Gate</th></tr></thead>
            <tbody>
              ${leads.map((l) => `
                <tr>
                  <td><strong>${escapeHtml(l.name)}</strong><br><span style="font-size:12px; color:#64748b;">${escapeHtml(l.company)}</span></td>
                  <td>${escapeHtml(l.email)}</td>
                  <td>
                    <span class="ello-pill ${l.emailOptIn ? "ello-pill-green" : "ello-pill-red"}">Email: ${l.emailOptIn ? "Opted In" : "No"}</span>
                    <span class="ello-pill ${l.whatsappOptIn ? "ello-pill-green" : "ello-pill-slate"}">WA: ${l.whatsappOptIn ? "Opted In" : "No"}</span>
                    <div style="font-size:11.5px; color:#64748b; margin-top:3px;">${escapeHtml(l.consentSource)}</div>
                  </td>
                  <td>
                    <select class="ello-select" data-lead-stage="${escapeHtml(l.id)}" ${role.canSendMessaging ? "" : "disabled"} style="padding:4px 8px; font-size:12px;">
                      ${["New", "Qualified", "Proposal Sent", "Won", "Closed Lost"].map((st) => `
                        <option value="${st}" ${l.stage === st ? "selected" : ""}>${st}</option>
                      `).join("")}
                    </select>
                  </td>
                  <td>
                    ${role.canSendMessaging && l.emailOptIn && !l.suppressed ? `
                      <button type="button" class="btn btn-secondary" data-log-outreach="${escapeHtml(l.id)}" style="padding:4px 10px; font-size:12px;">Log Verified Outreach</button>
                    ` : `<span class="ello-pill ello-pill-red">Blocked (No Consent / Role)</span>`}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;

    const csvBtn = document.getElementById("importCsvLeadsBtn");
    const csvInput = document.getElementById("csvLeadFileInput");
    if (csvBtn && csvInput) {
      csvBtn.addEventListener("click", () => csvInput.click());
      csvInput.addEventListener("change", async () => {
        const file = csvInput.files && csvInput.files[0];
        if (!file) return;
        const text = await file.text();
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) return;
        const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const idxName = headers.indexOf("name");
        const idxCompany = headers.indexOf("company");
        const idxEmail = headers.indexOf("email");
        const idxConsent = headers.indexOf("consent_source");

        let imported = 0;
        let rejected = 0;
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",").map((c) => c.trim());
          const email = idxEmail >= 0 ? cols[idxEmail] : "";
          const consent = idxConsent >= 0 ? cols[idxConsent] : "";
          if (!email || !email.includes("@") || !consent) {
            rejected += 1;
            continue;
          }
          const lead = {
            id: uid("lead"),
            workspaceId: ws.id,
            name: (idxName >= 0 && cols[idxName]) || email.split("@")[0],
            company: (idxCompany >= 0 && cols[idxCompany]) || "",
            email,
            stage: "New",
            emailOptIn: true,
            whatsappOptIn: false,
            suppressed: false,
            consentSource: consent
          };
          state.leads.unshift(lead);
          await cloudUpsert("leads", {
            id: lead.id,
            workspace_id: lead.workspaceId,
            name: lead.name,
            company: lead.company,
            email: lead.email,
            stage: lead.stage,
            email_opt_in: true,
            whatsapp_opt_in: false,
            suppressed: false,
            consent_source: lead.consentSource
          });
          imported += 1;
        }
        logAudit("CSV_LEADS_IMPORTED", `${imported} imported, ${rejected} rejected (missing consent/email)`);
        saveLocalState();
        renderApp();
        const statusEl = document.getElementById("csvImportStatus");
        if (statusEl) {
          statusEl.textContent = `CSV Import Complete: ${imported} consent-verified lead(s) added; ${rejected} row(s) blocked for missing email or consent_source.`;
        }
      });
    }

    const leadForm = document.getElementById("addLeadForm");
    if (leadForm) {
      leadForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(leadForm);
        const name = String(fd.get("name") || "").trim();
        const company = String(fd.get("company") || "").trim();
        const email = String(fd.get("email") || "").trim();
        if (!name || !company || !email) return;
        const lead = {
          id: uid("lead"),
          workspaceId: ws.id,
          name,
          company,
          email,
          stage: "New",
          emailOptIn: fd.get("emailOptIn") === "on",
          whatsappOptIn: fd.get("whatsappOptIn") === "on",
          suppressed: false,
          consentSource: String(fd.get("consentSource") || "Direct Consent").trim()
        };
        state.leads.unshift(lead);
        await cloudUpsert("leads", {
          id: lead.id,
          workspace_id: lead.workspaceId,
          name: lead.name,
          company: lead.company,
          email: lead.email,
          stage: lead.stage,
          email_opt_in: lead.emailOptIn,
          whatsapp_opt_in: lead.whatsappOptIn,
          suppressed: false,
          consent_source: lead.consentSource
        });
        logAudit("LEAD_ADDED", `${name} (${company})`);
        saveLocalState();
        renderApp();
      });
    }

    container.querySelectorAll("[data-lead-stage]").forEach((sel) => {
      sel.addEventListener("change", async () => {
        const lead = state.leads.find((l) => l.id === sel.getAttribute("data-lead-stage"));
        if (!lead) return;
        lead.stage = sel.value;
        await cloudUpsert("leads", {
          id: lead.id,
          workspace_id: lead.workspaceId,
          name: lead.name,
          company: lead.company,
          email: lead.email,
          stage: lead.stage,
          email_opt_in: lead.emailOptIn,
          whatsapp_opt_in: lead.whatsappOptIn,
          suppressed: lead.suppressed,
          consent_source: lead.consentSource
        });
        logAudit("LEAD_STAGE_UPDATED", `${lead.name} -> ${lead.stage}`);
        saveLocalState();
        renderApp();
      });
    });

    container.querySelectorAll("[data-log-outreach]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lead = state.leads.find((l) => l.id === btn.getAttribute("data-log-outreach"));
        if (!lead) return;
        logAudit("CONSENT_VERIFIED_OUTREACH_LOGGED", `${lead.name} <${lead.email}>`);
        saveLocalState();
        renderApp();
      });
    });
  }

  function renderCompetitors(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const items = state.competitors.filter((c) => c.workspaceId === ws.id);
    const canEdit = role.canEditContent || role.canRunSeo || role.canProposePaidDiff;

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Competitor Intelligence</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Public market positioning and strategic differentiation gaps for ${escapeHtml(ws.name)}.</p>
        </div>
      </div>
      ${canEdit ? `
        <div class="card" style="padding:18px; margin-bottom:18px;">
          <form id="addCompForm" class="ello-grid-4" style="margin-bottom:0; align-items:end;">
            <div class="ello-field" style="margin-bottom:0;">
              <label>Competitor Name *</label>
              <input class="ello-input" name="name" required placeholder="Competitor / Domain" />
            </div>
            <div class="ello-field" style="margin-bottom:0;">
              <label>Observed Positioning *</label>
              <input class="ello-input" name="positioning" required placeholder="How they pitch in SERP / Ads" />
            </div>
            <div class="ello-field" style="margin-bottom:0;">
              <label>Opportunity Gap *</label>
              <input class="ello-input" name="opportunityGap" required placeholder="How we outperform" />
            </div>
            <div><button type="submit" class="btn btn-primary" style="width:100%;">+ Add Competitor</button></div>
          </form>
        </div>
      ` : ""}
      <div class="card" style="padding:18px;">
        ${items.length === 0 ? `<div class="ello-empty">No competitors tracked yet for ${escapeHtml(ws.name)}.</div>` : `
          <table class="ello-table">
            <thead><tr><th>Competitor</th><th>Observed Positioning</th><th>Opportunity Gap</th></tr></thead>
            <tbody>
              ${items.map((c) => `
                <tr>
                  <td><strong>${escapeHtml(c.name)}</strong></td>
                  <td>${escapeHtml(c.positioning)}</td>
                  <td>${escapeHtml(c.opportunityGap)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;

    const form = document.getElementById("addCompForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        state.competitors.unshift({
          id: uid("comp"),
          workspaceId: ws.id,
          name: String(fd.get("name") || "").trim(),
          positioning: String(fd.get("positioning") || "").trim(),
          opportunityGap: String(fd.get("opportunityGap") || "").trim()
        });
        logAudit("COMPETITOR_LOGGED", String(fd.get("name") || "").trim());
        saveLocalState();
        renderApp();
      });
    }
  }

  function renderApprovals(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const pendingContent = state.contentAssets.filter((c) => c.workspaceId === ws.id && c.status === "Pending Approval");
    const pendingDiffs = state.paidMedia.budgetDiffs.filter((d) => d.workspaceId === ws.id && d.status === "Pending Approval");

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Governance Approvals Inbox</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Human-in-the-loop sign-off queue for SHA-256 content locking and paid media budget diffs.</p>
        </div>
      </div>

      <div class="card" style="padding:18px; margin-bottom:18px;">
        <h3 style="margin:0 0 12px; font-size:15px;">Pending Content Approvals (${pendingContent.length})</h3>
        ${pendingContent.length === 0 ? `<div class="ello-empty">No content drafts awaiting approval.</div>` : `
          <table class="ello-table">
            <thead><tr><th>Asset</th><th>Channel</th><th>Policy Check</th><th>Action</th></tr></thead>
            <tbody>
              ${pendingContent.map((a) => {
                const errs = evaluatePolicy(a.body, a.channel, a.destinationUrl);
                return `
                  <tr>
                    <td><strong>${escapeHtml(a.title)}</strong> (v${a.version})</td>
                    <td>${escapeHtml(a.channel)}</td>
                    <td><span class="ello-pill ${errs.length === 0 ? "ello-pill-green" : "ello-pill-red"}">${errs.length === 0 ? "Passed" : `${errs.length} Violation(s)`}</span></td>
                    <td>
                      <button type="button" class="btn btn-success" data-inbox-approve-content="${escapeHtml(a.id)}" ${role.canApprove && errs.length === 0 ? "" : "disabled"} style="padding:4px 10px; font-size:12px;">Approve &amp; Lock</button>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        `}
      </div>

      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px; font-size:15px;">Pending Budget Diff Approvals (${pendingDiffs.length})</h3>
        ${pendingDiffs.length === 0 ? `<div class="ello-empty">No paid media budget changes awaiting approval.</div>` : `
          <table class="ello-table">
            <thead><tr><th>Campaign</th><th>Proposed Change</th><th>Rationale &amp; Rollback</th><th>Action</th></tr></thead>
            <tbody>
              ${pendingDiffs.map((d) => `
                <tr>
                  <td><strong>${escapeHtml(d.campaignName)}</strong></td>
                  <td>${escapeHtml(ws.currency)} ${d.currentValue} → <strong>${escapeHtml(ws.currency)} ${d.proposedValue}</strong></td>
                  <td>${escapeHtml(d.rationale)}<br><span style="font-size:11.5px; color:#64748b;">Rollback: ${escapeHtml(d.rollbackPlan)}</span></td>
                  <td class="ello-row-gap">
                    <button type="button" class="btn btn-success" data-inbox-diff="${escapeHtml(d.id)}:Approved" ${role.canApproveBudget ? "" : "disabled"} style="padding:4px 10px; font-size:12px;">Approve</button>
                    <button type="button" class="btn btn-danger" data-inbox-diff="${escapeHtml(d.id)}:Rejected" ${role.canApproveBudget ? "" : "disabled"} style="padding:4px 10px; font-size:12px;">Reject</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;

    container.querySelectorAll("[data-inbox-approve-content]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const asset = state.contentAssets.find((a) => a.id === btn.getAttribute("data-inbox-approve-content"));
        if (!asset) return;
        const hash = await computeSha256(`${asset.id}|v${asset.version}|${asset.title}|${asset.body}`);
        asset.status = "Approved";
        asset.approvedHash = hash;
        await cloudUpsert("content_assets", {
          id: asset.id,
          workspace_id: asset.workspaceId,
          title: asset.title,
          channel: asset.channel,
          status: asset.status,
          version: asset.version,
          scheduled_date: asset.scheduledDate,
          destination_url: asset.destinationUrl,
          body: asset.body,
          approved_hash: asset.approvedHash
        });
        logAudit("CONTENT_APPROVED_SHA256", `${asset.title} (${hash.slice(0, 12)})`);
        saveLocalState();
        renderApp();
      });
    });

    container.querySelectorAll("[data-inbox-diff]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const [diffId, decision] = btn.getAttribute("data-inbox-diff").split(":");
        const diff = state.paidMedia.budgetDiffs.find((d) => d.id === diffId);
        if (!diff) return;
        diff.status = decision;
        if (decision === "Approved") {
          const cmp = state.paidMedia.campaigns.find((c) => c.id === diff.campaignId);
          if (cmp) {
            cmp.dailyBudget = diff.proposedValue;
            await cloudUpsert("paid_campaigns", {
              id: cmp.id,
              workspace_id: cmp.workspaceId,
              platform: cmp.platform,
              name: cmp.name,
              status: cmp.status,
              daily_budget: cmp.dailyBudget,
              spend: cmp.spend,
              conversions: cmp.conversions
            });
          }
        }
        await cloudUpsert("budget_diffs", {
          id: diff.id,
          workspace_id: diff.workspaceId,
          campaign_id: diff.campaignId,
          campaign_name: diff.campaignName,
          current_value: diff.currentValue,
          proposed_value: diff.proposedValue,
          rationale: diff.rationale,
          rollback_plan: diff.rollbackPlan,
          proposed_by: diff.proposedBy,
          status: diff.status
        });
        logAudit(`BUDGET_DIFF_${decision.toUpperCase()}`, `${diff.campaignName} (${diff.currentValue} -> ${diff.proposedValue})`);
        saveLocalState();
        renderApp();
      });
    });
  }

  function renderAutomations(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const rules = state.automations.filter((a) => a.workspaceId === ws.id);

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Automation Workflows &amp; Guardrails</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Define conditional rules with human approval gates and correlation-ID logging.</p>
        </div>
      </div>
      ${role.canApprove ? `
        <div class="card" style="padding:18px; margin-bottom:18px;">
          <form id="addAutoForm" class="ello-grid-4" style="margin-bottom:0; align-items:end;">
            <div class="ello-field" style="margin-bottom:0;">
              <label>Workflow Name *</label>
              <input class="ello-input" name="name" required placeholder="e.g., High-Score Lead Alert" />
            </div>
            <div class="ello-field" style="margin-bottom:0;">
              <label>Trigger Condition *</label>
              <input class="ello-input" name="trigger" required placeholder="e.g., Lead Opt-In == true" />
            </div>
            <div class="ello-field" style="margin-bottom:0;">
              <label>Governed Action *</label>
              <input class="ello-input" name="actions" required placeholder="e.g., Queue briefing in Approvals" />
            </div>
            <div><button type="submit" class="btn btn-primary" style="width:100%;">+ Add Rule</button></div>
          </form>
        </div>
      ` : ""}
      <div class="card" style="padding:18px;">
        ${rules.length === 0 ? `<div class="ello-empty">No automation rules configured yet for ${escapeHtml(ws.name)}.</div>` : `
          <table class="ello-table">
            <thead><tr><th>Workflow</th><th>Trigger</th><th>Action</th><th>Runs</th><th>Test</th></tr></thead>
            <tbody>
              ${rules.map((r) => `
                <tr>
                  <td><strong>${escapeHtml(r.name)}</strong></td>
                  <td><code>${escapeHtml(r.trigger)}</code></td>
                  <td>${escapeHtml(r.actions)}</td>
                  <td>${r.runsCount || 0}</td>
                  <td><button type="button" class="btn btn-secondary" data-run-auto="${escapeHtml(r.id)}" ${role.canApprove ? "" : "disabled"} style="padding:4px 10px; font-size:12px;">Run Now</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `}
      </div>
    `;

    const form = document.getElementById("addAutoForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        state.automations.unshift({
          id: uid("auto"),
          workspaceId: ws.id,
          name: String(fd.get("name") || "").trim(),
          trigger: String(fd.get("trigger") || "").trim(),
          actions: String(fd.get("actions") || "").trim(),
          runsCount: 0
        });
        logAudit("AUTOMATION_CREATED", String(fd.get("name") || "").trim());
        saveLocalState();
        renderApp();
      });
    }

    container.querySelectorAll("[data-run-auto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rule = state.automations.find((r) => r.id === btn.getAttribute("data-run-auto"));
        if (!rule) return;
        rule.runsCount = (rule.runsCount || 0) + 1;
        logAudit("AUTOMATION_EXECUTED", rule.name);
        saveLocalState();
        renderApp();
      });
    });
  }

  function renderReports(container) {
    const ws = currentWorkspace();
    const wsId = ws.id;
    const campaigns = state.campaigns.filter((c) => c.workspaceId === wsId);
    const assets = state.contentAssets.filter((a) => a.workspaceId === wsId);
    const leads = state.leads.filter((l) => l.workspaceId === wsId);
    const audits = state.seoAudits.filter((s) => s.workspaceId === wsId);
    const paid = state.paidMedia.campaigns.filter((p) => p.workspaceId === wsId);
    const totalSpend = paid.reduce((s, p) => s + Number(p.spend || 0), 0);
    const totalConv = paid.reduce((s, p) => s + Number(p.conversions || 0), 0);

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Analytics &amp; Executive Report — ${escapeHtml(ws.name)}</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Real aggregated workspace performance across SEO, Paid Media, Content, and Leads.</p>
        </div>
        <button type="button" class="btn btn-primary" id="exportProjectReportBtn">Download Project JSON Report</button>
      </div>
      <div class="ello-grid-4">
        <div class="card" style="padding:16px;"><div class="ello-kpi-lbl">Total Campaigns</div><div class="ello-kpi-val">${campaigns.length}</div></div>
        <div class="card" style="padding:16px;"><div class="ello-kpi-lbl">Paid Spend</div><div class="ello-kpi-val">${escapeHtml(ws.currency)} ${totalSpend.toLocaleString()}</div><div class="ello-kpi-sub">${totalConv} conversions</div></div>
        <div class="card" style="padding:16px;"><div class="ello-kpi-lbl">Approved Assets</div><div class="ello-kpi-val">${assets.filter((a) => a.status === "Approved" || a.status === "Published").length} / ${assets.length}</div></div>
        <div class="card" style="padding:16px;"><div class="ello-kpi-lbl">Verified Leads</div><div class="ello-kpi-val">${leads.length}</div><div class="ello-kpi-sub">${audits.length} live SEO audits</div></div>
      </div>
    `;

    const expBtn = document.getElementById("exportProjectReportBtn");
    if (expBtn) {
      expBtn.addEventListener("click", () => {
        downloadJson(`${ws.domain || ws.id}-report.json`, {
          exportedAt: nowTimestamp(),
          workspace: ws,
          brandProfile: currentBrand(),
          campaigns,
          contentAssets: assets,
          seoAudits: audits,
          paidMedia: paid,
          leads
        });
      });
    }
  }

  function renderBrandPolicy(container) {
    const role = currentRoleObj();
    const brand = currentBrand();

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Brand Profile &amp; Policy Guardrails (${escapeHtml(brand.version)})</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Rules configured here are deterministically enforced inside Content Studio &amp; Gemini AI drafting.</p>
        </div>
      </div>
      <div class="card" style="padding:18px;">
        <form id="brandPolicyForm">
          <div class="ello-grid-2" style="margin-bottom:0;">
            <div class="ello-field">
              <label>Brand Display Name</label>
              <input class="ello-input" name="brandName" value="${escapeHtml(brand.brandName)}" ${role.canManageBrand ? "" : "disabled"} />
            </div>
            <div class="ello-field">
              <label>Voice &amp; Tone</label>
              <input class="ello-input" name="voiceTone" value="${escapeHtml(brand.voiceTone)}" ${role.canManageBrand ? "" : "disabled"} />
            </div>
          </div>
          <div class="ello-field">
            <label>Banned Claims (comma-separated — automatically blocked in Content Studio)</label>
            <input class="ello-input" name="bannedClaims" value="${escapeHtml((brand.bannedClaims || []).join(", "))}" ${role.canManageBrand ? "" : "disabled"} />
          </div>
          <div class="ello-grid-2" style="margin-bottom:0;">
            <div class="ello-field">
              <label>Required Email Disclaimer</label>
              <input class="ello-input" name="emailDisclaimer" value="${escapeHtml((brand.requiredDisclaimers && brand.requiredDisclaimers.email) || "")}" ${role.canManageBrand ? "" : "disabled"} />
            </div>
            <div class="ello-field">
              <label>Required WhatsApp Disclaimer</label>
              <input class="ello-input" name="whatsappDisclaimer" value="${escapeHtml((brand.requiredDisclaimers && brand.requiredDisclaimers.whatsapp) || "")}" ${role.canManageBrand ? "" : "disabled"} />
            </div>
          </div>
          ${role.canManageBrand ? `<button type="submit" class="btn btn-primary">Save Brand Rules</button>` : `<span class="ello-pill ello-pill-slate">Read-Only for ${escapeHtml(role.label)}</span>`}
        </form>
      </div>
    `;

    const form = document.getElementById("brandPolicyForm");
    if (form && role.canManageBrand) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        brand.brandName = String(fd.get("brandName") || brand.brandName).trim();
        brand.voiceTone = String(fd.get("voiceTone") || "").trim();
        brand.bannedClaims = String(fd.get("bannedClaims") || "").split(",").map((s) => s.trim()).filter(Boolean);
        brand.requiredDisclaimers = brand.requiredDisclaimers || {};
        brand.requiredDisclaimers.email = String(fd.get("emailDisclaimer") || "").trim();
        brand.requiredDisclaimers.whatsapp = String(fd.get("whatsappDisclaimer") || "").trim();
        const num = parseFloat(String(brand.version || "v1.0").replace(/^v/i, "")) || 1.0;
        brand.version = `v${(num + 0.1).toFixed(1)}`;
        logAudit("BRAND_POLICY_UPDATED", `${brand.brandName} (${brand.version})`);
        saveLocalState();
        renderApp();
      });
    }
  }

  function renderProjectsManager(container) {
    const role = currentRoleObj();

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Projects &amp; Client Workspaces (${state.workspaces.length})</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Each project is an isolated tenant with independent campaigns, SEO audits, leads, and Composio OAuth connections.</p>
        </div>
        ${role.canManageProjects ? `<button type="button" class="btn btn-primary" data-action="open-add-project">+ Add New Project</button>` : ""}
      </div>

      <div class="card" style="padding:18px;">
        <table class="ello-table">
          <thead><tr><th>Project / Workspace</th><th>Domain</th><th>Currency / TZ</th><th>AI Cap</th><th>Actions</th></tr></thead>
          <tbody>
            ${state.workspaces.map((w) => {
              const isCurrent = w.id === state.currentWorkspaceId;
              return `
                <tr>
                  <td><strong>${escapeHtml(w.name)}</strong> ${isCurrent ? `<span class="ello-pill ello-pill-blue">Active</span>` : ""}<br><span style="font-size:11.5px; color:#64748b;">${escapeHtml(w.retainerStatus)}</span></td>
                  <td>${escapeHtml(w.domain)}</td>
                  <td>${escapeHtml(w.currency)} • ${escapeHtml(w.timezone)}</td>
                  <td>$${Number(w.aiSpentUsd || 0).toFixed(2)} / $${Number(w.aiBudgetUsd || 0).toFixed(2)}</td>
                  <td class="ello-row-gap">
                    ${!isCurrent ? `<button type="button" class="btn btn-primary" data-switch-ws="${escapeHtml(w.id)}" style="padding:4px 10px; font-size:12px;">Switch Into Project</button>` : ""}
                    ${role.canManageProjects && state.workspaces.length > 1 && w.id !== "ws_ellocent" ? `
                      <button type="button" class="btn btn-danger" data-delete-ws="${escapeHtml(w.id)}" style="padding:4px 10px; font-size:12px;">Delete &amp; Purge Data</button>
                    ` : ""}
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    container.querySelectorAll("[data-switch-ws]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.currentWorkspaceId = btn.getAttribute("data-switch-ws");
        await syncFromSupabase();
        saveLocalState();
        renderApp();
      });
    });

    container.querySelectorAll("[data-delete-ws]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-delete-ws");
        if (state.workspaces.length <= 1) return;
        // Cascade-purge all records belonging to deleted workspace
        state.workspaces = state.workspaces.filter((w) => w.id !== id);
        delete state.brandProfiles[id];
        state.campaigns = state.campaigns.filter((x) => x.workspaceId !== id);
        state.contentAssets = state.contentAssets.filter((x) => x.workspaceId !== id);
        state.seoAudits = state.seoAudits.filter((x) => x.workspaceId !== id);
        state.paidMedia.campaigns = state.paidMedia.campaigns.filter((x) => x.workspaceId !== id);
        state.paidMedia.budgetDiffs = state.paidMedia.budgetDiffs.filter((x) => x.workspaceId !== id);
        state.leads = state.leads.filter((x) => x.workspaceId !== id);
        state.automations = state.automations.filter((x) => x.workspaceId !== id);
        state.competitors = state.competitors.filter((x) => x.workspaceId !== id);
        state.auditEvents = state.auditEvents.filter((x) => x.workspaceId !== id);
        if (state.currentWorkspaceId === id) {
          state.currentWorkspaceId = state.workspaces[0].id;
        }
        if (supabaseClient && currentUser) {
          await supabaseClient.from("workspaces").delete().eq("id", id);
        }
        logAudit("PROJECT_WORKSPACE_PURGED", id);
        saveLocalState();
        renderApp();
      });
    });
  }

  function renderIntegrations(container) {
    const ws = currentWorkspace();
    const role = currentRoleObj();
    const webhookUrl = `${window.location.origin}/api/composio-hook`;
    const toolkits = [
      { slug: "hubspot", name: "HubSpot CRM", desc: "Real-time contact & deal triggers into Leads / CRM" },
      { slug: "googlesearchconsole", name: "Google Search Console", desc: "Hourly clicks, impressions & query rankings" },
      { slug: "googleanalytics", name: "Google Analytics 4 (GA4)", desc: "Conversion events & organic/paid traffic attribution" },
      { slug: "googleads", name: "Google Ads", desc: "Live ad spend, conversions & CPA rollback alerts" },
      { slug: "metaads", name: "Meta Ads", desc: "Facebook/Instagram lead forms & campaign spend" },
      { slug: "slack", name: "Slack Governance Alerts", desc: "Instant notifications when content or budget diffs await sign-off" }
    ];

    container.innerHTML = `
      ${roleBannerHtml()}
      <div class="ello-row-between" style="margin-bottom:16px;">
        <div>
          <h2 style="margin:0; font-size:21px;">Real-Time Integrations (Composio Hub), Cloud Sync &amp; API Keys</h2>
          <p style="margin:4px 0 0; font-size:13px; color:#64748b;">Connect third-party tools per workspace via Composio OAuth Connect Links without exposing OAuth tokens in the browser.</p>
        </div>
        <button type="button" class="btn btn-secondary" id="refreshComposioBtn">Refresh Connected Accounts</button>
      </div>

      <div class="card" style="padding:18px; margin-bottom:18px;">
        <div class="ello-row-between" style="margin-bottom:10px;">
          <div>
            <h3 style="margin:0; font-size:15px;">Composio OAuth Connect Links for <strong>${escapeHtml(ws.name)}</strong></h3>
            <div style="font-size:12px; color:#64748b;">Tenant User ID: <code>${escapeHtml(ws.id)}</code> • Real-Time Webhook URL: <code>${escapeHtml(webhookUrl)}</code></div>
          </div>
          <span class="ello-pill ${serverConfig.composioConfigured ? "ello-pill-green" : "ello-pill-amber"}">
            ${serverConfig.composioConfigured ? "Composio Backend Active" : "Set COMPOSIO_API_KEY in Netlify"}
          </span>
        </div>
        <div id="composioStatusMsg" style="font-size:12.5px; color:#2563eb; margin-bottom:12px;"></div>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:12px;">
          ${toolkits.map((tk) => `
            <div style="border:1px solid #e2e8f0; border-radius:8px; padding:12px; background:#f8fafc; display:flex; flex-direction:column; justify-content:space-between; gap:10px;">
              <div>
                <div style="font-weight:700; font-size:13.5px; color:#0f172a;">${escapeHtml(tk.name)}</div>
                <div style="font-size:12px; color:#64748b; margin-top:3px;">${escapeHtml(tk.desc)}</div>
              </div>
              <button type="button" class="btn btn-primary" data-composio-connect="${escapeHtml(tk.slug)}" style="font-size:12px; padding:6px 10px;">
                Authorize ${escapeHtml(tk.name)}
              </button>
            </div>
          `).join("")}
        </div>
        ${state.composioConnections && state.composioConnections.length > 0 ? `
          <div style="margin-top:14px;">
            <strong style="font-size:12.5px;">Active Composio Connected Accounts:</strong>
            <ul style="margin:6px 0 0 18px; font-size:12.5px; color:#166534;">
              ${state.composioConnections.map((acc) => `<li>${escapeHtml(acc.appName || acc.toolkit?.slug || "Connected App")} — Status: <strong>${escapeHtml(acc.status || "ACTIVE")}</strong> (${escapeHtml(acc.id || "")})</li>`).join("")}
            </ul>
          </div>
        ` : ""}
      </div>

      ${role.canManageAdmin ? `
        <div class="card" style="padding:18px; margin-bottom:18px;">
          <h3 style="margin:0 0 6px; font-size:15px;">Optional Local Fallback API Keys (Never Included in Exported Backups)</h3>
          <p style="margin:0 0 12px; font-size:12.5px; color:#64748b;">For maximum security in production, set <code>GEMINI_API_KEY</code> and <code>PAGESPEED_API_KEY</code> inside Netlify Environment Variables instead of browser storage.</p>
          <form id="apiKeysForm" class="ello-grid-2" style="margin-bottom:0; align-items:end;">
            <div class="ello-field" style="margin-bottom:0;">
              <label>Google PageSpeed Insights API Key (optional)</label>
              <input class="ello-input" type="password" name="pagespeed" value="${escapeHtml((state.apiKeys && state.apiKeys.pagespeed) || "")}" placeholder="AIza..." />
            </div>
            <div class="ello-field" style="margin-bottom:0;">
              <label>Google Gemini API Key (optional local fallback)</label>
              <input class="ello-input" type="password" name="gemini" value="${escapeHtml((state.apiKeys && state.apiKeys.gemini) || "")}" placeholder="AIza..." />
            </div>
            <div><button type="submit" class="btn btn-primary">Save Local Keys</button></div>
          </form>
        </div>
      ` : ""}

      <div class="card" style="padding:18px;">
        <h3 style="margin:0 0 12px; font-size:15px;">Platform Architecture Status</h3>
        <table class="ello-table">
          <thead><tr><th>Layer</th><th>Capability</th><th>Security Model</th><th>Status</th></tr></thead>
          <tbody>
            ${state.integrations.map((i) => `
              <tr>
                <td><strong>${escapeHtml(i.name)}</strong></td>
                <td>${escapeHtml(i.category)}</td>
                <td>${escapeHtml(i.authType)}</td>
                <td><span class="ello-pill ello-pill-green">${escapeHtml(i.status)}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    const statusMsg = document.getElementById("composioStatusMsg");

    container.querySelectorAll("[data-composio-connect]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const toolkit = btn.getAttribute("data-composio-connect");
        btn.disabled = true;
        statusMsg.style.color = "#2563eb";
        statusMsg.textContent = `Creating Composio OAuth Connect Link for ${toolkit} (${ws.name})...`;
        try {
          const resp = await fetch("/api/composio-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId: ws.id,
              toolkit,
              callbackUrl: window.location.href
            })
          });
          const data = await resp.json();
          if (!resp.ok || !data.redirectUrl) {
            throw new Error(data.error || `HTTP ${resp.status}`);
          }
          logAudit("COMPOSIO_OAUTH_LINK_CREATED", `${toolkit} for ${ws.name}`);
          saveLocalState();
          window.open(data.redirectUrl, "_blank", "noopener,noreferrer");
          statusMsg.style.color = "#166534";
          statusMsg.textContent = `OAuth window opened for ${toolkit}. Complete authorization in the new tab, then click "Refresh Connected Accounts".`;
        } catch (err) {
          statusMsg.style.color = "#b91c1c";
          statusMsg.textContent = err.message;
        } finally {
          btn.disabled = false;
        }
      });
    });

    const refreshBtn = document.getElementById("refreshComposioBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        statusMsg.style.color = "#2563eb";
        statusMsg.textContent = "Fetching active Composio connected accounts...";
        try {
          const resp = await fetch(`/api/composio-link?workspaceId=${encodeURIComponent(ws.id)}`);
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
          state.composioConnections = data.items || [];
          saveLocalState();
          renderApp();
        } catch (err) {
          statusMsg.style.color = "#b91c1c";
          statusMsg.textContent = err.message;
        }
      });
    }

    const keysForm = document.getElementById("apiKeysForm");
    if (keysForm) {
      keysForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(keysForm);
        state.apiKeys.pagespeed = String(fd.get("pagespeed") || "").trim();
        state.apiKeys.gemini = String(fd.get("gemini") || "").trim();
        logAudit("API_KEYS_UPDATED", "Browser Local Storage (Sanitized on Export)");
        saveLocalState();
        renderApp();
      });
    }
  }

  function downloadJson(filename, dataObj) {
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderApp() {
    injectHelperStyles();
    renderTopControls();
    applyRoleNavigationVisibility();

    const container = document.getElementById("viewContainer");
    if (!container) return;

    switch (activeView) {
      case "overview": renderOverview(container); break;
      case "campaigns": renderCampaigns(container); break;
      case "content": renderContentStudio(container); break;
      case "calendar": renderCalendar(container); break;
      case "seo": renderSeoAudits(container); break;
      case "paid": renderPaidMedia(container); break;
      case "leads": renderLeads(container); break;
      case "competitors": renderCompetitors(container); break;
      case "approvals": renderApprovals(container); break;
      case "automations": renderAutomations(container); break;
      case "reports": renderReports(container); break;
      case "brand": renderBrandPolicy(container); break;
      case "clients": renderProjectsManager(container); break;
      case "integrations": renderIntegrations(container); break;
      default: renderOverview(container);
    }

    container.querySelectorAll("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-goto");
        if (currentRoleObj().allowedViews.includes(target)) {
          activeView = target;
          renderApp();
        }
      });
    });

    container.querySelectorAll("[data-action='open-add-project']").forEach((btn) => {
      btn.addEventListener("click", openAddProjectModal);
    });
  }

  function bindGlobalEvents() {
    const wsSelect = document.getElementById("workspaceSelect");
    if (wsSelect) {
      wsSelect.addEventListener("change", async () => {
        state.currentWorkspaceId = wsSelect.value;
        await syncFromSupabase();
        saveLocalState();
        renderApp();
      });
    }

    const roleSelect = document.getElementById("roleSelect");
    if (roleSelect) {
      roleSelect.addEventListener("change", () => {
        if (supabaseClient && currentUser) return;
        state.currentRole = roleSelect.value;
        saveLocalState();
        renderApp();
      });
    }

    document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.getAttribute("data-view");
        if (currentRoleObj().allowedViews.includes(view)) {
          activeView = view;
          renderApp();
        }
      });
    });

    // Sanitized Export Backup (automatically strips API keys)
    const exportBtn = document.getElementById("exportBackupBtn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const sanitized = deepClone(state);
        sanitized.apiKeys = { gemini: "", pagespeed: "" };
        downloadJson(`ellocent-marketing-os-backup-${nowTimestamp().slice(0, 10)}.json`, sanitized);
      });
    }

    // Import Backup (.json)
    const importBtn = document.getElementById("importBackupBtn");
    const importInput = document.getElementById("importBackupInput");
    if (importBtn && importInput) {
      importBtn.addEventListener("click", () => importInput.click());
      importInput.addEventListener("change", async () => {
        const file = importInput.files && importInput.files[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          const preservedKeys = deepClone(state.apiKeys || { gemini: "", pagespeed: "" });
          state = mergeWithSeed(parsed);
          state.apiKeys = preservedKeys;
          logAudit("BACKUP_JSON_IMPORTED", file.name);
          saveLocalState();
          renderApp();
        } catch (err) {
          alert("Invalid JSON backup file: " + err.message);
        } finally {
          importInput.value = "";
        }
      });
    }

    const resetBtn = document.getElementById("resetDemoBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (!currentRoleObj().canManageAdmin) return;
        localStorage.removeItem(STORAGE_KEY);
        state = mergeWithSeed(null);
        activeView = "overview";
        saveLocalState();
        renderApp();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initLocalState();
    bindGlobalEvents();
    renderApp();
    await initCloudBridge();
    renderApp();
  });
})();
