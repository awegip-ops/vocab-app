import { test } from "node:test";
import assert from "node:assert/strict";
import * as SRS from "../js/srs.js";

test("createInitialRecord starts at box 1 with no review history", () => {
  const rec = SRS.createInitialRecord(42);
  assert.equal(rec.wordId, 42);
  assert.equal(rec.box, 1);
  assert.equal(rec.reviewCount, 0);
  assert.equal(rec.lastQuality, null);
});

test("review(quality<3) resets to box 1 regardless of current box", () => {
  const rec = { wordId: 1, box: 5, reviewCount: 3, lastQuality: 5, lastReviewed: null };
  const next = SRS.review(rec, 0);
  assert.equal(next.box, 1);
  assert.equal(next.reviewCount, 4);
  assert.equal(next.lastQuality, 0);
});

test("review(quality===3) lowers box by 1, floored at 1", () => {
  assert.equal(SRS.review({ box: 3, reviewCount: 0 }, 3).box, 2);
  assert.equal(SRS.review({ box: 1, reviewCount: 0 }, 3).box, 1);
});

test("review(quality===4) raises box by 1, capped at 5", () => {
  assert.equal(SRS.review({ box: 3, reviewCount: 0 }, 4).box, 4);
  assert.equal(SRS.review({ box: 5, reviewCount: 0 }, 4).box, 5);
});

test("review(quality===5) raises box by 2, capped at 5", () => {
  assert.equal(SRS.review({ box: 2, reviewCount: 0 }, 5).box, 4);
  assert.equal(SRS.review({ box: 4, reviewCount: 0 }, 5).box, 5);
});

test("isMastered requires box 5 and at least 2 reviews", () => {
  assert.equal(SRS.isMastered(null), false);
  assert.equal(SRS.isMastered({ box: 5, reviewCount: 1 }), false);
  assert.equal(SRS.isMastered({ box: 5, reviewCount: 2 }), true);
  assert.equal(SRS.isMastered({ box: 4, reviewCount: 10 }), false);
});

test("repeatCountForBox weights lower boxes more heavily", () => {
  assert.equal(SRS.repeatCountForBox(1), 5);
  assert.equal(SRS.repeatCountForBox(2), 3);
  assert.equal(SRS.repeatCountForBox(3), 2);
  assert.equal(SRS.repeatCountForBox(4), 1);
});

test("repeatCountForBox(5) is probabilistic between 0 and 1", () => {
  for (let i = 0; i < 50; i++) {
    const n = SRS.repeatCountForBox(5);
    assert.ok(n === 0 || n === 1, `expected 0 or 1, got ${n}`);
  }
});
