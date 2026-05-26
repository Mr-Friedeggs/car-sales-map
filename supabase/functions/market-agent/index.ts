import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createMarketDataClient, DEFAULT_MINIMAX_MODEL, runMarketAgent } from "../_shared/market-agent-core.js";

const corsHeaders = (request: Request) => ({
  "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
});

const jsonResponse = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) {
    const error = new Error(`${name} is not configured`);
    (error as Error & { status?: number }).status = 500;
    throw error;
  }
  return value;
};

const serviceKey = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? requiredEnv("SUPABASE_ANON_KEY");

const supabaseFetch = async (path: string, init: RequestInit = {}) => {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const key = serviceKey();
  return fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
};

const assertSessionToken = (value: unknown) => {
  const token = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    const error = new Error("访问会话无效");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  return token;
};

const getInviteSession = async (sessionToken: string) => {
  const response = await supabaseFetch(
    `/rest/v1/invite_sessions?id=eq.${encodeURIComponent(sessionToken)}&select=id,invite_code_id&limit=1`,
  );
  if (!response.ok) {
    const error = new Error("无法校验访问会话");
    (error as Error & { status?: number }).status = 500;
    throw error;
  }
  const rows = await response.json();
  const session = Array.isArray(rows) ? rows[0] : null;
  if (!session?.id) {
    const error = new Error("访问会话无效或已失效");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  return session as { id: string; invite_code_id: string };
};

const enforceRateLimit = async (sessionId: string) => {
  const max = Number.parseInt(Deno.env.get("AGENT_MAX_REQUESTS_PER_HOUR") ?? "20", 10);
  if (!Number.isFinite(max) || max <= 0) return;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const query =
    `/rest/v1/visit_logs?invite_session_id=eq.${encodeURIComponent(sessionId)}` +
    `&event_type=in.(agent_analysis_completed,agent_analysis_failed)` +
    `&created_at=gte.${encodeURIComponent(since)}` +
    `&select=id&limit=${max}`;
  const response = await supabaseFetch(query);
  if (!response.ok) return;
  const rows = await response.json();
  if (Array.isArray(rows) && rows.length >= max) {
    const error = new Error("Agent 分析次数已达到每小时上限，请稍后再试");
    (error as Error & { status?: number }).status = 429;
    throw error;
  }
};

const logVisitEvent = async (sessionToken: string, eventType: string, payload: Record<string, unknown>) => {
  try {
    await supabaseFetch("/rest/v1/rpc/log_visit_event", {
      method: "POST",
      body: JSON.stringify({
        session_token: sessionToken,
        event_type: eventType,
        page_url: null,
        user_agent: "supabase-edge-function/market-agent",
        event_payload: payload,
      }),
    });
  } catch (error) {
    console.warn("[market-agent log]", error);
  }
};

const callMiniMax = async ({ messages, tools, tool_choice }: Record<string, unknown>) => {
  const baseUrl = (Deno.env.get("MINIMAX_BASE_URL") ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
  const apiKey = requiredEnv("MINIMAX_API_KEY");
  const model = Deno.env.get("MINIMAX_MODEL") ?? DEFAULT_MINIMAX_MODEL;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice,
      temperature: 0.2,
      max_tokens: 2400,
    }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.error?.message || data?.message || "MiniMax 调用失败";
    const error = new Error(message);
    (error as Error & { status?: number }).status = response.status >= 500 ? 502 : 500;
    throw error;
  }

  const modelMessage = data?.choices?.[0]?.message;
  if (!modelMessage) {
    throw new Error("MiniMax 未返回有效消息");
  }
  return {
    message: modelMessage,
    usage: data?.usage ?? {},
  };
};

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { message: "Method not allowed" }, 405);
  }

  const startedAt = Date.now();
  let sessionToken = "";

  try {
    const body = await request.json();
    sessionToken = assertSessionToken(body?.sessionToken);
    const question = String(body?.question ?? "").trim();
    if (!question) {
      return jsonResponse(request, { message: "请输入业务问题" }, 400);
    }

    const session = await getInviteSession(sessionToken);
    await enforceRateLimit(session.id);

    const dataClient = createMarketDataClient({
      baseUrl: requiredEnv("MARKET_DATA_BASE_URL"),
      fetchImpl: fetch,
    });

    const result = await runMarketAgent({
      question,
      context: body?.context ?? {},
      dataClient,
      callModel: callMiniMax,
    });
    const latencyMs = Date.now() - startedAt;
    const payload = { ...result, latencyMs };

    await logVisitEvent(sessionToken, "agent_analysis_completed", {
      question: question.slice(0, 500),
      tools: result.analysisPath.map((item: { tool: string }) => item.tool),
      evidence_sources: result.evidence.map((item: { source: string }) => item.source),
      usage: result.usage,
      latency_ms: latencyMs,
    });

    return jsonResponse(request, payload);
  } catch (error) {
    const err = error as Error & { status?: number };
    const status = err.status ?? 500;
    if (sessionToken && status !== 401) {
      await logVisitEvent(sessionToken, "agent_analysis_failed", {
        message: err.message,
        latency_ms: Date.now() - startedAt,
      });
    }
    return jsonResponse(request, { message: err.message || "Agent 分析失败" }, status);
  }
});
