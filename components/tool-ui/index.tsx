"use client";

import type { FC } from "react";
import { CorrectProblemToolUI, DiagnosisToolUI } from "./DiagnosisCard";
import { QuizGradeToolUI, ShuffleGradeToolUI } from "./GradeCard";
import { ApproveMethodLineToolUI, RejectMethodLineToolUI } from "./MethodLineApprovalCard";
import { QuizQuestionToolUI } from "./QuizQuestionCard";
import { ShuffleProblemToolUI } from "./ShuffleProblemCard";

export { CorrectProblemToolUI, DiagnosisCard, DiagnosisToolUI } from "./DiagnosisCard";
export { GradeCard, PROGRESS_EVENT, QuizGradeToolUI, ShuffleGradeToolUI } from "./GradeCard";
export {
  ApproveMethodLineToolUI,
  MethodLineApprovalCard,
  RejectMethodLineToolUI,
} from "./MethodLineApprovalCard";
export { QuizQuestionCard, QuizQuestionToolUI } from "./QuizQuestionCard";
export { ShuffleProblemCard, ShuffleProblemToolUI } from "./ShuffleProblemCard";

/** Render inside an AssistantRuntimeProvider: each one registers its card for a tool name. */
export const QuizToolUIs: FC = () => (
  <>
    <QuizQuestionToolUI />
    <QuizGradeToolUI />
  </>
);

export const LogToolUIs: FC = () => (
  <>
    <DiagnosisToolUI />
    <ApproveMethodLineToolUI />
    <RejectMethodLineToolUI />
    <CorrectProblemToolUI />
  </>
);

export const ShuffleToolUIs: FC = () => (
  <>
    <ShuffleProblemToolUI />
    <ShuffleGradeToolUI />
  </>
);
