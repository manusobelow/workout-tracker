/* =========================================================
   FILE: src/App.tsx
   FULL FILE REPLACEMENT ✅

   Adds Workout Builder / Generator:
   - Deterministic (no randomness)
   - Upper / Lower / Full Body bias
   - Coverage enforcement
   - Swap (Strict/Free)
   - Finish -> writes to Routine_Sessions + Routine_Exercises
   - Delete session (for GEN_ sessions)
   - Re-customize (Edit in Builder for GEN_ sessions)

   Keeps existing:
   - Muscle Balance
   - Exercise Library
   - Session + Exercise logging
   ========================================================= */

import { useEffect, useMemo, useState } from "react";
import "./App.css";
import type { BootstrapResponse, RoutineExercise, RoutineSession } from "./types";
import {
  authTest,
  fetchBootstrap,
  postLogSet,
  postUpdateOneRM,
  postCreateSessionWithExercises,
  postReplaceSessionExercises,
  postDeleteSession,
  type BuilderExerciseRow,
} from "./api";
import { buildIndexes, fmtWeight, isMajor, sortedSessionExercises, toNumber } from "./logic";
import MuscleMap from "./components/MuscleMap";

/* =========================================================
   ## TYPES ##
   ========================================================= */
// ==============================
// FILE: src/App.tsx
// SECTION: VIEW TYPES (REPLACE ALL)
// ==============================
// START VIEW TYPES REPLACEMENT

type View = "sessions" | "muscle_balance" | "library" | "builder" | "session" | "exercise";

type ExerciseBackTarget = "session" | "muscle_balance" | "library" | "builder";

type LibraryFacetKey = "MovementPattern" | "PlaneOfMotion" | "PrimaryMuscle" | "SecondaryMuscle";
type LibraryStep = "facet" | "value" | "exercise";

// Workout Builder
type BuilderBias = "Upper" | "Lower" | "Full Body";
type BuilderMode = "create" | "edit"; // edit = recustomize existing GEN_ session

type BuilderDraftItem = {
  ExerciseID: string;
  Name: string;
  Category: string;
  MovementPattern: string;
  PlaneOfMotion: string;
  PrimaryMuscle: string;
  SecondaryMuscle: string;
  LogMode: string;
  SchemeID: string;
  Notes: string;
};

function normalizeView(v: any): View {
  if (
    v === "sessions" ||
    v === "muscle_balance" ||
    v === "library" ||
    v === "builder" ||
    v === "session" ||
    v === "exercise"
  )
    return v;
  return "sessions";
}

// END VIEW TYPES REPLACEMENT

/* =========================================================
   ## DATE HELPERS ##
   ========================================================= */
function todayLocalISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowSessionStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

/* =========================================================
   ## LOCAL KEYS (DONE / LOG INPUTS) ##
   ========================================================= */
function keyDone(date: string, sessionId: string, exId: string) {
  return `${date}|${sessionId}|${exId}`;
}
function keyLog(date: string, sessionId: string, exId: string, setIndex: number) {
  return `${date}|${sessionId}|${exId}|${setIndex}`;
}

/* =========================================================
   ## BLOCK → CSS CLASS ##
   ========================================================= */
function normalizeBlock(block?: string) {
  const b = String(block || "").toLowerCase();
  if (b === "warmup") return "warmup";
  if (b === "main") return "main";
  if (b === "accessory") return "accessory";
  if (b === "core") return "core";
  if (b === "conditioning") return "conditioning";
  return "";
}
function blockToBubbleClass(block?: string) {
  const b = normalizeBlock(block);
  return b ? `bubble--${b}` : "";
}

/* =========================================================
   ## GIF URL NORMALIZATION (KEEP THIS) ##
   ========================================================= */
function extractDriveFileId(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";

  const m1 = s.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (m1 && m1[1]) return m1[1];

  const m2 = s.match(/[?&]id=([^&]+)/i);
  if (m2 && m2[1]) return m2[1];

  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;

  return "";
}

function normalizeGifUrl(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";

  if (s.includes("lh3.googleusercontent.com/")) return s;
  if (s.startsWith("https://drive.google.com/uc?")) return s;

  const id = extractDriveFileId(s);
  if (id) return `https://drive.google.com/uc?export=view&id=${id}`;

  return s;
}

function driveThumbUrl(raw: string): string {
  const id = extractDriveFileId(raw);
  if (!id) return "";
  return `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
}

function buildGifCandidates(raw: string): string[] {
  const r = String(raw || "").trim();
  if (!r) return [];

  const out: string[] = [];
  const primary = normalizeGifUrl(r);
  if (primary) out.push(primary);

  const thumb = driveThumbUrl(r);
  if (thumb && !out.includes(thumb)) out.push(thumb);

  if (!out.includes(r)) out.push(r);

  return Array.from(new Set(out.map((x) => String(x || "").trim()).filter(Boolean)));
}
/* ======================= END GIF SECTION ======================= */

/* =========================================================
   ## MUSCLE HELPERS ##
   ========================================================= */
function normMuscleName(v: any): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normStr(v: any): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isWarmUpCategory(libRow: any): boolean {
  const cat = String(libRow?.Category || "").trim().toLowerCase();
  return cat === "warmup";
}
function isExcludedFromBuilder(libRow: any): boolean {
  const cat = normStr(libRow?.Category);
  if (cat === "warmup") return true;
  if (cat === "mobility") return true;
  return false;
}

/**
 * Timestamp stored in sheet as:
 * "yyyy-MM-dd h:mm a"
 */
function extractDateKeyFromTimestamp(ts: any): string {
  const s = String(ts || "").trim();
  if (!s) return "";

  const maybe = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(maybe)) return maybe;

  return "";
}
function parseYYYYMMDD(dateKey: string): number {
  const s = String(dateKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 0;
  return Number(s.replaceAll("-", ""));
}

/* =========================================================
   ## COLOR SCALE (6 STAGES)
   ========================================================= */
function colorForSets(sets: number): string {
  const v = Number(sets || 0);
  if (v <= 0) return "#6B7280";
  if (v < 4) return "#3B82F6";
  if (v < 10) return "#14B8A6";
  if (v < 16) return "#22C55E";
  if (v <= 20) return "#F59E0B";
  return "#EF4444";
}

/* =========================================================
   ## BUILDER: CANONICAL MUSCLE LISTS ##
   ========================================================= */
const BIAS_LOWER = [
  "Quads",
  "Hamstrings",
  "Glutes Max",
  "Glute Med",
  "Adductors",
  "Calves",
  "Tibialis Anterior",
  "Hip Flexors",
];

const BIAS_UPPER = [
  "Chest",
  "Lats",
  "Upper Back",
  "Upper Traps",
  "Mid Traps",
  "Lower Traps",
  "Rhomboids",
  "Front Delts",
  "Side Delts",
  "Rear Delts",
  "Rotator Cuff",
  "Serratus",
  "Biceps",
  "Triceps",
  "Forearms",
  "Neck",
];

const BIAS_CORE = ["Abs", "Obliques", "Transverse Abdominis", "Spinal Erectors", "Quadratus Lumborum"];

function biasSet(b: BuilderBias): Set<string> {
  if (b === "Upper") return new Set([...BIAS_UPPER].map(normMuscleName));
  if (b === "Lower") return new Set([...BIAS_LOWER].map(normMuscleName));
  // Full Body: neutral, we still enforce coverage
  return new Set<string>();
}

function isBuilderSessionId(sessionId: string) {
  return String(sessionId || "").trim().toUpperCase().startsWith("GEN_");
}

/* =========================================================
   ## APP ##
   ========================================================= */
export default function App() {
  /* =========================================================
     ## STATE ##
     ========================================================= */
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [bootErr, setBootErr] = useState<string>("");

  const [view, setView] = useState<View>("sessions");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [selectedExerciseIndex, setSelectedExerciseIndex] = useState<number>(0);
  const [workoutDate, setWorkoutDate] = useState<string>(todayLocalISO());

  const [doneMap, setDoneMap] = useState<Record<string, boolean>>({});

  const [logInputs, setLogInputs] = useState<
    Record<string, { reps: string; weight: string; saving?: boolean; error?: string; saved?: boolean }>
  >({});

  const [userId, setUserId] = useState<string>("");
  const [authErr, setAuthErr] = useState<string>("");

  const [oneRMInput, setOneRMInput] = useState<string>("");
  const [oneRMSaving, setOneRMSaving] = useState<boolean>(false);
  const [oneRMError, setOneRMError] = useState<string>("");
  const [oneRMSaved, setOneRMSaved] = useState<boolean>(false);
  const [oneRMEstWeight, setOneRMEstWeight] = useState<string>("");
  const [oneRMEstReps, setOneRMEstReps] = useState<string>("");

  const [gifTryIndex, setGifTryIndex] = useState<number>(0);

  // Muscle Balance: which muscle is currently expanded
  const [mbSelectedMuscle, setMbSelectedMuscle] = useState<string>("");

  // ✅ Exercise Library browsing state
  const [libStep, setLibStep] = useState<LibraryStep>("facet");
  const [libFacet, setLibFacet] = useState<LibraryFacetKey>("PrimaryMuscle");
  const [libFacetValue, setLibFacetValue] = useState<string>("");
  const [libExerciseIds, setLibExerciseIds] = useState<string[]>([]);
  const [libExerciseIndex, setLibExerciseIndex] = useState<number>(0);

  // Current exercise id (always set when opening exercise view)
  const [activeExerciseId, setActiveExerciseId] = useState<string>("");

  const [exerciseBackTarget, setExerciseBackTarget] = useState<ExerciseBackTarget>("session");

  // =========================
  // ✅ BUILDER STATE (HOOK-SAFE)
  // =========================
  const [builderBias, setBuilderBias] = useState<BuilderBias>("Upper");
  const [builderMode, setBuilderMode] = useState<BuilderMode>("create");
  const [builderEditingSessionId, setBuilderEditingSessionId] = useState<string>(""); // when editing GEN_
  const [builderSessionName, setBuilderSessionName] = useState<string>("");
  const [builderStrict, setBuilderStrict] = useState<boolean>(true);
  const [builderPreferSamePrimary, setBuilderPreferSamePrimary] = useState<boolean>(true);

  const [builderDraft, setBuilderDraft] = useState<BuilderDraftItem[]>([]);
  const [builderErr, setBuilderErr] = useState<string>("");
  const [builderSaving, setBuilderSaving] = useState<boolean>(false);

  const [swapRowIndex, setSwapRowIndex] = useState<number>(-1);
  const [swapFreeMode, setSwapFreeMode] = useState<boolean>(false); // independent toggle for swaps (helps recustomize)

  /* =========================================================
     ## SMALL HELPERS ##
     ========================================================= */
  function setLogField(k: string, field: "reps" | "weight", v: string) {
    setLogInputs((m) => ({ ...m, [k]: { ...(m[k] || { reps: "", weight: "" }), [field]: v } }));
  }

  // =======================
  // NAV HELPERS START
  // =======================
  function goToExerciseIndex(nextIndex: number, maxLen: number) {
    const safe = Math.max(0, Math.min(maxLen - 1, nextIndex));
    setSelectedExerciseIndex(safe);

    const nextRow = sessionExercises[safe];
    if (nextRow?.ExerciseID) {
      setActiveExerciseId(String(nextRow.ExerciseID).trim());
      setExerciseBackTarget("session");
    } else {
      setActiveExerciseId("");
    }
  }

  function goPrevExercise(maxLen: number) {
    goToExerciseIndex(selectedExerciseIndex - 1, maxLen);
  }

  function goNextExercise(maxLen: number) {
    goToExerciseIndex(selectedExerciseIndex + 1, maxLen);
  }
  // =======================
  // NAV HELPERS END
  // =======================

  /* =========================================================
     ## BOOTSTRAP ##
     ========================================================= */
  useEffect(() => {
    let alive = true;
    (async () => {
      setBootErr("");
      const data = await fetchBootstrap(import.meta.env.VITE_ROUTINE_ID as any);
      if (!alive) return;

      if (!data?.success) {
        setBoot(null);
        setBootErr(data?.error || "Bootstrap failed");
        return;
      }

      setBoot(data);
      setView("sessions");
      setSelectedSessionId("");
      setSelectedExerciseIndex(0);
      setExerciseBackTarget("session");
      setActiveExerciseId("");
    })().catch((e) => {
      if (!alive) return;
      setBoot(null);
      setBootErr(String((e as any)?.message || e));
    });

    return () => {
      alive = false;
    };
  }, []);

  /* =========================================================
     ## AUTH ##
     ========================================================= */
  useEffect(() => {
    let alive = true;
    (async () => {
      setAuthErr("");
      try {
        const res = await authTest();
        if (!alive) return;
        if (res?.success && (res as any).userId) {
          setUserId(String((res as any).userId));
        } else {
          setUserId("");
          setAuthErr((res as any)?.error || "authTest failed");
        }
      } catch (e: any) {
        if (!alive) return;
        setUserId("");
        setAuthErr(String(e?.message || e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* =========================================================
     ## DERIVED DATA ##
     ========================================================= */
  const routineId = String(boot?.routine?.RoutineID || "");
  const sessions = useMemo(() => (boot?.sessions || []) as RoutineSession[], [boot]);
  const allExercises = useMemo(() => (boot?.exercises || []) as RoutineExercise[], [boot]);

  const maxesForUser = useMemo(() => {
    const maxes = (boot?.maxes || []) as any[];
    if (!maxes.length) return [];
    if (!userId) return maxes;

    const filtered = maxes.filter((m) => String(m.UserID || "") === String(userId));
    return filtered.length ? filtered : maxes;
  }, [boot, userId]);

  const { libraryById, maxById, schemesById } = useMemo(
    () => buildIndexes({ library: boot?.library, maxes: maxesForUser as any, schemes: boot?.schemes }),
    [boot, maxesForUser]
  );

  const libraryExerciseIds = useMemo(() => {
    return Object.keys(libraryById || {})
      .map((x) => String(x).trim())
      .filter(Boolean);
  }, [libraryById]);

  const currentSession = useMemo(() => {
    return sessions.find((s) => String(s.SessionID) === String(selectedSessionId)) || null;
  }, [sessions, selectedSessionId]);

  const sessionExercises = useMemo(() => {
    if (!selectedSessionId) return [];
    return sortedSessionExercises(allExercises, selectedSessionId);
  }, [allExercises, selectedSessionId]);

  const currentRow = useMemo(() => {
    return sessionExercises[selectedExerciseIndex] || null;
  }, [sessionExercises, selectedExerciseIndex]);

  const resolvedExerciseId = useMemo(() => {
    const a = String(activeExerciseId || "").trim();
    if (a) return a;
    const c = String(currentRow?.ExerciseID || "").trim();
    if (c) return c;
    return "";
  }, [activeExerciseId, currentRow]);

  const currentLibRow = useMemo(() => {
    return resolvedExerciseId ? (libraryById[resolvedExerciseId] as any) : null;
  }, [libraryById, resolvedExerciseId]);

  const currentMaxRow = resolvedExerciseId ? (maxById[resolvedExerciseId] as any) : null;
  const currentOneRM = toNumber(currentMaxRow?.OneRM);
  const currentTM = toNumber(currentMaxRow?.TrainingMax);
  const currentUnit = String(currentMaxRow?.Unit || currentLibRow?.Unit || "");

  /* =========================================================
     ## GIF CANDIDATES (HOOK-SAFE) ##
     ========================================================= */
  const rawGif = useMemo(() => {
    return String(currentLibRow?.GifURL || "").trim();
  }, [currentLibRow]);

  const gifSources = useMemo(() => buildGifCandidates(rawGif), [rawGif]);
  const gifSrc = gifSources[gifTryIndex] || "";

  /* =========================================================
     ## RESET WHEN EXERCISE CHANGES ##
     ========================================================= */
  useEffect(() => {
    if (view !== "exercise") return;
    if (!resolvedExerciseId) return;

    setOneRMInput(currentOneRM != null ? String(currentOneRM) : "");
    setOneRMEstWeight("");
    setOneRMEstReps("");
    setOneRMError("");
    setOneRMSaved(false);

    setGifTryIndex(0);
  }, [view, resolvedExerciseId, currentOneRM]);

  /* =========================================================
     ## MUSCLE BALANCE: HARD SETS (FROM Training_Log)
     ========================================================= */
  const muscleBalance = useMemo(() => {
    const logs = ((boot as any)?.logs || []) as any[];
    if (!logs.length) {
      return {
        dateKeys: [] as string[],
        counts: {} as Record<string, number>,
      };
    }

    const userLogs = userId ? logs.filter((r) => String(r.UserID || "") === String(userId)) : logs;

    const dateSet = new Set<string>();
    for (const r of userLogs) {
      const dk = extractDateKeyFromTimestamp(r.Timestamp);
      if (dk) dateSet.add(dk);
    }

    const dateKeys = Array.from(dateSet)
      .sort((a, b) => parseYYYYMMDD(b) - parseYYYYMMDD(a))
      .slice(0, 3);

    const dateAllow = new Set(dateKeys);

    const counts: Record<string, number> = {};

    for (const r of userLogs) {
      const dk = extractDateKeyFromTimestamp(r.Timestamp);
      if (!dk || !dateAllow.has(dk)) continue;

      const exId = String(r.ExerciseID || "").trim();
      if (!exId) continue;

      const lib = libraryById[exId] as any;
      if (!lib) continue;
      if (isWarmUpCategory(lib)) continue;

      const pm = normMuscleName(lib?.PrimaryMuscle);
      const sm = normMuscleName(lib?.SecondaryMuscle);

      if (pm) counts[pm] = (counts[pm] || 0) + 1.0;
      if (sm) counts[sm] = (counts[sm] || 0) + 0.5;
    }

    return { dateKeys, counts };
  }, [boot, userId, libraryById]);

  function setsForMuscle(muscle: string): number {
    const nm = normMuscleName(muscle);
    return Number(muscleBalance.counts?.[nm] || 0);
  }

  /* =========================================================
     ## MUSCLE BALANCE: EXERCISES FOR SELECTED MUSCLE (LIBRARY SCAN)
     ========================================================= */
  const mbPrimaryExerciseIds = useMemo(() => {
    const target = normMuscleName(mbSelectedMuscle);
    if (!target) return [];
    const out: string[] = [];

    for (const exId of libraryExerciseIds) {
      const lib = libraryById[String(exId)] as any;
      if (!lib) continue;
      if (normMuscleName(lib?.PrimaryMuscle) === target) out.push(String(exId));
    }

    return Array.from(new Set(out));
  }, [mbSelectedMuscle, libraryExerciseIds, libraryById]);

  const mbSecondaryExerciseIds = useMemo(() => {
    const target = normMuscleName(mbSelectedMuscle);
    if (!target) return [];
    const out: string[] = [];

    for (const exId of libraryExerciseIds) {
      const lib = libraryById[String(exId)] as any;
      if (!lib) continue;
      if (normMuscleName(lib?.SecondaryMuscle) === target) out.push(String(exId));
    }

    return Array.from(new Set(out));
  }, [mbSelectedMuscle, libraryExerciseIds, libraryById]);

  function exerciseNameFor(exId: string): string {
    const lib = libraryById[String(exId)] as any;
    return String(lib?.Name || exId);
  }
  function exerciseNotesFor(exId: string): string {
    const lib = libraryById[String(exId)] as any;
    return String(lib?.Notes || "");
  }

  /* =========================================================
     ✅ OPEN EXERCISE ALWAYS HAS ExerciseID
     ========================================================= */
  function openExerciseFromMuscle(exId: string) {
    const cleanId = String(exId || "").trim();
    if (!cleanId) return;

    setActiveExerciseId(cleanId);
    setExerciseBackTarget("muscle_balance");

    const row = (allExercises || []).find((r) => String(r.ExerciseID || "").trim() === cleanId);

    if (row) {
      const sid = String(row.SessionID || "").trim();
      setSelectedSessionId(sid);

      const inSession = sortedSessionExercises(allExercises, sid);
      const idx = inSession.findIndex(
        (x) => String(x.ExerciseID || "").trim() === cleanId && String(x.Order ?? "") === String(row.Order ?? "")
      );

      setSelectedExerciseIndex(Math.max(0, idx >= 0 ? idx : 0));
    } else {
      setSelectedSessionId("");
      setSelectedExerciseIndex(0);
    }

    setView("exercise");
  }

  function openExerciseFromLibrary(exId: string, list: string[], index: number) {
    const cleanId = String(exId || "").trim();
    if (!cleanId) return;

    setLibExerciseIds(Array.from(new Set((list || []).map((x) => String(x || "").trim()).filter(Boolean))));
    setLibExerciseIndex(Math.max(0, index || 0));

    setActiveExerciseId(cleanId);
    setExerciseBackTarget("library");

    setSelectedSessionId("");
    setSelectedExerciseIndex(0);

    setView("exercise");
  }

  /* =========================================================
     ## BACKEND ACTIONS ##
     ========================================================= */
  // =======================
  // SAVEANYSET REPLACEMENT START
  // =======================
  async function saveAnySet(args: {
    exId: string;
    exName: string;
    sessionId: string;
    sessionName: string;
    setIndex: number;
    prescribedReps?: string;
    prescribedWeight?: string; // numeric-only
  }) {
    const { exId, exName, sessionId, sessionName, setIndex, prescribedReps, prescribedWeight } = args;

    const k = keyLog(workoutDate, sessionId, exId, setIndex);
    const cur = logInputs[k] || { reps: "", weight: "" };

    const repsToSend = String(cur.reps || prescribedReps || "").trim();

    const weightCandidate = String(cur.weight || prescribedWeight || "").trim();
    const weightToSend = weightCandidate && isFinite(Number(weightCandidate)) ? weightCandidate : "";

    setLogInputs((m) => ({ ...m, [k]: { ...cur, saving: true, error: "", saved: false } }));

    try {
      await postLogSet({
        date: workoutDate,
        routineId,
        sessionId,
        sessionName,
        exerciseId: exId,
        exerciseName: exName,
        setNumber: setIndex,
        prescribedReps: String(prescribedReps || "").trim(),
        prescribedWeight: String(prescribedWeight || "").trim(),
        actualReps: repsToSend,
        actualWeight: weightToSend,
      });

      setLogInputs((m) => ({ ...m, [k]: { ...m[k], saving: false, saved: true, error: "" } }));

      const data = await fetchBootstrap(import.meta.env.VITE_ROUTINE_ID as any);
      if (data?.success) setBoot(data);
    } catch (e: any) {
      setLogInputs((m) => ({
        ...m,
        [k]: { ...m[k], saving: false, saved: false, error: String(e?.message || e) },
      }));
    }
  }
  // =======================
  // SAVEANYSET REPLACEMENT END
  // =======================

  async function saveOneRM(exId: string) {
    const v = toNumber(oneRMInput);
    if (v == null || v <= 0) return;
    setOneRMSaving(true);
    setOneRMError("");
    setOneRMSaved(false);
    try {
      const res = await postUpdateOneRM({ userId, exerciseId: exId, oneRM: v, unit: currentUnit || "" });
      if (!res?.success) throw new Error((res as any)?.error || "Failed to save 1RM");
      setOneRMSaving(false);
      setOneRMSaved(true);

      const data = await fetchBootstrap(import.meta.env.VITE_ROUTINE_ID as any);
      if (data?.success) setBoot(data);
    } catch (e: any) {
      setOneRMSaving(false);
      setOneRMError(String(e?.message || e));
    }
  }

  /* =========================================================
     ## BUILDER: deterministic generator helpers ##
     ========================================================= */

  function libRowToDraft(exId: string): BuilderDraftItem | null {
    const lib = libraryById[String(exId)] as any;
    if (!lib) return null;

    const schemeId = String(lib?.SchemeID || "").trim();
    if (!schemeId) return null;
    if (isExcludedFromBuilder(lib)) return null;

    return {
      ExerciseID: String(lib.ExerciseID || exId).trim(),
      Name: String(lib.Name || exId).trim(),
      Category: String(lib.Category || "").trim(),
      MovementPattern: String(lib.MovementPattern || "").trim(),
      PlaneOfMotion: String(lib.PlaneOfMotion || "").trim(),
      PrimaryMuscle: String(lib.PrimaryMuscle || "").trim(),
      SecondaryMuscle: String(lib.SecondaryMuscle || "").trim(),
      LogMode: String(lib.LogMode || "").trim(),
      SchemeID: schemeId,
      Notes: String(lib.Notes || "").trim(),
    };
  }

  function isMainLift(lib: BuilderDraftItem): boolean {
    const lm = normStr(lib.LogMode);
    const cat = normStr(lib.Category);
    return lm === "main" || cat === "main";
  }

  function poolEligible(): BuilderDraftItem[] {
    const out: BuilderDraftItem[] = [];
    for (const id of libraryExerciseIds) {
      const d = libRowToDraft(id);
      if (d) out.push(d);
    }
    // stable deterministic ordering base
    out.sort((a, b) => a.Name.localeCompare(b.Name) || a.ExerciseID.localeCompare(b.ExerciseID));
    return out;
  }

  function scoreExercise(d: BuilderDraftItem, bias: BuilderBias): number {
    if (bias === "Full Body") return 1;
    const set = biasSet(bias);
    const pm = normMuscleName(d.PrimaryMuscle);
    const sm = normMuscleName(d.SecondaryMuscle);
    let s = 1;
    if (pm && set.has(pm)) s += 2;
    if (sm && set.has(sm)) s += 1;
    return s;
  }

  function movementIs(d: BuilderDraftItem, token: string): boolean {
    return normStr(d.MovementPattern) === normStr(token);
  }

  function isPush(d: BuilderDraftItem): boolean {
    const mp = normStr(d.MovementPattern);
    return mp === normStr("Push Horizontal") || mp === normStr("Push Vertical");
  }

  function isPull(d: BuilderDraftItem): boolean {
    const mp = normStr(d.MovementPattern);
    return mp === normStr("Pull Horizontal") || mp === normStr("Pull Vertical");
  }

  function isSquatOrLunge(d: BuilderDraftItem): boolean {
    const mp = normStr(d.MovementPattern);
    return mp === normStr("Squat") || mp === normStr("Lunge");
  }

  function isHinge(d: BuilderDraftItem): boolean {
    return normStr(d.MovementPattern) === normStr("Hinge");
  }

  function isCore(d: BuilderDraftItem): boolean {
    return normStr(d.Category) === normStr("Core") || normStr(d.MovementPattern) === normStr("Core");
  }

  function isConditioning(d: BuilderDraftItem): boolean {
    return normStr(d.Category) === normStr("Conditioning");
  }

  function isAccessory(d: BuilderDraftItem): boolean {
    return normStr(d.Category) === normStr("Accessory");
  }

  function isShoulderScapSlot(d: BuilderDraftItem): boolean {
    const pm = normMuscleName(d.PrimaryMuscle);
    const sm = normMuscleName(d.SecondaryMuscle);
    const targets = new Set(
      ["Front Delts", "Side Delts", "Rear Delts", "Rotator Cuff", "Serratus"].map(normMuscleName)
    );
    return (pm && targets.has(pm)) || (sm && targets.has(sm));
  }

  function isLowerAccessorySlot(d: BuilderDraftItem): boolean {
    const pm = normMuscleName(d.PrimaryMuscle);
    const sm = normMuscleName(d.SecondaryMuscle);
    const targets = new Set(["Calves", "Adductors", "Glute Med", "Tibialis Anterior", "Hip Flexors"].map(normMuscleName));
    return (pm && targets.has(pm)) || (sm && targets.has(sm));
  }

  function selectBest(
    candidates: BuilderDraftItem[],
    bias: BuilderBias,
    used: Set<string>,
    mpCounts: Record<string, number>,
    predicate: (d: BuilderDraftItem) => boolean
  ): BuilderDraftItem | null {
    const scored = candidates
      .filter((d) => !used.has(d.ExerciseID))
      .filter(predicate)
      .filter((d) => {
        const mp = normStr(d.MovementPattern);
        const c = mpCounts[mp] || 0;
        return c < 3; // do not allow 3+ of same MovementPattern
      })
      .map((d) => ({ d, s: scoreExercise(d, bias) }))
      .sort((a, b) => b.s - a.s || a.d.Name.localeCompare(b.d.Name) || a.d.ExerciseID.localeCompare(b.d.ExerciseID));

    return scored.length ? scored[0].d : null;
  }

  function pushPick(
    picked: BuilderDraftItem[],
    pick: BuilderDraftItem | null,
    used: Set<string>,
    mpCounts: Record<string, number>
  ) {
    if (!pick) return;
    picked.push(pick);
    used.add(pick.ExerciseID);
    const mp = normStr(pick.MovementPattern);
    mpCounts[mp] = (mpCounts[mp] || 0) + 1;
  }

  function generateWorkoutDraft(bias: BuilderBias): BuilderDraftItem[] {
    const all = poolEligible();

    const mains = all.filter((d) => isMainLift(d) && !isConditioning(d) && !isCore(d));
    const acc = all.filter((d) => isAccessory(d) && !isConditioning(d) && !isCore(d));
    const core = all.filter((d) => isCore(d));
    const cond = all.filter((d) => isConditioning(d));

    const used = new Set<string>();
    const mpCounts: Record<string, number> = {};
    const picked: BuilderDraftItem[] = [];

    const wantConditioning = cond.length > 0; // optional, include if available

    if (bias === "Upper") {
      // 1 Main
      pushPick(picked, selectBest(mains, bias, used, mpCounts, (d) => isPush(d) || isPull(d)), used, mpCounts);

      // Accessories: ensure Push + Pull + Shoulder/Scap
      pushPick(picked, selectBest(acc, bias, used, mpCounts, (d) => isPull(d)), used, mpCounts);
      pushPick(picked, selectBest(acc, bias, used, mpCounts, (d) => isPush(d)), used, mpCounts);
      pushPick(picked, selectBest(acc, bias, used, mpCounts, (d) => isShoulderScapSlot(d)), used, mpCounts);

      // Fill remaining accessories to reach ~4 accessories total
      while (picked.filter(isAccessory).length < 5) {
        const next = selectBest(acc, bias, used, mpCounts, (d) => true);
        if (!next) break;
        pushPick(picked, next, used, mpCounts);
      }

      // Core
      pushPick(picked, selectBest(core, bias, used, mpCounts, (d) => true), used, mpCounts);

      // Optional Conditioning
      if (wantConditioning) {
        pushPick(picked, selectBest(cond, bias, used, mpCounts, (d) => true), used, mpCounts);
      }
    }

    if (bias === "Lower") {
      // 1 Main: Squat/Lunge preferred
      pushPick(picked, selectBest(mains, bias, used, mpCounts, (d) => isSquatOrLunge(d)), used, mpCounts);

      // Ensure hinge somewhere (main or accessory)
      pushPick(picked, selectBest(acc, bias, used, mpCounts, (d) => isHinge(d)), used, mpCounts);

      // Lower accessory slot
      pushPick(picked, selectBest(acc, bias, used, mpCounts, (d) => isLowerAccessorySlot(d)), used, mpCounts);

      // Fill additional accessories
      while (picked.filter(isAccessory).length < 5) {
        const next = selectBest(acc, bias, used, mpCounts, (d) => true);
        if (!next) break;
        pushPick(picked, next, used, mpCounts);
      }

      // Core
      pushPick(picked, selectBest(core, bias, used, mpCounts, (d) => true), used, mpCounts);

      // Optional Conditioning
      if (wantConditioning) {
        pushPick(picked, selectBest(cond, bias, used, mpCounts, (d) => true), used, mpCounts);
      }
    }

    if (bias === "Full Body") {
      // 2 Mains: squat/lunge + push/pull
      pushPick(picked, selectBest(mains, bias, used, mpCounts, (d) => isSquatOrLunge(d)), used, mpCounts);
      pushPick(picked, selectBest(mains, bias, used, mpCounts, (d) => isPush(d) || isPull(d)), used, mpCounts);

      // Ensure hinge
      pushPick(picked, selectBest(acc, bias, used, mpCounts, (d) => isHinge(d)), used, mpCounts);

      // Ensure push + pull (if not already present in mains)
      const hasPush = picked.some((d) => isPush(d));
      const hasPull = picked.some((d) => isPull(d));

      if (!hasPush) pushPick(picked, selectBest(acc, bias, used, mpCounts, (d) => isPush(d)), used, mpCounts);
      if (!hasPull) pushPick(picked, selectBest(acc, bias, used, mpCounts, (d) => isPull(d)), used, mpCounts);

      // Fill accessories to ~4 total accessories
      while (picked.filter(isAccessory).length < 4) {
        const next = selectBest(acc, bias, used, mpCounts, (d) => true);
        if (!next) break;
        pushPick(picked, next, used, mpCounts);
      }

      // Core
      pushPick(picked, selectBest(core, bias, used, mpCounts, (d) => true), used, mpCounts);

      // Optional Conditioning
      if (wantConditioning) {
        pushPick(picked, selectBest(cond, bias, used, mpCounts, (d) => true), used, mpCounts);
      }
    }

    // final deterministic order:
    // Main first, then Accessory, Core, Conditioning
    const blockRank = (d: BuilderDraftItem) => {
      if (isMainLift(d)) return 1;
      if (isCore(d)) return 3;
      if (isConditioning(d)) return 4;
      return 2;
    };

    const out = picked.slice().sort((a, b) => blockRank(a) - blockRank(b) || a.Name.localeCompare(b.Name));
    return out;
  }

  function draftToSheetRows(sessionName: string, draft: BuilderDraftItem[]): BuilderExerciseRow[] {
    // Order 10,20,30...
    const rows: BuilderExerciseRow[] = [];
    for (let i = 0; i < draft.length; i++) {
      const d = draft[i];
      const order = (i + 1) * 10;

      let block = "Accessory";
      if (isMainLift(d)) block = "Main";
      else if (normStr(d.Category) === normStr("Core")) block = "Core";
      else if (normStr(d.Category) === normStr("Conditioning")) block = "Conditioning";

      rows.push({
        Order: order,
        Block: block,
        ExerciseID: d.ExerciseID,
        SchemeID: d.SchemeID,
        Notes: "",
        SupersetID: "",
        SessionName: sessionName,
      });
    }
    return rows;
  }

  function resetBuilderToCreate() {
    setBuilderMode("create");
    setBuilderEditingSessionId("");
    setBuilderSessionName("");
    setBuilderDraft([]);
    setBuilderErr("");
    setBuilderSaving(false);
    setSwapRowIndex(-1);
    setSwapFreeMode(false);
    setExerciseBackTarget("builder");
  }

  function openBuilderCreate() {
    resetBuilderToCreate();
    setView("builder");
  }

  function openBuilderEdit(sessionId: string) {
    const sid = String(sessionId || "").trim();
    if (!sid) return;

    const sess = sessions.find((s) => String(s.SessionID || "").trim() === sid);
    const sessName = String(sess?.SessionName || sid).trim();
    const sessNotes = String(sess?.Notes || "").trim();

    // Infer bias if stored
    let bias: BuilderBias = "Upper";
    const m = sessNotes.match(/BIAS=([^|]+)/i);
    if (m && m[1]) {
      const b = String(m[1]).trim().toLowerCase();
      if (b === "upper") bias = "Upper";
      if (b === "lower") bias = "Lower";
      if (b === "full body" || b === "full") bias = "Full Body";
    }

    // Load Routine_Exercises rows for that session
    const rows = sortedSessionExercises(allExercises, sid);

    const draft: BuilderDraftItem[] = [];
    for (const r of rows) {
      const exId = String(r.ExerciseID || "").trim();
      const d = libRowToDraft(exId);
      if (d) draft.push(d);
    }

    setBuilderMode("edit");
    setBuilderEditingSessionId(sid);
    setBuilderBias(bias);
    setBuilderSessionName(sessName);
    setBuilderDraft(draft);
    setBuilderErr("");
    setBuilderSaving(false);
    setSwapRowIndex(-1);
    setSwapFreeMode(false);
    setExerciseBackTarget("builder");

    setView("builder");
  }

  function swapCandidatesForRow(target: BuilderDraftItem, currentDraft: BuilderDraftItem[]) {
    const used = new Set(currentDraft.map((d) => d.ExerciseID));
    const all = poolEligible().filter((d) => !used.has(d.ExerciseID));

    if (!swapFreeMode) {
      // Strict / Similar options
      const targetCat = normStr(target.Category);
      const targetMP = normStr(target.MovementPattern);
      const targetPM = normMuscleName(target.PrimaryMuscle);

      return all
        .filter((d) => {
          if (!builderStrict) return true;

          const sameCat = normStr(d.Category) === targetCat;
          const sameMP = normStr(d.MovementPattern) === targetMP;
          if (!(sameCat || sameMP)) return false;

          if (builderPreferSamePrimary) {
            return normMuscleName(d.PrimaryMuscle) === targetPM;
          }
          return true;
        })
        .sort((a, b) => a.Name.localeCompare(b.Name));
    }

    // Free mode: show everything eligible (still no duplicates)
    return all.sort((a, b) => a.Name.localeCompare(b.Name));
  }

  async function finishBuilder() {
    setBuilderErr("");
    if (!routineId) {
      setBuilderErr("Missing routineId from bootstrap.");
      return;
    }
    if (!builderDraft.length) {
      setBuilderErr("Draft is empty. Generate a workout first.");
      return;
    }

    setBuilderSaving(true);

    const isEdit = builderMode === "edit" && !!builderEditingSessionId;

    const sessionId = isEdit ? builderEditingSessionId : `GEN_${nowSessionStamp()}`;
    const sessionName =
      String(builderSessionName || "").trim() || (isEdit ? builderEditingSessionId : `Generated ${builderBias}`);

    const notes = `BUILDER|BIAS=${builderBias}`;

    const rows = draftToSheetRows(sessionName, builderDraft);

    try {
      if (isEdit) {
        const res = await postReplaceSessionExercises({
          routineId,
          sessionId,
          sessionName,
          notes,
          exercises: rows,
        });
        if (!res?.success) throw new Error((res as any)?.error || "Failed to update session");
      } else {
        const res = await postCreateSessionWithExercises({
          routineId,
          sessionId,
          sessionName,
          notes,
          exercises: rows,
        });
        if (!res?.success) throw new Error((res as any)?.error || "Failed to create session");
      }

      const data = await fetchBootstrap(import.meta.env.VITE_ROUTINE_ID as any);
      if (data?.success) setBoot(data);

      // Open the created/edited session
      setSelectedSessionId(sessionId);
      setSelectedExerciseIndex(0);
      setActiveExerciseId("");
      setExerciseBackTarget("session");
      setView("session");
    } catch (e: any) {
      setBuilderErr(String(e?.message || e));
    } finally {
      setBuilderSaving(false);
    }
  }

  async function deleteBuilderSession(sessionId: string) {
    const sid = String(sessionId || "").trim();
    if (!sid) return;
    if (!routineId) return;

    setBuilderErr("");
    setBuilderSaving(true);

    try {
      const res = await postDeleteSession({ routineId, sessionId: sid });
      if (!res?.success) throw new Error((res as any)?.error || "Failed to delete session");

      const data = await fetchBootstrap(import.meta.env.VITE_ROUTINE_ID as any);
      if (data?.success) setBoot(data);

      setSelectedSessionId("");
      setSelectedExerciseIndex(0);
      setActiveExerciseId("");
      setView("sessions");
    } catch (e: any) {
      setBuilderErr(String(e?.message || e));
    } finally {
      setBuilderSaving(false);
    }
  }

  /* =========================================================
     ## LOADING / ERROR GATE ##
     ========================================================= */
  if (!boot) {
    return (
      <div className="app">
        <div className="page">
          <div className="title">Workout</div>
          {!bootErr ? <div className="muted">Loading…</div> : <div className="error">{bootErr}</div>}
        </div>
      </div>
    );
  }

  /* =========================================================
     ## VIEW: sessions (HOME) ##
     ========================================================= */
  if (view === "sessions") {
    return (
      <div className="app">
        <div className="page">
          <div className="title">Workout</div>

          <div className="muted small" style={{ marginBottom: 10 }}>
            User: <span style={{ fontWeight: 900 }}>{userId || "—"}</span>
          </div>

          {authErr ? (
            <div className="error small" style={{ marginBottom: 10 }}>
              {authErr}
            </div>
          ) : null}

          {bootErr ? (
            <div className="error small" style={{ marginBottom: 10 }}>
              {bootErr}
            </div>
          ) : null}

          <div className="topRow">
            <input className="dateInput" type="date" value={workoutDate} onChange={(e) => setWorkoutDate(e.target.value)} />
            <button
              className="pill"
              onClick={() => {
                setWorkoutDate(todayLocalISO());
                setDoneMap({});
                setLogInputs({});
              }}
            >
              New date
            </button>
          </div>

          <div className="stack">
            <button
              className={`bubble bubble--main`.trim()}
              onClick={() => {
                setMbSelectedMuscle("");
                setView("muscle_balance");
              }}
            >
              <div className="bubbleTitle">Muscle Balance</div>
              <div className="bubbleSub muted">Tap muscles → see exercise options</div>
            </button>

            <button
              className={`bubble bubble--main`.trim()}
              onClick={() => {
                setLibStep("facet");
                setLibFacet("PrimaryMuscle");
                setLibFacetValue("");
                setLibExerciseIds([]);
                setLibExerciseIndex(0);
                setView("library");
              }}
            >
              <div className="bubbleTitle">Exercise Library</div>
              <div className="bubbleSub muted">Browse by PrimaryMuscle / MovementPattern / PlaneOfMotion</div>
            </button>

            {/* ✅ NEW: Workout Builder */}
            <button
              className={`bubble bubble--main`.trim()}
              onClick={() => {
                openBuilderCreate();
              }}
            >
              <div className="bubbleTitle">Workout Builder</div>
              <div className="bubbleSub muted">Generate Upper / Lower / Full Body sessions</div>
            </button>

            {sessions.map((s) => (
              <button
                key={String(s.SessionID)}
                className={`bubble bubble--main`.trim()}
                onClick={() => {
                  setSelectedSessionId(String(s.SessionID || ""));
                  setSelectedExerciseIndex(0);
                  setExerciseBackTarget("session");
                  setActiveExerciseId("");
                  setView("session");
                }}
              >
                <div className="bubbleTitle">{s.SessionName || s.SessionID}</div>
                {s.Notes ? <div className="bubbleSub">{s.Notes}</div> : <div className="bubbleSub muted">Tap to open</div>}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ==============================
  // VIEW: builder
  // ==============================
  if (view === "builder") {
    const isEdit = builderMode === "edit" && !!builderEditingSessionId;

    const canGenerate = libraryExerciseIds.length > 0;

    const draftSummary = (() => {
      const mains = builderDraft.filter(isMainLift).length;
      const acc = builderDraft.filter(isAccessory).length;
      const core = builderDraft.filter(isCore).length;
      const cond = builderDraft.filter(isConditioning).length;
      return { mains, acc, core, cond, total: builderDraft.length };
    })();

    const swapTarget = swapRowIndex >= 0 ? builderDraft[swapRowIndex] : null;
    const swapCandidates = swapTarget ? swapCandidatesForRow(swapTarget, builderDraft) : [];

    return (
      <div className="app">
        <div className="page">
          <div className="headerRow">
            <button
              className="pill"
              onClick={() => {
                // Back to home
                setView("sessions");
              }}
            >
              ← Home
            </button>
            <div className="titleSmall">{isEdit ? "Workout Builder (Edit)" : "Workout Builder"}</div>
          </div>

          {builderErr ? (
            <div className="error" style={{ marginTop: 10 }}>
              {builderErr}
            </div>
          ) : null}

          <div className="block" style={{ marginTop: 12 }}>
            <div className="blockTitle">1) Choose bias</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {(["Upper", "Lower", "Full Body"] as BuilderBias[]).map((b) => (
                <button
                  key={b}
                  className={`pill ${builderBias === b ? "pillDone" : ""}`}
                  onClick={() => setBuilderBias(b)}
                >
                  {b}
                </button>
              ))}
            </div>

            <div className="muted small" style={{ marginTop: 10 }}>
              Bias affects scoring. Coverage rules prevent duplicates and enforce Squat/Hinge/Push/Pull/Core requirements.
            </div>
          </div>

          <div className="block" style={{ marginTop: 12 }}>
            <div className="blockTitle">2) Generate</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <button
                className="pill"
                disabled={!canGenerate}
                onClick={() => {
                  setBuilderErr("");
                  const draft = generateWorkoutDraft(builderBias);
                  setBuilderDraft(draft);
                  setSwapRowIndex(-1);
                }}
              >
                Build workout
              </button>

              <button
                className="pill"
                disabled={!builderDraft.length}
                onClick={() => {
                  setBuilderDraft([]);
                  setSwapRowIndex(-1);
                }}
              >
                Clear
              </button>

              <div className="muted small">
                Draft: {draftSummary.total} (Main {draftSummary.mains}, Accessory {draftSummary.acc}, Core {draftSummary.core}
                {draftSummary.cond ? `, Conditioning ${draftSummary.cond}` : ""})
              </div>
            </div>

            {!canGenerate ? <div className="error small" style={{ marginTop: 10 }}>Exercise_Library not loaded.</div> : null}
          </div>

          <div className="block" style={{ marginTop: 12 }}>
            <div className="blockTitle">3) Customize</div>

            <div className="muted small" style={{ marginTop: 6 }}>
              Swap defaults to “similar” options. Toggle Free mode if you want to reshape the workout completely.
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <button className={`pill ${builderStrict ? "pillDone" : ""}`} onClick={() => setBuilderStrict((v) => !v)}>
                Strict mode
              </button>
              <button
                className={`pill ${builderPreferSamePrimary ? "pillDone" : ""}`}
                onClick={() => setBuilderPreferSamePrimary((v) => !v)}
                disabled={!builderStrict}
              >
                Prefer same PrimaryMuscle
              </button>
              <button className={`pill ${swapFreeMode ? "pillDone" : ""}`} onClick={() => setSwapFreeMode((v) => !v)}>
                Free swap mode
              </button>
            </div>

            {!builderDraft.length ? (
              <div className="muted small" style={{ marginTop: 10 }}>
                Generate a workout first.
              </div>
            ) : (
              <div className="stack" style={{ marginTop: 12 }}>
                {builderDraft.map((d, idx) => (
                  <div key={`${d.ExerciseID}-${idx}`} className="block" style={{ marginTop: 0 }}>
                    <div className="bubbleRow" style={{ justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontWeight: 900 }}>{d.Name}</div>
                        <div className="muted small">
                          {d.Category || "—"} • {d.MovementPattern || "—"} • {d.PrimaryMuscle || "—"}
                          {d.SecondaryMuscle ? ` / ${d.SecondaryMuscle}` : ""}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button className="pill small" onClick={() => setSwapRowIndex(idx)}>
                          Swap
                        </button>
                        <button
                          className="pill small"
                          onClick={() => {
                            setBuilderDraft((cur) => cur.filter((_, i) => i !== idx));
                            if (swapRowIndex === idx) setSwapRowIndex(-1);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {swapTarget ? (
            <div className="block" style={{ marginTop: 12 }}>
              <div className="blockTitle">Swap: {swapTarget.Name}</div>
              <div className="muted small" style={{ marginBottom: 10 }}>
                Showing {swapCandidates.length} candidates {swapFreeMode ? "(Free)" : "(Filtered)"}
              </div>

              {!swapCandidates.length ? (
                <div className="muted small">No candidates found.</div>
              ) : (
                <div className="stack">
                  {swapCandidates.slice(0, 60).map((c) => (
                    <button
                      key={`SWAP-${c.ExerciseID}`}
                      className={`bubble bubble--main`.trim()}
                      onClick={() => {
                        setBuilderDraft((cur) => {
                          const next = cur.slice();
                          next[swapRowIndex] = c;
                          return next;
                        });
                        setSwapRowIndex(-1);
                      }}
                    >
                      <div className="bubbleTitle">{c.Name}</div>
                      <div className="bubbleSub muted">
                        {c.Category || "—"} • {c.MovementPattern || "—"} • {c.PrimaryMuscle || "—"}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <button className="pill" style={{ marginTop: 12 }} onClick={() => setSwapRowIndex(-1)}>
                Close swap
              </button>
            </div>
          ) : null}

          <div className="block" style={{ marginTop: 12 }}>
            <div className="blockTitle">4) Finish</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <input
                className="miniInput"
                style={{ minWidth: 220 }}
                placeholder={isEdit ? "Session name (optional)" : "Session name (optional)"}
                value={builderSessionName}
                onChange={(e) => setBuilderSessionName(e.target.value)}
              />

              <button className="pill" disabled={builderSaving || !builderDraft.length} onClick={finishBuilder}>
                {builderSaving ? "Saving…" : isEdit ? "Save changes" : "Finish (save session)"}
              </button>
            </div>

            {isEdit ? (
              <div className="muted small" style={{ marginTop: 10 }}>
                Editing: <b>{builderEditingSessionId}</b>
              </div>
            ) : null}
          </div>

          {isEdit ? (
            <div className="block" style={{ marginTop: 12 }}>
              <div className="blockTitle">Danger</div>
              <button
                className="pill"
                disabled={builderSaving}
                onClick={() => {
                  deleteBuilderSession(builderEditingSessionId);
                }}
              >
                Delete this session
              </button>
              <div className="muted small" style={{ marginTop: 8 }}>
                Deletes the Routine_Sessions row and all Routine_Exercises rows for this GEN_ session.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ==============================
  // VIEW: muscle_balance
  // ==============================
  if (view === "muscle_balance") {
    const dateKeys = muscleBalance.dateKeys;

    function clickMuscle(m: string) {
      setMbSelectedMuscle((cur) => (normMuscleName(cur) === normMuscleName(m) ? "" : m));
    }

    function mapTokenToMuscle(tokenRaw: string): string {
      const t = String(tokenRaw || "").trim();
      const n = normMuscleName(t);

      const map: Record<string, string> = {
        traps: "Upper Traps",
        "upper traps": "Upper Traps",
        "rear delts": "Rear Delts",
        "rear deltoids": "Rear Delts",
        "front delts": "Front Delts",
        "front deltoids": "Front Delts",
        lats: "Lats",
        "upper back": "Upper Back",
        hamstrings: "Hamstrings",
        glutes: "Glutes Max",
        quads: "Quads",
        calves: "Calves",
        chest: "Chest",
        biceps: "Biceps",
        triceps: "Triceps",
        forearms: "Forearms",
        adductors: "Adductors",
        "hip flexors": "Hip Flexors",
        "tibialis anterior": "Tibialis Anterior",
        "spinal erectors": "Spinal Erectors",
        rhomboids: "Rhomboids",
        scapulae: "Scapulae",
        "teres major": "Teres Major",
      };

      if (map[n]) return map[n];
      return t;
    }

    function handleMuscleToken(token: string) {
      if (!token || token === "UNKNOWN") return;
      const muscle = mapTokenToMuscle(token);
      if (!muscle) return;
      clickMuscle(muscle);
    }

    function colorForToken(token: string): string | null {
      const muscle = mapTokenToMuscle(token);
      if (!muscle) return null;
      const sets = setsForMuscle(muscle);
      return colorForSets(sets);
    }

    function isSelectedToken(token: string): boolean {
      const muscle = mapTokenToMuscle(token);
      if (!muscle) return false;
      return normMuscleName(muscle) === normMuscleName(mbSelectedMuscle);
    }

    const selected = String(mbSelectedMuscle || "").trim();
    const selectedSets = selected ? setsForMuscle(selected) : 0;

    return (
      <div className="app">
        <div className="page">
          <div className="headerRow">
            <button className="pill" onClick={() => setView("sessions")}>
              ← Home
            </button>
            <div className="titleSmall">Muscle Balance</div>
          </div>

          <div className="noteBox" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Target</div>
            <div className="muted small">
              Aim for <b>10–20 hard sets per muscle</b> across your last <b>3 sessions</b>.
              <br />
              Primary = 1.0 • Secondary = 0.5 • WarmUp excluded
              <br />
              <div style={{ marginTop: 8 }}>
                <b>Colors:</b> gray=0 • blue=0–4 • teal=4–10 • green=10–16 • orange=16–20 • red=20+
              </div>
            </div>
          </div>

          <div className="noteBox" style={{ marginTop: 10 }}>
            <div className="muted small">
              User: <b>{userId || "—"}</b>
              <br />
              Dates: {dateKeys.length ? dateKeys.join(", ") : "No log dates found yet"}
            </div>
          </div>

          <div className="block" style={{ marginTop: 12 }}>
            <div className="blockTitle">Tap a muscle</div>

            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div className="muted small" style={{ marginBottom: 6, fontWeight: 900 }}>
                  Front
                </div>
                <div style={{ borderRadius: 14, background: "rgba(255,255,255,0.04)", padding: 8 }}>
                  <MuscleMap
                    side="front"
                    onMuscleClick={handleMuscleToken}
                    getColorForToken={colorForToken}
                    isTokenSelected={isSelectedToken}
                  />
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <div className="muted small" style={{ marginBottom: 6, fontWeight: 900 }}>
                  Back
                </div>
                <div style={{ borderRadius: 14, background: "rgba(255,255,255,0.04)", padding: 8 }}>
                  <MuscleMap
                    side="back"
                    onMuscleClick={handleMuscleToken}
                    getColorForToken={colorForToken}
                    isTokenSelected={isSelectedToken}
                  />
                </div>
              </div>
            </div>

            {!selected ? (
              <div className="muted small" style={{ marginTop: 10 }}>
                Tap any muscle on the body map to see exercises for that muscle.
              </div>
            ) : null}
          </div>

          {selected ? (
            <div className="block" style={{ marginTop: 12 }}>
              <div className="blockTitle">
                {selected}{" "}
                <span className="chip" style={{ marginLeft: 8, background: colorForSets(selectedSets) as any }}>
                  {selectedSets.toFixed(1)}
                </span>
              </div>

              <div className="muted small" style={{ marginBottom: 10 }}>
                Primary (+1.0) and Secondary (+0.5) exercises from Exercise_Library
              </div>

              <div className="stack">
                <div className="muted small" style={{ fontWeight: 900 }}>
                  Primary (+1.0)
                </div>

                {!mbPrimaryExerciseIds.length ? (
                  <div className="muted small">No primary exercises for this muscle in Exercise_Library.</div>
                ) : (
                  mbPrimaryExerciseIds
                    .slice()
                    .sort((a, b) => exerciseNameFor(a).localeCompare(exerciseNameFor(b)))
                    .map((exId) => (
                      <button
                        key={`MBP-${exId}`}
                        className={`bubble bubble--main`.trim()}
                        onClick={() => openExerciseFromMuscle(exId)}
                      >
                        <div className="bubbleTitle">{exerciseNameFor(exId)}</div>
                        {exerciseNotesFor(exId) ? <div className="bubbleSub muted">{exerciseNotesFor(exId)}</div> : null}
                      </button>
                    ))
                )}

                <div className="muted small" style={{ fontWeight: 900, marginTop: 10 }}>
                  Secondary (+0.5)
                </div>

                {!mbSecondaryExerciseIds.length ? (
                  <div className="muted small">No secondary exercises for this muscle in Exercise_Library.</div>
                ) : (
                  mbSecondaryExerciseIds
                    .slice()
                    .sort((a, b) => exerciseNameFor(a).localeCompare(exerciseNameFor(b)))
                    .map((exId) => (
                      <button
                        key={`MBS-${exId}`}
                        className={`bubble bubble--main`.trim()}
                        onClick={() => openExerciseFromMuscle(exId)}
                      >
                        <div className="bubbleTitle">{exerciseNameFor(exId)}</div>
                        {exerciseNotesFor(exId) ? <div className="bubbleSub muted">{exerciseNotesFor(exId)}</div> : null}
                      </button>
                    ))
                )}

                <button className="pill" style={{ marginTop: 12 }} onClick={() => setMbSelectedMuscle("")}>
                  Clear selection
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  /* =========================================================
     ## VIEW: library (Exercise Library browser) ##
     ========================================================= */
  if (view === "library") {
    const FACETS: { key: LibraryFacetKey; title: string; sub: string }[] = [
      { key: "PrimaryMuscle", title: "PrimaryMuscle", sub: "Group exercises by primary muscle" },
      { key: "SecondaryMuscle", title: "SecondaryMuscle", sub: "Group exercises by secondary muscle" },
      { key: "MovementPattern", title: "MovementPattern", sub: "Squat / Hinge / Push / Pull / etc" },
      { key: "PlaneOfMotion", title: "PlaneOfMotion", sub: "Sagittal / Frontal / Transverse / Multi" },
    ];

    function normFacet(v: any) {
      return String(v || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    }

    const facetMeta = FACETS.find((f) => f.key === libFacet) || FACETS[0];

    const facetValues = (() => {
      const seen = new Map<string, { key: string; label: string; count: number }>();

      for (const exId of libraryExerciseIds) {
        const lib = libraryById[String(exId)] as any;
        if (!lib) continue;

        const raw = String((lib as any)?.[libFacet] || "").trim();
        if (!raw) continue;

        const k = normFacet(raw);
        const cur = seen.get(k);
        if (cur) cur.count += 1;
        else seen.set(k, { key: k, label: raw, count: 1 });
      }

      const out = Array.from(seen.values());
      out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      return out;
    })();

    const exercisesForSelected = (() => {
      if (libStep !== "exercise" || !libFacetValue) return [] as string[];

      const target = normFacet(libFacetValue);
      const out: string[] = [];

      for (const exId of libraryExerciseIds) {
        const lib = libraryById[String(exId)] as any;
        if (!lib) continue;

        const raw = String((lib as any)?.[libFacet] || "");
        if (normFacet(raw) === target) out.push(String(exId));
      }

      out.sort((a, b) => exerciseNameFor(a).localeCompare(exerciseNameFor(b)));
      return out;
    })();

    const headerTitle =
      libStep === "facet"
        ? "Exercise Library"
        : libStep === "value"
        ? `Exercise Library • ${facetMeta.title}`
        : `Exercise Library • ${facetMeta.title}: ${libFacetValue || "—"}`;

    return (
      <div className="app">
        <div className="page">
          <div className="headerRow">
            <button
              className="pill"
              onClick={() => {
                if (libStep === "facet") {
                  setView("sessions");
                  return;
                }
                if (libStep === "value") {
                  setLibStep("facet");
                  setLibFacetValue("");
                  setLibExerciseIds([]);
                  setLibExerciseIndex(0);
                  return;
                }
                setLibStep("value");
                setLibExerciseIds([]);
                setLibExerciseIndex(0);
              }}
            >
              ← Back
            </button>
            <div className="titleSmall">{headerTitle}</div>
          </div>

          {libStep === "facet" ? (
            <div className="stack" style={{ marginTop: 10 }}>
              {FACETS.map((f) => (
                <button
                  key={f.key}
                  className={`bubble bubble--main`.trim()}
                  onClick={() => {
                    setLibFacet(f.key);
                    setLibStep("value");
                    setLibFacetValue("");
                    setLibExerciseIds([]);
                    setLibExerciseIndex(0);
                  }}
                >
                  <div className="bubbleTitle">{f.title}</div>
                  <div className="bubbleSub muted">{f.sub}</div>
                </button>
              ))}
            </div>
          ) : null}

          {libStep === "value" ? (
            <div className="block" style={{ marginTop: 12 }}>
              <div className="blockTitle">Pick a {facetMeta.title}</div>

              {!facetValues.length ? (
                <div className="muted small">No values found for {facetMeta.title}.</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {facetValues.map((v) => (
                    <button
                      key={v.key}
                      className="pill small"
                      onClick={() => {
                        setLibFacetValue(v.label);
                        setLibStep("exercise");

                        const list: string[] = [];
                        const target = normFacet(v.label);

                        for (const exId of libraryExerciseIds) {
                          const lib = libraryById[String(exId)] as any;
                          if (!lib) continue;
                          const raw = String((lib as any)?.[libFacet] || "");
                          if (normFacet(raw) === target) list.push(String(exId));
                        }

                        list.sort((a, b) => exerciseNameFor(a).localeCompare(exerciseNameFor(b)));

                        setLibExerciseIds(list);
                        setLibExerciseIndex(0);
                      }}
                      title={`${v.count} exercises`}
                    >
                      {v.label}{" "}
                      <span className="chip" style={{ marginLeft: 8 }}>
                        {v.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {libStep === "exercise" ? (
            <div className="block" style={{ marginTop: 12 }}>
              <div className="blockTitle">Exercises</div>

              {!exercisesForSelected.length ? (
                <div className="muted small">No exercises found for this selection.</div>
              ) : (
                <div className="stack">
                  {exercisesForSelected.map((exId, idx) => (
                    <button
                      key={`LIB-${exId}`}
                      className={`bubble bubble--main`.trim()}
                      onClick={() => openExerciseFromLibrary(exId, exercisesForSelected, idx)}
                    >
                      <div className="bubbleTitle">{exerciseNameFor(exId)}</div>
                      {exerciseNotesFor(exId) ? <div className="bubbleSub muted">{exerciseNotesFor(exId)}</div> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  /* =========================================================
     ## VIEW: session ##
     ========================================================= */
  if (view === "session") {
    if (!currentSession) {
      return (
        <div className="app">
          <div className="page">
            <div className="title">Workout</div>
            <div className="error">Session not found.</div>
            <button className="pill" onClick={() => setView("sessions")}>
              ← Sessions
            </button>
          </div>
        </div>
      );
    }

    const order = ["WarmUp", "Main", "Accessory", "Core", "Conditioning"];
    const by: Record<string, RoutineExercise[]> = {};
    sessionExercises.forEach((r) => {
      const b = String(r.Block || "Other");
      if (!by[b]) by[b] = [];
      by[b].push(r);
    });

    const keys = Object.keys(by);
    keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const blocks = keys.map((k) => ({ block: k, rows: by[k] }));

    const canEditBuilder = isBuilderSessionId(String(currentSession.SessionID || "")) || normStr(currentSession.Notes).includes("builder");

    return (
      <div className="app">
        <div className="page">
          <div className="headerRow">
            <button className="pill" onClick={() => setView("sessions")}>
              ← Sessions
            </button>
            <div className="titleSmall">{currentSession.SessionName}</div>
          </div>

          {canEditBuilder ? (
            <div className="navRow" style={{ marginTop: 10 }}>
              <button className="pill" onClick={() => openBuilderEdit(String(currentSession.SessionID || ""))}>
                Edit in Builder
              </button>
              <button className="pill" onClick={() => deleteBuilderSession(String(currentSession.SessionID || ""))}>
                Delete Session
              </button>
            </div>
          ) : null}

          <div className="stack" style={{ marginTop: 10 }}>
            {blocks.map(({ block, rows }) => (
              <div key={block} className="block">
                <div className="blockTitle">{block}</div>

                <div className="stack">
                  {rows.map((r) => {
                    const exId = String(r.ExerciseID || "");
                    const lib = libraryById[exId] as any;
                    const name = lib?.Name || exId;

                    const doneK = keyDone(workoutDate, String(r.SessionID || ""), exId);
                    const done = !!doneMap[doneK];

                    return (
                      <button
                        key={`${String(r.Order)}-${exId}`}
                        className={`bubble ${blockToBubbleClass(r.Block)}`.trim()}
                        onClick={() => {
                          const absoluteIdx = sessionExercises.findIndex(
                            (x) => String(x.ExerciseID) === exId && String(x.Order) === String(r.Order)
                          );

                          setSelectedExerciseIndex(Math.max(0, absoluteIdx));
                          setExerciseBackTarget("session");
                          setActiveExerciseId(exId);
                          setView("exercise");
                        }}
                      >
                        <div className="bubbleRow">
                          <div className="bubbleTitle">{name}</div>
                          {isMajor(lib, r.Notes) ? (
                            <span className="chip chipMajor">LOG</span>
                          ) : done ? (
                            <span className="chip chipDone">DONE</span>
                          ) : (
                            <span className="chip chipTap">TAP</span>
                          )}
                        </div>

                        {lib?.Notes ? <div className="bubbleSub muted">{lib.Notes}</div> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* =========================================================
     ## VIEW: exercise (LOG EVERYTHING)
     ========================================================= */
  if (view === "exercise") {
    const exId = String(resolvedExerciseId || "").trim();
    const lib = exId ? ((libraryById[exId] as any) || null) : null;

    const backBtn = (
      <button
        className="pill"
        onClick={() => {
          if (exerciseBackTarget === "library") {
            setView("library");
            return;
          }
          if (exerciseBackTarget === "muscle_balance") {
            setView("muscle_balance");
            return;
          }
          if (exerciseBackTarget === "builder") {
            setView("builder");
            return;
          }
          if (!selectedSessionId || !currentSession) {
            setView("sessions");
            return;
          }
          setView("session");
        }}
      >
        ← Back
      </button>
    );

    if (!exId || !lib) {
      return (
        <div className="app">
          <div className="page">
            <div className="headerRow">
              {backBtn}
              <div className="titleSmall">Exercise</div>
            </div>

            <div className="error">
              Exercise not found in Exercise_Library.
              <div className="muted small" style={{ marginTop: 6 }}>
                ExerciseID: <b>{exId || "—"}</b>
              </div>
            </div>
          </div>
        </div>
      );
    }

    const name = String(lib?.Name || exId);

    const inSession = !!currentRow && String(currentRow.ExerciseID || "") === exId && !!currentRow.SessionID;

    const sessionIdForLogging = inSession ? String(currentRow?.SessionID || "") : "LIBRARY";
    const sessionNameForLogging = inSession ? String(currentRow?.SessionName || currentSession?.SessionName || "") : "Exercise Library";

    const blockLabel = String(inSession ? (currentRow?.Block || lib?.Category || "") : (lib?.Category || ""));

    const isMain =
      String(blockLabel || "").toLowerCase() === "main" ||
      String(lib?.LogMode || "").toLowerCase() === "main" ||
      String(lib?.Category || "").toLowerCase() === "main";

    const routineSchemeId = String(currentRow?.ExerciseID === exId ? currentRow?.SchemeID || "" : "");
    const schemeId = String(routineSchemeId || lib?.SchemeID || "");

    const schemeRowsRaw = (schemesById[schemeId] || []) as any[];
    const schemeRows = schemeRowsRaw.filter(Boolean);

    const unit = String(lib?.Unit || currentUnit || "");
    const unitLower = unit.toLowerCase();
    const isWeighted = unitLower === "lb" || unitLower === "lbs" || unitLower === "kg" || unitLower === "kgs";

    const tm =
      toNumber(currentMaxRow?.TrainingMax) ??
      (toNumber(currentMaxRow?.OneRM) != null ? (toNumber(currentMaxRow?.OneRM) as number) * 0.9 : null);

    function repsLabelForScheme(s: any) {
      const rmin = s?.RepsMin;
      const rmax = s?.RepsMax;
      if (rmin == null && rmax == null) return "";
      if (String(rmin) && String(rmax) && String(rmin) === String(rmax)) return String(rmin);
      if (String(rmin) && String(rmax)) return `${rmin}-${rmax}`;
      return String(rmin || rmax || "");
    }

    function plannedWeightNumber(s: any) {
      const pct = toNumber(s?.PctTM);
      if (pct == null || tm == null) return "";

      const raw = (tm as number) * (pct as number);
      const step = toNumber(s?.RoundTo);

      let rounded: number;
      if (step != null && step > 0) {
        rounded = Math.round(raw / step) * step;
      } else {
        rounded = Math.round(raw);
      }

      return String(fmtWeight(rounded)).trim();
    }

    function getSetIndex(s: any, fallback: number) {
      const v = s?.SetIndex ?? s?.SetNumber ?? s?.Set ?? s?.Index ?? s?.Order ?? fallback;
      const n = Number(v);
      return isFinite(n) && n > 0 ? n : fallback;
    }

    const doneKey = keyDone(workoutDate, sessionIdForLogging, exId);
    const isDone = !!doneMap[doneKey];

    async function autoLogAllSets() {
      if (!schemeRows.length) return;

      for (let i = 0; i < schemeRows.length; i++) {
        const s = schemeRows[i];

        const setIndex = getSetIndex(s, i + 1);
        const repsPlanned = repsLabelForScheme(s);
        const wtPlannedNum = plannedWeightNumber(s);

        const k = keyLog(workoutDate, sessionIdForLogging, exId, setIndex);
        const cur = logInputs[k] || { reps: "", weight: "" };

        const actualReps = String(cur.reps || repsPlanned || "").trim();
        const actualWeight = isWeighted ? String(cur.weight || wtPlannedNum || "").trim() : "";

        setLogInputs((m) => ({ ...m, [k]: { ...cur, saving: true, error: "", saved: false } }));

        try {
          await postLogSet({
            date: workoutDate,
            routineId: routineId,
            sessionId: sessionIdForLogging,
            sessionName: sessionNameForLogging,
            exerciseId: exId,
            exerciseName: name,
            setNumber: setIndex,
            prescribedReps: repsPlanned,
            prescribedWeight: wtPlannedNum,
            actualReps: actualReps,
            actualWeight: actualWeight,
          });

          setLogInputs((m) => ({ ...m, [k]: { ...m[k], saving: false, saved: true, error: "" } }));
        } catch (e: any) {
          setLogInputs((m) => ({
            ...m,
            [k]: { ...m[k], saving: false, saved: false, error: String(e?.message || e) },
          }));
        }
      }
    }

    const estW = toNumber(oneRMEstWeight);
    const estR = toNumber(oneRMEstReps);
    const estOneRM = estW != null && estR != null && estW > 0 && estR > 0 ? estW * (1 + estR / 30) : null;

    const canTryNextGif = gifTryIndex + 1 < gifSources.length;

    return (
      <div className="app">
        <div className="page">
          <div className="headerRow">
            {backBtn}
            <div className="titleSmall">{currentSession?.SessionName || "Exercise"}</div>
          </div>

          <div className="title">{name}</div>
          <div className="muted" style={{ marginBottom: 10 }}>
            {blockLabel}
          </div>

          {lib?.Notes ? <div className="noteBox">{String(lib.Notes)}</div> : null}

          {!schemeRows.length ? (
            <div className="error" style={{ marginTop: 12 }}>
              No scheme found for this exercise.
              <div className="muted small" style={{ marginTop: 6 }}>
                Set <b>Exercise_Library.SchemeID</b> for <b>{exId}</b> to a valid scheme in Set_Schemes.
              </div>
            </div>
          ) : (
            <div className="sets">
              {schemeRows.map((s: any, i: number) => {
                const setIndex = getSetIndex(s, i + 1);
                const setLabel = String(s?.SetLabel || `Set ${setIndex}`);

                const repsPlanned = repsLabelForScheme(s);
                const wtPlannedNum = plannedWeightNumber(s);

                const k = keyLog(workoutDate, sessionIdForLogging, exId, setIndex);
                const cur = logInputs[k] || { reps: "", weight: "" };

                const repsValue = cur.reps || repsPlanned || "";
                const weightValue = cur.weight || wtPlannedNum || "";

                return (
                  <div key={`${exId}-${setIndex}`} className="setRow">
                    <div className="setLeft">
                      <div className="setLabel">{setLabel}</div>
                      <div className="setMeta">
                        {repsPlanned ? `Reps: ${repsPlanned}` : "Reps: —"}
                        {wtPlannedNum ? ` • Planned: ${wtPlannedNum}` : ""}
                      </div>
                    </div>

                    <div className="setRight">
                      <input
                        className="miniInput"
                        placeholder="reps"
                        value={repsValue}
                        onChange={(e) => setLogField(k, "reps", e.target.value)}
                      />

                      {isWeighted ? (
                        <input
                          className="miniInput"
                          placeholder={unit || "wt"}
                          value={weightValue}
                          onChange={(e) => setLogField(k, "weight", e.target.value)}
                        />
                      ) : null}

                      <button
                        className="pill small"
                        disabled={!!cur.saving}
                        onClick={() =>
                          saveAnySet({
                            exId,
                            exName: name,
                            sessionId: sessionIdForLogging,
                            sessionName: sessionNameForLogging,
                            setIndex,
                            prescribedReps: repsPlanned,
                            prescribedWeight: wtPlannedNum,
                          })
                        }
                      >
                        {cur.saving ? "Saving…" : "Save"}
                      </button>

                      {cur.saved ? <span className="chip chipDone">SAVED</span> : null}
                      {cur.error ? <span className="chip chipMajor">ERR</span> : null}
                    </div>

                    {cur.error ? (
                      <div className="error small" style={{ marginTop: 8 }}>
                        {cur.error}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="navRow">
            <button
              className={`pill ${isDone ? "pillDone" : ""}`}
              onClick={async () => {
                const next = !isDone;
                setDoneMap((m) => ({ ...m, [doneKey]: next }));

                if (next) {
                  await autoLogAllSets();
                }
              }}
            >
              {isDone ? "✅ Done" : isMain ? "Auto log all sets (optional)" : "Mark ✅ Done (auto log all sets)"}
            </button>
          </div>

          {isWeighted ? (
            <div className="noteBox" style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>1RM</div>
              <div className="muted small" style={{ marginBottom: 8 }}>
                Current 1RM: {currentOneRM != null ? fmtWeight(currentOneRM, unit) : "—"} • TM:{" "}
                {currentTM != null ? fmtWeight(currentTM, unit) : "—"}
              </div>

              <div className="setRight" style={{ marginTop: 0 }}>
                <input
                  className="miniInput"
                  placeholder={`weight (${unit})`}
                  value={oneRMEstWeight}
                  onChange={(e) => setOneRMEstWeight(e.target.value)}
                />
                <input className="miniInput" placeholder="reps" value={oneRMEstReps} onChange={(e) => setOneRMEstReps(e.target.value)} />
                <span className="chip">Est: {estOneRM != null ? fmtWeight(estOneRM, unit) : "—"}</span>
              </div>

              <div className="setRight">
                <button
                  className="pill small"
                  disabled={estOneRM == null}
                  onClick={() => {
                    if (estOneRM == null) return;
                    setOneRMInput(String(Math.round(estOneRM)));
                    setOneRMSaved(false);
                    setOneRMError("");
                  }}
                >
                  Set 1RM = Est
                </button>

                <input className="miniInput" placeholder={`1RM (${unit})`} value={oneRMInput} onChange={(e) => setOneRMInput(e.target.value)} />

                <button className="pill small" disabled={oneRMSaving || !exId} onClick={() => saveOneRM(exId)}>
                  {oneRMSaving ? "Saving…" : "Save 1RM"}
                </button>

                {oneRMSaved ? <span className="chip chipDone">SAVED</span> : null}
              </div>

              {oneRMError ? (
                <div className="error small" style={{ marginTop: 8 }}>
                  {oneRMError}
                </div>
              ) : null}
            </div>
          ) : null}

          {rawGif ? (
            <div className="gifWrap">
              <div className="muted small">Demo</div>

              {gifSrc ? (
                <img
                  className="gifImg"
                  src={gifSrc}
                  alt={`${name} demo`}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (canTryNextGif) setGifTryIndex((i) => i + 1);
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {inSession ? (
            <div className="navRow">
              <button className="pill small" onClick={() => goPrevExercise(sessionExercises.length)} disabled={selectedExerciseIndex <= 0}>
                ← Prev
              </button>
              <button className="pill small" onClick={() => goNextExercise(sessionExercises.length)} disabled={selectedExerciseIndex >= sessionExercises.length - 1}>
                Next →
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  /* =========================================================
     ## SAFETY FALLBACK ##
     ========================================================= */
  return (
    <div className="app">
      <div className="page">
        <div className="title">Workout</div>
        <div className="error">Unknown view state. Resetting…</div>
        <button className="pill" onClick={() => setView("sessions")}>
          ← Sessions
        </button>
      </div>
    </div>
  );
}