// POST /api/composio-hook — HMAC-Verified, Idempotent Real-Time Webhook & Composio Trigger Receiver
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function verifyHmac(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const cleanSig = signatureHeader.replace(/^sha256=/i, "").trim();
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(cleanSig, "hex"), Buffer.from(digest, "hex"));
  } catch {
    return false;
  }
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const composioSig = req.headers.get("x-composio-signature") || req.headers.get("webhook-signature") || "";
  const directSig = req.headers.get("x-ellocent-signature") || "";

  const validComposio = verifyHmac(rawBody, composioSig, process.env.COMPOSIO_WEBHOOK_SECRET || "");
  const validDirect = verifyHmac(rawBody, directSig, process.env.WEBHOOK_SIGNING_SECRET || "");

  if (!validComposio && !validDirect) {
    return new Response(JSON.stringify({ error: "Unauthorized webhook signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Supabase service credentials missing" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const event = JSON.parse(rawBody);
    // Support both Composio Trigger envelopes and direct website form webhooks
    const workspaceId =
      event?.metadata?.userId ||
      event?.user_id ||
      event?.workspace_id ||
      "ws_ellocent";

    const triggerSlug = event?.triggerSlug || event?.event_type || "DIRECT_LEAD_WEBHOOK";
    const data = event?.payload || event;
    const externalEventId =
      event?.metadata?.logId ||
      event?.event_id ||
      `evt_${crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 24)}`;

    const email = String(data.email || data.properties?.email || "").trim();
    const name = String(
      data.name ||
      [data.firstname || data.properties?.firstname, data.lastname || data.properties?.lastname].filter(Boolean).join(" ") ||
      "Inbound Lead"
    ).trim();
    const company = String(data.company || data.properties?.company || "").trim();
    const consentSource = String(data.consent_source || `Composio Trigger: ${triggerSlug}`).trim();

    if (email) {
      await supabase.from("leads").upsert(
        {
          id: `lead_${externalEventId.slice(0, 18)}`,
          workspace_id: workspaceId,
          name,
          company,
          email,
          stage: "New",
          email_opt_in: data.email_opt_in !== undefined ? Boolean(data.email_opt_in) : true,
          whatsapp_opt_in: Boolean(data.whatsapp_opt_in),
          suppressed: false,
          consent_source: consentSource,
          external_event_id: externalEventId
        },
        { onConflict: "external_event_id" }
      );
    }

    await supabase.from("audit_events").insert({
      id: `evt_${Date.now().toString(36)}`,
      workspace_id: workspaceId,
      actor: "Webhook / Composio",
      action: "REALTIME_TRIGGER_INGESTED",
      target: `${triggerSlug}${email ? ` (${email})` : ""}`,
      correlation_id: externalEventId
    });

    return new Response(JSON.stringify({ ok: true, externalEventId }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Webhook processing failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = {
  path: "/api/composio-hook"
};
