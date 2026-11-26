// POST /api/ai-draft — Server-side Google Gemini drafting with brand policy & budget guardrails
export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY is not configured in Netlify Environment Variables." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    const {
      topic = "",
      channel = "LinkedIn Article",
      brandProfile = {},
      aiSpentUsd = 0,
      aiBudgetUsd = 150
    } = body;

    if (Number(aiSpentUsd) >= Number(aiBudgetUsd)) {
      return new Response(
        JSON.stringify({ error: "Workspace monthly AI budget cap reached. Increase cap or reset cycle." }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }

    const bannedList = Array.isArray(brandProfile.bannedClaims) && brandProfile.bannedClaims.length
      ? brandProfile.bannedClaims.join(", ")
      : "None";

    const chLower = String(channel).toLowerCase();
    const requiredDisclaimer = chLower.includes("whatsapp")
      ? (brandProfile.requiredDisclaimers?.whatsapp || "")
      : chLower.includes("email")
      ? (brandProfile.requiredDisclaimers?.email || "")
      : (brandProfile.requiredDisclaimers?.paid || "");

    const prompt = [
      `You are an enterprise B2B marketing copywriter for ${brandProfile.brandName || "Ellocent Labs"}.`,
      `Channel: ${channel}`,
      `Topic / Brief: ${topic || "Enterprise digital transformation & governed AI engineering"}`,
      `Voice & Tone: ${brandProfile.voiceTone || "Authoritative, factual, pragmatic"}`,
      `Target Audience: ${brandProfile.targetAudience || "CTOs and Engineering Leaders"}`,
      `STRICT BANNED CLAIMS (DO NOT USE ANY OF THESE): ${bannedList}`,
      requiredDisclaimer ? `MANDATORY DISCLAIMER (INCLUDE VERBATIM AT THE END): ${requiredDisclaimer}` : "",
      `Return ONLY valid JSON with two keys: "title" (concise headline) and "body" (ready-to-publish copy).`
    ].filter(Boolean).join("\n");

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await geminiResp.json();
    if (!geminiResp.ok) {
      throw new Error(data?.error?.message || `Gemini HTTP ${geminiResp.status}`);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(rawText);

    return new Response(
      JSON.stringify({
        title: parsed.title || `${channel}: ${topic}`,
        body: parsed.body || "",
        estimatedCostUsd: 0.02
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "AI draft failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  path: "/api/ai-draft"
};
