const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const isAccessGateConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const SESSION_KEY = "car_sales_invite_session";

const rpc = async (name, payload) => {
  if (!isAccessGateConfigured) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.hint || "请求失败，请稍后再试";
    throw new Error(message);
  }

  return data;
};

export const getSavedInviteSession = () => {
  if (!isAccessGateConfigured) return null;
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
};

export const saveInviteSession = (session) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const clearInviteSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

export const claimInvite = async ({ code, visitorName, visitorCompany }) => {
  const result = await rpc("claim_invite", {
    input_code: code.trim(),
    visitor_name: visitorName.trim() || null,
    visitor_company: visitorCompany.trim() || null,
    page_url: window.location.href,
    user_agent: navigator.userAgent,
  });

  return Array.isArray(result) ? result[0] : result;
};

export const createInviteCode = async ({
  adminSecret,
  ownerName,
  company,
  expiresAt,
  customCode,
  notes,
}) => {
  const result = await rpc("admin_create_invite", {
    admin_secret: adminSecret.trim(),
    owner_name: ownerName.trim(),
    company: company.trim() || null,
    expires_at: expiresAt || null,
    max_uses: 1,
    custom_code: customCode.trim() || null,
    label: ownerName.trim() ? `${ownerName.trim()}专属邀请码` : "专属邀请码",
    notes: notes.trim() || "管理员页面生成",
  });

  return Array.isArray(result) ? result[0] : result;
};

export const trackVisitEvent = async (sessionToken, eventType, payload = {}) => {
  if (!isAccessGateConfigured || !sessionToken) return null;

  try {
    return await rpc("log_visit_event", {
      session_token: sessionToken,
      event_type: eventType,
      page_url: window.location.href,
      user_agent: navigator.userAgent,
      event_payload: payload,
    });
  } catch (error) {
    console.warn("[visit-log]", error.message);
    return null;
  }
};
