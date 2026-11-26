// GET /api/config — Exposes ONLY public client configuration (never server secrets)
export default async (req) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  return new Response(
    JSON.stringify({
      supabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
      supabaseUrl,
      supabaseAnonKey,
      composioConfigured: Boolean(process.env.COMPOSIO_API_KEY),
      geminiServerConfigured: Boolean(process.env.GEMINI_API_KEY),
      pagespeedServerConfigured: Boolean(process.env.PAGESPEED_API_KEY)
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
};

export const config = {
  path: "/api/config"
};
