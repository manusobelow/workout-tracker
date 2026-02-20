/* =========================================================
   FILE: src/api.ts
   FULL FILE REPLACEMENT

   - Avoids CORS preflight (Content-Type: text/plain)
   - Adds Workout Builder actions:
     - createSessionWithExercises
     - replaceSessionExercises
     - deleteSession
   ========================================================= */

export type ApiResult<T = any> =
  | ({ success: true } & T)
  | { success: false; error: string };

const BASE_URL = String(import.meta.env.VITE_GOOGLE_SCRIPT_URL || "").trim();
const API_KEY = String(import.meta.env.VITE_API_KEY || "").trim();
const ROUTINE_ID = String(import.meta.env.VITE_ROUTINE_ID || "").trim();

function assertConfigured() {
  if (!BASE_URL) throw new Error("Missing VITE_GOOGLE_SCRIPT_URL in .env");
  if (!ROUTINE_ID) throw new Error("Missing VITE_ROUTINE_ID in .env");
}

function qs(params: Record<string, any>) {
  const u = new URLSearchParams();
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (v === undefined || v === null) return;
    u.set(k, String(v));
  });
  return u.toString();
}

function withActionUrl(action: string, extra: Record<string, any> = {}) {
  const query = qs({
    action,
    apiKey: API_KEY || undefined,
    ...extra,
    _t: Date.now(),
  });
  return `${BASE_URL}${BASE_URL.includes("?") ? "&" : "?"}${query}`;
}

async function safeFetchJson(url: string, init?: RequestInit): Promise<any> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();

    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const msg =
        (data && (data.error || data.message)) ||
        `HTTP ${res.status} ${res.statusText}` ||
        "Request failed";
      return { success: false, error: msg };
    }

    return data ?? { success: false, error: "Empty response" };
  } catch (e: any) {
    return { success: false, error: String(e?.message || e) };
  }
}

/**
 * IMPORTANT:
 * - Content-Type: application/json triggers CORS preflight (OPTIONS) which GAS web apps do NOT handle.
 * - Use text/plain to keep it a "simple request" → no preflight → no NetworkError.
 */
async function postToGas(action: string, body: any): Promise<any> {
  const url = withActionUrl(action);
  const payload = JSON.stringify({ action, ...body });

  return safeFetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: payload,
  });
}

/* =========================================================
   PUBLIC API
   ========================================================= */

export async function authTest(): Promise<ApiResult<{ userId: string }>> {
  assertConfigured();
  const url = withActionUrl("authTest");
  return safeFetchJson(url, { method: "GET" });
}

export async function fetchBootstrap(routineId?: string): Promise<ApiResult<any>> {
  assertConfigured();
  const rid = String(routineId || ROUTINE_ID || "").trim();
  const url = withActionUrl("bootstrap", { routineId: rid });
  return safeFetchJson(url, { method: "GET" });
}

export async function postLogSet(input: {
  userId?: string;
  date: string;
  routineId: string;
  sessionId: string;
  sessionName: string;
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  prescribedReps?: string;
  prescribedWeight?: string;
  actualReps?: string;
  actualWeight?: string;
}): Promise<ApiResult> {
  assertConfigured();
  return postToGas("logSet", input);
}

export async function postUpdateOneRM(input: {
  userId?: string;
  exerciseId: string;
  oneRM: number;
  unit: string;
}): Promise<ApiResult> {
  assertConfigured();
  return postToGas("updateOneRM", input);
}

/* =========================================================
   ✅ WORKOUT BUILDER API
   ========================================================= */

export type BuilderExerciseRow = {
  Order: number;
  Block: string;
  ExerciseID: string;
  SchemeID: string;
  Notes?: string;
  SupersetID?: string;
  SessionName?: string;
};

export async function postCreateSessionWithExercises(input: {
  routineId: string;
  sessionId: string;
  sessionName: string;
  notes?: string; // e.g. "BUILDER|BIAS=Upper"
  exercises: BuilderExerciseRow[];
}): Promise<ApiResult> {
  assertConfigured();
  return postToGas("createSessionWithExercises", input);
}

export async function postReplaceSessionExercises(input: {
  routineId: string;
  sessionId: string;
  sessionName?: string;
  notes?: string;
  exercises: BuilderExerciseRow[];
}): Promise<ApiResult> {
  assertConfigured();
  return postToGas("replaceSessionExercises", input);
}

export async function postDeleteSession(input: {
  routineId: string;
  sessionId: string;
}): Promise<ApiResult> {
  assertConfigured();
  return postToGas("deleteSession", input);
}