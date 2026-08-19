/**
 * Who wins when the same event changed in both places.
 *
 * Until now the inbound sync simply refused to look at anything carrying our
 * id, which made every edit made in Google Calendar to a block we created
 * invisible here. Reading them means deciding, every time, whether what Google
 * is showing us is our own write coming back or somebody else's change.
 *
 * Pure and database-free on purpose: this is the arithmetic that is easy to get
 * quietly wrong, and getting it wrong either loses an edit or starts a loop.
 */

/** What to do with one remote event. */
export type Verdict =
  /** Nothing local matches it. Create the row. */
  | "import"
  /** Google's version is authoritative. Overwrite the scheduling fields. */
  | "apply"
  /** Ours is newer. Leave the row alone and send it to Google again. */
  | "keep"
  /** This is our own write coming back. Do nothing at all. */
  | "echo"
  /** Deleted here. Leave the tombstone alone and do not draw it again. */
  | "withdraw";

export type LinkState = {
  gcalEtag: string | null;
  lastPushedAt: Date | null;
  lastPulledAt: Date | null;
};

export type LocalState = {
  origin: "local" | "google";
  title: string;
  startsAt: Date;
  endsAt: Date;
  updatedAt: Date;
  /** Set once the user deleted it here. Outranks anything Google is showing. */
  deletedAt: Date | null;
};

export type RemoteState = {
  etag: string | null;
  updated: Date | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
};

export type Resolution = {
  verdict: Verdict;
  /** Both sides moved since they last agreed. Worth a `sync_conflicts` row. */
  conflicted: boolean;
};

export function reconcile(
  link: LinkState | null,
  local: LocalState | null,
  remote: RemoteState,
): Resolution {
  if (!local) return { verdict: "import", conflicted: false };

  // The etag is the exact test, and it is why this runs before any clock
  // comparison. Google mints a new one on every mutation, so an etag equal to
  // the one we stored means this is byte-for-byte the version we last wrote or
  // last read — not a change at all. Comparing timestamps here instead would
  // make our own push look like a remote edit a second after we made it.
  if (link?.gcalEtag && remote.etag && link.gcalEtag === remote.etag) {
    return { verdict: "echo", conflicted: false };
  }

  // A tombstone outranks whatever Google is still showing. Either the
  // withdrawal has not reached Google yet or it was refused; either way the user
  // deleted this block, and re-importing it is precisely how a deleted block
  // came back every five minutes forever. Checked below the etag so our own
  // delete coming back still reads as an echo, and above the `origin` line
  // because imported events are the ones that resurrected most reliably.
  if (local.deletedAt) return { verdict: "withdraw", conflicted: false };

  const conflicted = changedSinceAgreement(link, local);

  // An imported event's schedule is Google's to own — we never push it back, so
  // treating a local drag as authoritative would strand the two copies apart
  // with no way to reconcile. The drag is still recorded as a conflict, so the
  // overwrite is visible rather than silent.
  if (local.origin === "google") return { verdict: "apply", conflicted };

  // Last write wins, across two clocks that are not the same clock. Google's
  // `updated` and our `updated_at` can be a second or two apart, which is
  // immaterial next to the human gap between two people editing one event.
  const remoteNewer = remote.updated !== null && remote.updated > local.updatedAt;
  return { verdict: remoteNewer ? "apply" : "keep", conflicted };
}

/**
 * The last moment the two copies were known to match: whichever of the push and
 * the pull happened later. A local edit after that point is a real divergence;
 * one before it is already accounted for.
 */
function changedSinceAgreement(link: LinkState | null, local: LocalState): boolean {
  if (!link) return false;
  const times = [link.lastPushedAt, link.lastPulledAt].filter((t): t is Date => t !== null);
  if (times.length === 0) return false;
  const agreedAt = Math.max(...times.map((t) => t.getTime()));
  return local.updatedAt.getTime() > agreedAt;
}

export type ConflictField = {
  field: string;
  localValue: string;
  remoteValue: string;
};

/**
 * What actually differed, for the audit log.
 *
 * Only the fields Google and this app both own. The body is never compared
 * because Google has never been sent it and cannot have changed it.
 */
export function conflictFields(local: LocalState, remote: RemoteState): ConflictField[] {
  const fields: ConflictField[] = [];

  if (local.title !== remote.title) {
    fields.push({ field: "title", localValue: local.title, remoteValue: remote.title });
  }
  if (local.startsAt.getTime() !== remote.startsAt.getTime()) {
    fields.push({
      field: "starts_at",
      localValue: local.startsAt.toISOString(),
      remoteValue: remote.startsAt.toISOString(),
    });
  }
  if (local.endsAt.getTime() !== remote.endsAt.getTime()) {
    fields.push({
      field: "ends_at",
      localValue: local.endsAt.toISOString(),
      remoteValue: remote.endsAt.toISOString(),
    });
  }

  return fields;
}
