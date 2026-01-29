/* =========================================================
   FILE: src/App.tsx
   FULL FILE REPLACEMENT ✅

   Home:
     - Muscle Balance
     - Routines

   Muscle Balance:
     ✅ Clickable SVG (front + back) with 6-stage color scale
     ✅ Tap muscle → shows ONLY exercises for that muscle
     ✅ Tap exercise → opens Exercise view

   Exercise View:
     ✅ LOGGING WORKS FOR ALL EXERCISES (Major + Accessory + Library-only)
     ✅ Uses Exercise_Library.SchemeID for scheme display
     ✅ Uses User_Maxes TM/1RM for planned weights
     ✅ Every set row has Save button

   Hard sets computed from Training_Log (boot.logs):
     Primary = 1.0, Secondary = 0.5
     Excludes WarmUp category
     Window = last 3 logged training dates for current user

   Target system:
     ✅ Last 3 sessions ≈ “proxy week”
     ✅ Goal per muscle over last 3 sessions:
        - Minimum: 10
        - Great: 20
   ========================================================= */

import { useEffect, useMemo, useState } from "react";
import "./App.css";
import type { BootstrapResponse, RoutineExercise, RoutineSession } from "./types";
import { authTest, fetchBootstrap, postLogSet, postUpdateOneRM } from "./api";
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

type View = "sessions" | "muscle_balance" | "library" | "session" | "exercise";

// ✅ used by Exercise view "Back" logic
type ExerciseBackTarget = "session" | "muscle_balance" | "library";

// ✅ Exercise Library browsing facets + stepper
type LibraryFacetKey = "MovementPattern" | "PlaneOfMotion" | "PrimaryMuscle" | "SecondaryMuscle";
type LibraryStep = "facet" | "value" | "exercise";

function normalizeView(v: any): View {
  if (v === "sessions" || v === "muscle_balance" || v === "library" || v === "session" || v === "exercise") return v;
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

function isWarmUpCategory(libRow: any): boolean {
  const cat = String(libRow?.Category || "").trim().toLowerCase();
  return cat === "warmup";
}

/**
 * Timestamp stored in sheet as:
 * "yyyy-MM-dd h:mm a"
 * Example: "2026-01-20 2:35 PM"
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
   Target: 10–20 hard sets per muscle across last 3 sessions
   gray → blue → teal → green → orange → red
   ========================================================= */
function colorForSets(sets: number): string {
  const v = Number(sets || 0);

  // 0        = gray
  // 0–4      = blue
  // 4–10     = teal
  // 10–16    = green (minimum / good)
  // 16–20    = orange (great)
  // >20      = red
  if (v <= 0) return "#6B7280"; // gray
  if (v < 4) return "#3B82F6"; // blue
  if (v < 10) return "#14B8A6"; // teal
  if (v < 16) return "#22C55E"; // green
  if (v <= 20) return "#F59E0B"; // orange
  return "#EF4444"; // red
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
// ## AUTOLOG STATE ##
const [autoLogSaving, setAutoLogSaving] = useState<boolean>(false);
const [autoLogError, setAutoLogError] = useState<string>("");
// ## AUTOLOG STATE END ##

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

  /* =========================================================
     ## SMALL HELPERS ##
     ========================================================= */
  function setLogField(k: string, field: "reps" | "weight", v: string) {
    setLogInputs((m) => ({ ...m, [k]: { ...(m[k] || { reps: "", weight: "" }), [field]: v } }));
  }

  function goPrevExercise(maxLen: number) {
    setSelectedExerciseIndex((i) => Math.max(0, Math.min(maxLen - 1, i - 1)));
  }
  function goNextExercise(maxLen: number) {
    setSelectedExerciseIndex((i) => Math.max(0, Math.min(maxLen - 1, i + 1)));
  }

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

  // ✅ Open exercise from Exercise Library filtered list
  function openExerciseFromLibrary(exId: string, list: string[], index: number) {
    const cleanId = String(exId || "").trim();
    if (!cleanId) return;

    setLibExerciseIds(Array.from(new Set((list || []).map((x) => String(x || "").trim()).filter(Boolean))));
    setLibExerciseIndex(Math.max(0, index || 0));

    setActiveExerciseId(cleanId);
    setExerciseBackTarget("library");

    // library context = not a routine session
    setSelectedSessionId("");
    setSelectedExerciseIndex(0);

    setView("exercise");
  }


  /* =========================================================
     ## BACKEND ACTIONS ##
     ✅ LOG ANY SET (major/accessory + routine/library)
     ========================================================= */
  async function saveAnySet(args: {
    exId: string;
    exName: string;
    sessionId: string;
    sessionName: string;
    setIndex: number;
    prescribedReps?: string;
    prescribedWeight?: string;
  }) {
    const { exId, exName, sessionId, sessionName, setIndex, prescribedReps, prescribedWeight } = args;

    const k = keyLog(workoutDate, sessionId, exId, setIndex);
    const cur = logInputs[k] || { reps: "", weight: "" };

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
        prescribedReps,
        prescribedWeight,
        actualReps: cur.reps,
        actualWeight: cur.weight,
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

  async function saveOneRM(exId: string) {
    const n = Number(oneRMInput);
    if (!isFinite(n) || n <= 0) {
      setOneRMError("Enter a valid number for 1RM.");
      setOneRMSaved(false);
      return;
    }

    setOneRMSaving(true);
    setOneRMError("");
    setOneRMSaved(false);

    try {
      await postUpdateOneRM({ exerciseId: exId, oneRM: n, unit: currentUnit });
      setOneRMSaved(true);

      const data = await fetchBootstrap(import.meta.env.VITE_ROUTINE_ID as any);
      if (data?.success) setBoot(data);
    } catch (e: any) {
      setOneRMError(String(e?.message || e));
    } finally {
      setOneRMSaving(false);
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

            {/* ✅ Exercise Library entry point */}
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
// FILE: src/App.tsx
// SECTION: VIEW: muscle_balance (FULL BLOCK REPLACEMENT)
// ==============================
// START MUSCLE_BALANCE VIEW REPLACEMENT

if (view === "muscle_balance") {
  const dateKeys = muscleBalance.dateKeys;

  function clickMuscle(m: string) {
    setMbSelectedMuscle((cur) => (normMuscleName(cur) === normMuscleName(m) ? "" : m));
  }

  // Map SVG tokens (inkscape:label / id) -> your Exercise_Library muscle names
  // (keep this small and expand as you add labels)
  function mapTokenToMuscle(tokenRaw: string): string {
    const t = String(tokenRaw || "").trim();
    const n = normMuscleName(t);

    const map: Record<string, string> = {
      // common label -> library muscle name
      "traps": "Upper Traps",
      "upper traps": "Upper Traps",
      "rear delts": "Rear Delts",
      "rear deltoids": "Rear Delts",
      "front delts": "Front Delts",
      "front deltoids": "Front Delts",
      "lats": "Lats",
      "upper back": "Upper Back",
      "hamstrings": "Hamstrings",
      "glutes": "Glutes",
      "quads": "Quads",
      "calves": "Calves",
      "chest": "Chest",
      "biceps": "Biceps",
      "triceps": "Triceps",
      "forearms": "Forearms",
      "adductors": "Adductors",
      "hip flexors": "Hip Flexors",
      "tibialis anterior": "Tibialis Anterior",
      "spinal erectors": "Spinal erectors",
      "rhomboids": "Rhomboids",
      "scapulae": "Scapulae",
      "teres major": "Teres Major",
    };

    // If we have a known mapping, use it.
    if (map[n]) return map[n];

    // Otherwise, just return the token itself (lets you use labels that already match library)
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

// END MUSCLE_BALANCE VIEW REPLACEMENT

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
                // exercise list
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

                        // precompute the list so Exercise view can Prev/Next through it
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

    return (
      <div className="app">
        <div className="page">
          <div className="headerRow">
            <button className="pill" onClick={() => setView("sessions")}>
              ← Sessions
            </button>
            <div className="titleSmall">{currentSession.SessionName}</div>
          </div>

          <div className="stack">
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

    if (!exId || !lib) {
      return (
        <div className="app">
          <div className="page">
           <div className="headerRow">
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
      if (!selectedSessionId || !currentSession) {
        setView("sessions");
        return;
      }
      setView("session");
    }}
  >
    ← Back
  </button>
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

    // if currentRow matches exId, we are in a Routine_Exercises session context
    const inSession =
      !!currentRow && String(currentRow.ExerciseID || "") === exId && !!currentRow.SessionID;

    // library-only fallback context
    const sessionIdForLogging = inSession ? String(currentRow?.SessionID || "") : "LIBRARY";
    const sessionNameForLogging = inSession
      ? String(currentRow?.SessionName || currentSession?.SessionName || "")
      : "Exercise Library";

    const blockLabel = String(
      inSession ? (currentRow?.Block || lib?.Category || "") : (lib?.Category || "")
    );

    // Determine "Main" vs "Non-main"
    const isMain =
      String(blockLabel || "").toLowerCase() === "main" ||
      String(lib?.LogMode || "").toLowerCase() === "main" ||
      String(lib?.Category || "").toLowerCase() === "main";

    // Scheme selection: prefer Routine_Exercises.SchemeID when in session
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

    // planned weight numeric only (no unit suffix)
    function plannedWeightNumber(s: any) {
      const pct = toNumber(s?.PctTM);
      if (pct == null || tm == null) return "";

      const raw = (tm as number) * (pct as number);
      const step = toNumber(s?.RoundTo);
      const rounded = step != null && step > 0 ? Math.round(raw / step) * step : raw;

      return String(fmtWeight(rounded)).trim();
    }

    // robust setIndex: supports multiple possible header names
    function getSetIndex(s: any, fallback: number) {
      const v =
        s?.SetIndex ??
        s?.SetNumber ??
        s?.Set ??
        s?.Index ??
        s?.Order ??
        fallback;
      const n = Number(v);
      return isFinite(n) && n > 0 ? n : fallback;
    }

    const doneKey = keyDone(workoutDate, sessionIdForLogging, exId);
    const isDone = !!doneMap[doneKey];

    // ✅ logs every set row for non-main, using either user-filled inputs OR planned defaults
    async function autoLogAllSets() {
      if (!schemeRows.length) return;

      for (let i = 0; i < schemeRows.length; i++) {
        const s = schemeRows[i];

        const setIndex = getSetIndex(s, i + 1);
        const repsPlanned = repsLabelForScheme(s);
        const wtPlannedNum = plannedWeightNumber(s);

        const k = keyLog(workoutDate, sessionIdForLogging, exId, setIndex);
        const cur = logInputs[k] || { reps: "", weight: "" };

        // ✅ if user didn't type anything, use planned values automatically
        const actualReps = String(cur.reps || repsPlanned || "").trim();
        const actualWeight = isWeighted ? String(cur.weight || wtPlannedNum || "").trim() : "";

        // show saving state
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
            prescribedWeight: wtPlannedNum, // numeric only
            actualReps: actualReps,
            actualWeight: actualWeight,
            notes: "AUTO_DONE",
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
      if (!selectedSessionId || !currentSession) {
        setView("sessions");
        return;
      }
      setView("session");
    }}
  >
    ← Back
  </button>

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

                // ✅ auto-populated defaults (but still editable)
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

                      {/* Manual save still possible (useful for Main) */}
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
                            prescribedWeight: wtPlannedNum, // numeric only
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

                  {/* ✅ Done / Auto-log button:
              - NON-MAIN: primary workflow (logs all sets)
              - MAIN: optional shortcut (still allows per-set Save) */}
          <div className="navRow">
            <button
              className={`pill ${isDone ? "pillDone" : ""}`}
              onClick={async () => {
                const next = !isDone;
                setDoneMap((m) => ({ ...m, [doneKey]: next }));

                // only auto-log when turning ON
                if (next) {
                  await autoLogAllSets();
                }
              }}
            >
              {isDone
                ? "✅ Done"
                : isMain
                ? "Auto log all sets (optional)"
                : "Mark ✅ Done (auto log all sets)"}
            </button>
          </div>


          {/* 1RM UI stays for weighted exercises */}
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
                <input
                  className="miniInput"
                  placeholder="reps"
                  value={oneRMEstReps}
                  onChange={(e) => setOneRMEstReps(e.target.value)}
                />
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

                <input
                  className="miniInput"
                  placeholder={`1RM (${unit})`}
                  value={oneRMInput}
                  onChange={(e) => setOneRMInput(e.target.value)}
                />

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

          {/* GIF */}
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
              <button
                className="pill small"
                onClick={() => goNextExercise(sessionExercises.length)}
                disabled={selectedExerciseIndex >= sessionExercises.length - 1}
              >
                Next →
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  /* =========================================================
     ## VIEW: exercise (LOG EVERYTHING) END ##
     ========================================================= */


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