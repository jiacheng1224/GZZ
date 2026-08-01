import { describe, expect, it } from "vitest";
import {
  CONTENT_REVIEW_SCHEMA_VERSION,
  createContentReviewExport,
  isCompleteContentReview,
  serializeContentReview,
} from "./research";

const completeDraft = {
  clarity: 4,
  distinctiveness: 5,
  themeFit: 4,
  memorableTroop: "red",
  confusingTerm: "  中枢令  ",
  notes: "  六旌容易记住。  ",
} as const;

describe("M16-B content research export", () => {
  it("requires all three scored dimensions", () => {
    expect(
      isCompleteContentReview({ ...completeDraft, clarity: undefined }),
    ).toBe(false);
    expect(isCompleteContentReview(completeDraft)).toBe(true);
  });

  it("creates a traceable, normalized export", () => {
    const review = createContentReviewExport(
      completeDraft,
      "2026-08-02T00:00:00.000Z",
    );
    expect(review.schemaVersion).toBe(CONTENT_REVIEW_SCHEMA_VERSION);
    expect(review.researchRoundId).toBe("m16-b-01");
    expect(review.contentPackVersion).toBe("0.3.0-m16d");
    expect(review.response.confusingTerm).toBe("中枢令");
    expect(review.response.notes).toBe("六旌容易记住。");
    expect(serializeContentReview(review)).toMatch(/"clarity": 4/);
  });

  it("rejects incomplete exports", () => {
    expect(() =>
      createContentReviewExport({
        clarity: 4,
        confusingTerm: "",
        notes: "",
      }),
    ).toThrow("CONTENT_REVIEW_INCOMPLETE");
  });
});
