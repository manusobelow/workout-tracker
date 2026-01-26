/* =========================================================
   FILE: src/logic.ts
   FULL FILE REPLACEMENT
   ========================================================= */

import type { ExerciseLibraryRow, RoutineExercise, SetSchemeRow, UserMaxRow } from "./types";

/** number-ish -> number | null */
export function toNumber(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/**
 * fmtWeight
 * - Backwards compatible:
 *   - fmtWeight(123) works
 *   - fmtWeight(123, "lb") also works
 */
export function fmtWeight(n: number, unit?: string): string {
  if (!isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  const s = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  const u = String(unit || "").trim();
  return u ? `${s} ${u}` : s;
}

/** identifies "major" lifts for logging */
export function isMajor(lib: any, notes?: string): boolean {
  const lm = String(lib?.LogMode || "").toLowerCase();
  if (lm === "major") return true;
  const s = String(notes || "").toLowerCase();
  // allow your sheet note "major" to force major behavior
  if (s.includes("log sets")) return true;
  return false;
}

/** stable sort by Order then ExerciseID */
export function sortedSessionExercises(all: RoutineExercise[], sessionId: string): RoutineExercise[] {
  const sid = String(sessionId || "");
  return (all || [])
    .filter((r) => String(r.SessionID) === sid)
    .slice()
    .sort((a, b) => {
      const ao = Number(a.Order ?? 0);
      const bo = Number(b.Order ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a.ExerciseID || "").localeCompare(String(b.ExerciseID || ""));
    });
}

/** index builder used by App */
export function buildIndexes(opts: {
  library?: ExerciseLibraryRow[] | any;
  maxes?: UserMaxRow[] | any;
  schemes?: SetSchemeRow[] | any;
}) {
  const libArr = (opts.library || []) as any[];
  const maxArr = (opts.maxes || []) as any[];
  const schArr = (opts.schemes || []) as any[];

  const libraryById: Record<string, any> = {};
  for (const r of libArr) {
    const id = String(r?.ExerciseID || "").trim();
    if (!id) continue;
    libraryById[id] = r;
  }

  const maxById: Record<string, any> = {};
  for (const r of maxArr) {
    const id = String(r?.ExerciseID || "").trim();
    if (!id) continue;
    maxById[id] = r;
  }

  const schemesById: Record<string, any[]> = {};
  for (const r of schArr) {
    const id = String(r?.SchemeID || "").trim();
    if (!id) continue;
    if (!schemesById[id]) schemesById[id] = [];
    schemesById[id].push(r);
  }

  // Sort schemes rows by SetIndex to be stable
  Object.keys(schemesById).forEach((k) => {
    schemesById[k].sort((a, b) => Number(a?.SetIndex ?? 0) - Number(b?.SetIndex ?? 0));
  });

  return { libraryById, maxById, schemesById };
}
