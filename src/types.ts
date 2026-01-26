/* =========================================================
   FILE: src/types.ts
   FULL FILE REPLACEMENT
   ========================================================= */

export type RoutineRow = {
  RoutineID: string;
  RoutineName?: string;
  Notes?: string;
};

export type RoutineSession = {
  RoutineID: string;
  SessionID: string;
  SessionName?: string;
  Notes?: string;
};

export type RoutineExercise = {
  RoutineID: string;
  SessionID: string;
  SessionName?: string;
  Order?: number | string;
  Block?: string;
  ExerciseID: string;
  SchemeID?: string;
  Notes?: string;
};

export type ExerciseLibraryRow = {
  ExerciseID: string;
  Name?: string;
  Category?: string;
  SwapGroup?: string;
  LogMode?: string;
  Unit?: string;
  VideoURL?: string;
  GifURL?: string;
  Notes?: string;
};

export type SetSchemeRow = {
  SchemeID: string;
  SetIndex?: number | string;
  SetLabel?: string;
  RepsMin?: number | string;
  RepsMax?: number | string;
  PctTM?: number | string;
  RoundTo?: number | string;
};

export type UserMaxRow = {
  UserID?: string;
  ExerciseID: string;
  OneRM?: number | string;
  TrainingMax?: number | string;
  Unit?: string;
};

export type ExerciseTagRow = {
  ExerciseID: string;
  MovementPattern?: string;
  PrimaryMuscle?: string;
  SecondaryMuscle?: string;
};

export type BootstrapResponse = {
  success: boolean;
  error?: string;

  routine?: RoutineRow;
  sessions?: RoutineSession[];
  exercises?: RoutineExercise[];
  library?: ExerciseLibraryRow[];
  schemes?: SetSchemeRow[];
  maxes?: UserMaxRow[];

  // NEW
  tags?: ExerciseTagRow[];
};
