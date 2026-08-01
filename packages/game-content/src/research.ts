import type { TroopColor } from "../../game-core/src";
import { ACTIVE_CONTENT_PACK } from ".";

export const CONTENT_REVIEW_SCHEMA_VERSION = 1;

export type ReviewScore = 1 | 2 | 3 | 4 | 5;

export type ContentReviewDraft = Readonly<{
  clarity?: ReviewScore;
  distinctiveness?: ReviewScore;
  themeFit?: ReviewScore;
  memorableTroop?: TroopColor;
  confusingTerm: string;
  notes: string;
}>;

export type ContentReviewExport = Readonly<{
  schemaVersion: typeof CONTENT_REVIEW_SCHEMA_VERSION;
  researchRoundId: string;
  contentPackId: string;
  contentPackVersion: string;
  submittedAt: string;
  response: ContentReviewDraft;
}>;

const SCORE_KEYS = ["clarity", "distinctiveness", "themeFit"] as const;

export const isCompleteContentReview = (draft: ContentReviewDraft): boolean =>
  SCORE_KEYS.every((key) => draft[key] !== undefined);

export const createContentReviewExport = (
  draft: ContentReviewDraft,
  submittedAt = new Date().toISOString(),
): ContentReviewExport => {
  if (!isCompleteContentReview(draft)) {
    throw new Error("CONTENT_REVIEW_INCOMPLETE");
  }
  return {
    schemaVersion: CONTENT_REVIEW_SCHEMA_VERSION,
    researchRoundId: ACTIVE_CONTENT_PACK.research.roundId,
    contentPackId: ACTIVE_CONTENT_PACK.id,
    contentPackVersion: ACTIVE_CONTENT_PACK.version,
    submittedAt,
    response: {
      ...draft,
      confusingTerm: draft.confusingTerm.trim(),
      notes: draft.notes.trim(),
    },
  };
};

export const serializeContentReview = (review: ContentReviewExport): string =>
  `${JSON.stringify(review, null, 2)}\n`;
