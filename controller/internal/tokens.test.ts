import { describe, expect, it, vi } from "vitest";
import { RunTokenStore } from "./tokens.ts";

describe("RunTokenStore", () => {
  it("mints a distinct token and resolves it to its run", () => {
    const store = new RunTokenStore();
    const log = vi.fn();

    const first = store.mint({ id: "run-1", commit: "abc", log });
    const second = store.mint({ id: "run-2", commit: "def" });

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(store.resolve(first)).toMatchObject({ id: "run-1", commit: "abc" });
    expect(store.resolve(second)).toMatchObject({ id: "run-2", commit: "def" });
    expect(store.size).toBe(2);
  });

  it("does not resolve unknown, revoked or expired tokens", () => {
    vi.useFakeTimers();
    try {
      const store = new RunTokenStore();
      const revoked = store.mint({ id: "run-1", commit: "abc" });
      const expiring = store.mint({ id: "run-2", commit: "def", ttlMs: 1_000 });

      expect(store.resolve("nope")).toBeNull();
      expect(store.revoke(revoked)).toBe(true);
      expect(store.resolve(revoked)).toBeNull();

      expect(store.resolve(expiring)).not.toBeNull();
      vi.advanceTimersByTime(1_001);
      expect(store.resolve(expiring)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prunes expired entries", () => {
    vi.useFakeTimers();
    try {
      const store = new RunTokenStore();
      store.mint({ id: "run-1", commit: "abc", ttlMs: 10 });
      store.mint({ id: "run-2", commit: "def" });

      vi.advanceTimersByTime(11);
      store.prune();

      expect(store.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
