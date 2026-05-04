const buildCorsHeaders = (request, env) => {
  const origin = request.headers.get("Origin") || "";
  const allowList = (env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  let allowOrigin = "*";
  if (allowList.length && allowList[0] !== "*") {
    allowOrigin = allowList.includes(origin) ? origin : allowList[0];
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
};

const jsonResponse = (payload, status, corsHeaders) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: "OPENAI_API_KEY is not configured." }, 500, corsHeaders);
    }

    const url = new URL(request.url);
    const upstreamUrl = `https://api.openai.com${url.pathname}${url.search}`;

    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: await request.text(),
    });

    const body = await response.arrayBuffer();
    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", response.headers.get("Content-Type") || "application/json");

    return new Response(body, {
      status: response.status,
      headers,
    });
  },
};
