import { describe, expect, it } from "vitest";

import {
  conflictFields,
  reconcile,
  type LinkState,
  type LocalState,
  type RemoteState,
} from "@/lib/sync/reconcile";

const at = (iso: string) => new Date(iso);

const local = (overrides: Partial<LocalState> = {}): LocalState => ({
  origin: "local",
  title: "Write the proposal",
  startsAt: at("2026-08-05T09:00:00.000Z"),
  endsAt: at("2026-08-05T11:00:00.000Z"),
  updatedAt: at("2026-08-05T08:00:00.000Z"),
  ...overrides,
});

const remote = (overrides: Partial<RemoteState> = {}): RemoteState => ({
  etag: '"remote-1"',
  updated: at("2026-08-05T08:00:00.000Z"),
  title: "Write the proposal",
  startsAt: at("2026-08-05T09:00:00.000Z"),
  endsAt: at("2026-08-05T11:00:00.000Z"),
  ...overrides,
});

const link = (overrides: Partial<LinkState> = {}): LinkState => ({
  gcalEtag: '"remote-1"',
  lastPushedAt: at("2026-08-05T08:00:00.000Z"),
  lastPulledAt: null,
  ...overrides,
});

describe("reconcile", () => {
  it("imports an event nothing local matches", () => {
    expect(reconcile(null, null, remote())).toEqual({ verdict: "import", conflicted: false });
  });

  it("recognises our own write coming back by its etag", () => {
    expect(reconcile(link(), local(), remote())).toEqual({ verdict: "echo", conflicted: false });
  });

  it("does not call it an echo when only one side has an etag", () => {
    // Missing either half makes the comparison meaningless, and guessing wrong
    // in this direction drops a real change on the floor.
    expect(reconcile(link({ gcalEtag: null }), local(), remote()).verdict).not.toBe("echo");
    expect(reconcile(link(), local(), remote({ etag: null })).verdict).not.toBe("echo");
  });

  it("takes Google's version when it is newer", () => {
    const resolution = reconcile(
      link({ gcalEtag: '"old"' }),
      local({ updatedAt: at("2026-08-05T08:00:00.000Z") }),
      remote({ updated: at("2026-08-05T09:30:00.000Z") }),
    );
    expect(resolution.verdict).toBe("apply");
  });

  it("keeps ours when the local edit came last", () => {
    const resolution = reconcile(
      link({ gcalEtag: '"old"' }),
      local({ updatedAt: at("2026-08-05T10:00:00.000Z") }),
      remote({ updated: at("2026-08-05T09:30:00.000Z") }),
    );
    expect(resolution.verdict).toBe("keep");
  });

  it("keeps ours when Google will not say when it changed", () => {
    // No timestamp is no evidence, and we can push ours again — the reverse is
    // an overwrite we could never undo.
    expect(reconcile(link({ gcalEtag: '"old"' }), local(), remote({ updated: null })).verdict).toBe(
      "keep",
    );
  });

  it("always yields to Google on an imported event", () => {
    // Nothing pushes an imported event back, so holding a local drag as
    // authoritative would leave the two copies apart permanently.
    const resolution = reconcile(
      link({ gcalEtag: '"old"' }),
      local({ origin: "google", updatedAt: at("2026-08-05T23:00:00.000Z") }),
      remote({ updated: at("2026-08-05T09:00:00.000Z") }),
    );
    expect(resolution).toEqual({ verdict: "apply", conflicted: true });
  });

  it("flags a conflict only when the local row moved after the last agreement", () => {
    const quiet = reconcile(
      link({ gcalEtag: '"old"', lastPushedAt: at("2026-08-05T09:00:00.000Z") }),
      local({ updatedAt: at("2026-08-05T08:00:00.000Z") }),
      remote({ updated: at("2026-08-05T10:00:00.000Z") }),
    );
    expect(quiet).toEqual({ verdict: "apply", conflicted: false });

    const contested = reconcile(
      link({ gcalEtag: '"old"', lastPushedAt: at("2026-08-05T09:00:00.000Z") }),
      local({ updatedAt: at("2026-08-05T09:30:00.000Z") }),
      remote({ updated: at("2026-08-05T10:00:00.000Z") }),
    );
    expect(contested).toEqual({ verdict: "apply", conflicted: true });
  });

  it("measures agreement from whichever of push and pull happened later", () => {
    const resolution = reconcile(
      link({
        gcalEtag: '"old"',
        lastPushedAt: at("2026-08-05T07:00:00.000Z"),
        lastPulledAt: at("2026-08-05T10:00:00.000Z"),
      }),
      local({ updatedAt: at("2026-08-05T09:00:00.000Z") }),
      remote({ updated: at("2026-08-05T11:00:00.000Z") }),
    );
    expect(resolution.conflicted).toBe(false);
  });

  it("cannot call it a conflict with no link to date it against", () => {
    expect(reconcile(null, local(), remote()).conflicted).toBe(false);
  });
});

describe("conflictFields", () => {
  it("says nothing when the two copies agree", () => {
    expect(conflictFields(local(), remote())).toEqual([]);
  });

  it("records each field that differs, both sides", () => {
    expect(conflictFields(local(), remote({ title: "Proposal review" }))).toEqual([
      { field: "title", localValue: "Write the proposal", remoteValue: "Proposal review" },
    ]);
  });

  it("compares times as instants, not as objects", () => {
    const fields = conflictFields(
      local(),
      remote({
        startsAt: at("2026-08-05T10:00:00.000Z"),
        endsAt: at("2026-08-05T11:00:00.000Z"),
      }),
    );
    expect(fields).toEqual([
      {
        field: "starts_at",
        localValue: "2026-08-05T09:00:00.000Z",
        remoteValue: "2026-08-05T10:00:00.000Z",
      },
    ]);
  });
});
