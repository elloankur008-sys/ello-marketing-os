// GET & POST /api/composio-link — Per-Workspace Composio OAuth Connect Links & Account Status
const COMPOSIO_BASE = "https://backend.composio.dev/api/v3.1";

function parseAuthConfigs() {
  const raw = process.env.COMPOSIO_AUTH_CONFIGS || "";
  const map = {};
  raw.split(",").forEach((pair) => {
    const [slug, id] = pair.split(":").map((s) => (s || "").trim());
    if (slug && id) map[slug.toLowerCase()] = id;
  });
  return map;
}

function extractErrorMessage(data, status) {
  if (!data) return `Composio HTTP ${status}`;
  if (typeof data.message === "string") return data.message;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error.message === "string") return data.error.message;
  if (typeof data.detail === "string") return data.detail;
  return JSON.stringify(data.error || data);
}

export default async (req) => {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        configured: false,
        error: "COMPOSIO_API_KEY is not set in Netlify Environment Variables."
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const headers = {
    "x-api-key": apiKey,
    "Content-Type": "application/json"
  };

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const workspaceId = url.searchParams.get("workspaceId") || "";
      if (!workspaceId) {
        return new Response(JSON.stringify({ error: "workspaceId required" }), { status: 400 });
      }
      const resp = await fetch(
        `${COMPOSIO_BASE}/connected_accounts?user_ids=${encodeURIComponent(workspaceId)}`,
        { headers }
      );
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(extractErrorMessage(data, resp.status));
      }
      return new Response(
        JSON.stringify({
          configured: true,
          items: data.items || [],
          authConfigs: Object.keys(parseAuthConfigs())
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { workspaceId, toolkit, callbackUrl } = body;
      if (!workspaceId || !toolkit) {
        return new Response(JSON.stringify({ error: "workspaceId and toolkit are required" }), { status: 400 });
      }

      const authConfigs = parseAuthConfigs();
      const authConfigId = authConfigs[String(toolkit).toLowerCase()];
      if (!authConfigId) {
        return new Response(
          JSON.stringify({
            error: `No Auth Config ID mapped for '${toolkit}'. Add ${toolkit}:ac_your_id to COMPOSIO_AUTH_CONFIGS in Netlify.`
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const linkResp = await fetch(`${COMPOSIO_BASE}/connected_accounts/link`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          auth_config_id: authConfigId,
          user_id: workspaceId,
          callback_url: callbackUrl || process.env.URL || ""
        })
      });
      const linkData = await linkResp.json();
      if (!linkResp.ok) {
        throw new Error(extractErrorMessage(linkData, linkResp.status));
      }

      return new Response(
        JSON.stringify({
          redirectUrl: linkData.redirect_url,
          connectedAccountId: linkData.connected_account_id
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Composio link request failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  path: "/api/composio-link"
};
