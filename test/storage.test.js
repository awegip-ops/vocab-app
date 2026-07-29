import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// storage.js reads/writes window.localStorage directly; Node has no DOM,
// so we install a minimal in-memory localStorage before importing it.
class MemoryStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

const Storage = await import("../js/storage.js");

beforeEach(() => {
  globalThis.localStorage.clear();
});

test("loadSrsState returns {} when nothing saved", () => {
  assert.deepEqual(Storage.loadSrsState(), {});
});

test("saveSrsState/loadSrsState round-trips", () => {
  const state = { 1: { box: 3 } };
  Storage.saveSrsState(state);
  assert.deepEqual(Storage.loadSrsState(), state);
});

test("touchStreak starts a fresh streak at count 1", () => {
  const streak = Storage.touchStreak();
  assert.equal(streak.count, 1);
  assert.equal(streak.todayReviewed, 0);
});

test("touchStreak is idempotent on the same day", () => {
  const first = Storage.touchStreak();
  const second = Storage.touchStreak();
  assert.equal(second.count, first.count);
});

test("touchStreak increments when last active was yesterday", () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  Storage.saveStreak({ count: 4, lastActiveDate: yesterday, todayReviewed: 2 });
  const streak = Storage.touchStreak();
  assert.equal(streak.count, 5);
  assert.equal(streak.todayReviewed, 0);
});

test("touchStreak resets to 1 when a day was skipped", () => {
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  Storage.saveStreak({ count: 10, lastActiveDate: twoDaysAgo, todayReviewed: 5 });
  const streak = Storage.touchStreak();
  assert.equal(streak.count, 1);
});

test("incrementTodayReviewed bumps today's counter", () => {
  Storage.touchStreak();
  Storage.incrementTodayReviewed();
  const streak = Storage.incrementTodayReviewed();
  assert.equal(streak.todayReviewed, 2);
});

test("appendCustomWords dedupes by id and reports count added", () => {
  Storage.saveCustomWords([{ id: 1, headword: "a" }]);
  const added = Storage.appendCustomWords([
    { id: 1, headword: "a-dup" },
    { id: 2, headword: "b" },
  ]);
  assert.equal(added, 1);
  const words = Storage.loadCustomWords();
  assert.equal(words.length, 2);
  assert.equal(words.find((w) => w.id === 1).headword, "a");
});
