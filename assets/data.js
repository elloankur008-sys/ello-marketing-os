// Ellocent Marketing OS — Full-Stack Multi-Project Baseline (v2.0.0)
window.ELLOCENT_SEED_DATA = {
  "version": "2.0.0-fullstack",
  "currentWorkspaceId": "ws_ellocent",
  "currentRole": "Platform Admin",
  "apiKeys": {
    "gemini": "",
    "pagespeed": ""
  },
  "roles": {
    "Platform Admin": {
      "label": "Platform Admin",
      "tier": "Internal",
      "description": "Full multi-project governance, approvals, budget sign-off, brand rules, and API/Composio configuration.",
      "allowedViews": [
        "overview",
        "campaigns",
        "content",
        "calendar",
        "seo",
        "paid",
        "leads",
        "competitors",
        "approvals",
        "automations",
        "reports",
        "brand",
        "clients",
        "integrations"
      ],
      "canApprove": true,
      "canEditContent": true,
      "canRunSeo": true,
      "canProposePaidDiff": true,
      "canApproveBudget": true,
      "canSendMessaging": true,
      "canManageBrand": true,
      "canManageProjects": true,
      "canExportReports": true,
      "canManageAdmin": true
    },
    "Marketing Manager": {
      "label": "Marketing Manager",
      "tier": "Internal",
      "description": "Manages campaigns, approvals, content, leads, and projects; API keys restricted to Admin.",
      "allowedViews": [
        "overview",
        "campaigns",
        "content",
        "calendar",
        "seo",
        "paid",
        "leads",
        "competitors",
        "approvals",
        "automations",
        "reports",
        "brand",
        "clients"
      ],
      "canApprove": true,
      "canEditContent": true,
      "canRunSeo": true,
      "canProposePaidDiff": true,
      "canApproveBudget": true,
      "canSendMessaging": true,
      "canManageBrand": true,
      "canManageProjects": true,
      "canExportReports": true,
      "canManageAdmin": false
    },
    "SEO Specialist": {
      "label": "SEO Specialist",
      "tier": "Internal",
      "description": "Runs live website/SEO audits, competitor SERP tracking, and SEO content drafts.",
      "allowedViews": [
        "overview",
        "seo",
        "content",
        "calendar",
        "competitors",
        "reports"
      ],
      "canApprove": false,
      "canEditContent": true,
      "canRunSeo": true,
      "canProposePaidDiff": false,
      "canApproveBudget": false,
      "canSendMessaging": false,
      "canManageBrand": false,
      "canManageProjects": false,
      "canExportReports": true,
      "canManageAdmin": false
    },
    "Content Specialist": {
      "label": "Content Specialist",
      "tier": "Internal",
      "description": "Drafts channel copy and schedules calendar assets; cannot self-approve or alter budgets.",
      "allowedViews": [
        "overview",
        "content",
        "calendar",
        "brand"
      ],
      "canApprove": false,
      "canEditContent": true,
      "canRunSeo": false,
      "canProposePaidDiff": false,
      "canApproveBudget": false,
      "canSendMessaging": false,
      "canManageBrand": false,
      "canManageProjects": false,
      "canExportReports": false,
      "canManageAdmin": false
    },
    "Paid Media Specialist": {
      "label": "Paid Media Specialist",
      "tier": "Internal",
      "description": "Tracks ad campaigns and submits budget diff proposals for approval.",
      "allowedViews": [
        "overview",
        "campaigns",
        "paid",
        "competitors",
        "reports"
      ],
      "canApprove": false,
      "canEditContent": false,
      "canRunSeo": false,
      "canProposePaidDiff": true,
      "canApproveBudget": false,
      "canSendMessaging": false,
      "canManageBrand": false,
      "canManageProjects": false,
      "canExportReports": true,
      "canManageAdmin": false
    },
    "Sales Lead Owner": {
      "label": "Sales Lead Owner",
      "tier": "Internal",
      "description": "Manages CRM leads, pipeline stages, and consent-verified outreach.",
      "allowedViews": [
        "overview",
        "leads",
        "reports"
      ],
      "canApprove": false,
      "canEditContent": false,
      "canRunSeo": false,
      "canProposePaidDiff": false,
      "canApproveBudget": false,
      "canSendMessaging": true,
      "canManageBrand": false,
      "canManageProjects": false,
      "canExportReports": true,
      "canManageAdmin": false
    },
    "Client Reviewer": {
      "label": "Client Reviewer",
      "tier": "Client",
      "description": "Reviews and signs off on content drafts and campaign approvals; read-only elsewhere.",
      "allowedViews": [
        "overview",
        "content",
        "calendar",
        "approvals",
        "reports"
      ],
      "canApprove": true,
      "canEditContent": false,
      "canRunSeo": false,
      "canProposePaidDiff": false,
      "canApproveBudget": false,
      "canSendMessaging": false,
      "canManageBrand": false,
      "canManageProjects": false,
      "canExportReports": true,
      "canManageAdmin": false
    },
    "Client Admin": {
      "label": "Client Admin",
      "tier": "Client",
      "description": "Approves content and budget diffs, manages brand rules, and reviews project reports.",
      "allowedViews": [
        "overview",
        "campaigns",
        "content",
        "calendar",
        "approvals",
        "brand",
        "reports"
      ],
      "canApprove": true,
      "canEditContent": true,
      "canRunSeo": false,
      "canProposePaidDiff": false,
      "canApproveBudget": true,
      "canSendMessaging": false,
      "canManageBrand": true,
      "canManageProjects": false,
      "canExportReports": true,
      "canManageAdmin": false
    },
    "Executive Readonly": {
      "label": "Executive Readonly",
      "tier": "Client",
      "description": "Read-only executive visibility into KPIs, calendar, and exported reports.",
      "allowedViews": [
        "overview",
        "calendar",
        "reports"
      ],
      "canApprove": false,
      "canEditContent": false,
      "canRunSeo": false,
      "canProposePaidDiff": false,
      "canApproveBudget": false,
      "canSendMessaging": false,
      "canManageBrand": false,
      "canManageProjects": false,
      "canExportReports": true,
      "canManageAdmin": false
    }
  },
  "workspaces": [
    {
      "id": "ws_ellocent",
      "name": "Ellocent Labs — Internal",
      "domain": "ellocentlabs.com",
      "currency": "USD",
      "timezone": "Asia/Kolkata",
      "retainerStatus": "Active — Internal Ops",
      "monthlyRetainer": 0,
      "aiSpentUsd": 0.0,
      "aiBudgetUsd": 150.0
    }
  ],
  "brandProfiles": {
    "ws_ellocent": {
      "workspaceId": "ws_ellocent",
      "version": "v1.0",
      "brandName": "Ellocent Labs IT Solutions",
      "tagline": "Governed AI, Cloud & Enterprise Product Engineering",
      "voiceTone": "Authoritative, pragmatic, outcome-driven, zero hype",
      "targetAudience": "CTOs, VP Engineering, Digital Transformation Heads",
      "bannedClaims": [
        "100% guaranteed ROI",
        "zero-bug software",
        "instant overnight ranking"
      ],
      "requiredDisclaimers": {
        "email": "Sent by Ellocent Labs IT Solutions. Reply STOP to opt out.",
        "whatsapp": "Ellocent Labs: Reply STOP anytime to unsubscribe.",
        "paid": ""
      }
    }
  },
  "campaigns": [],
  "contentAssets": [],
  "seoAudits": [],
  "paidMedia": {
    "campaigns": [],
    "budgetDiffs": []
  },
  "leads": [],
  "automations": [],
  "automationRuns": [],
  "competitors": [],
  "composioConnections": [],
  "integrations": [
    {
      "id": "int_composio",
      "name": "Composio Real-Time Integration Hub",
      "category": "OAuth Connect Links & Live Triggers (HubSpot, GSC, GA4, Ads)",
      "status": "Server-Ready (/api/composio-link)",
      "authType": "Server COMPOSIO_API_KEY + HMAC Triggers",
      "rateLimit": "Real-Time Webhooks + Hourly Sync"
    },
    {
      "id": "int_supabase",
      "name": "Supabase PostgreSQL + Realtime + RLS",
      "category": "Multi-User Tenant Database & Auth",
      "status": "Hybrid Cloud/Local Ready",
      "authType": "JWT + Row-Level Security",
      "rateLimit": "Live WebSocket Sync"
    },
    {
      "id": "int_psi",
      "name": "Google PageSpeed Insights / Lighthouse",
      "category": "Live Website & SEO Diagnostics (Mobile + Desktop)",
      "status": "Ready (HTTPS Live)",
      "authType": "Public HTTPS (Optional API Key)",
      "rateLimit": "Live On-Demand"
    },
    {
      "id": "int_gemini",
      "name": "Google Gemini AI Copywriter",
      "category": "Policy-Safe Drafting & Brand Lint",
      "status": "Ready (/api/ai-draft or Local Key)",
      "authType": "Server Env Key or Local Key",
      "rateLimit": "Capped by Workspace AI Limit"
    }
  ],
  "auditEvents": [
    {
      "id": "evt_init",
      "workspaceId": "ws_ellocent",
      "timestamp": "2026-11-18 09:22:00",
      "actor": "System",
      "action": "FULLSTACK_V2_INITIALIZED",
      "target": "Ellocent Labs — Internal (Phase 1+2+3 Ready)",
      "correlationId": "corr-init-v200"
    }
  ]
};
