// Carry the source node's kind on a notification so the bell can show the real resource logo
// (e.g. the AWS RDS mark) instead of a generic icon. Nullable + backfilled from the change
// timeline on the next feed sync; older rows simply fall back to the severity icon.

export const up: string[] = [
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS node_kind text`,
  // Backfill existing health notifications from the change timeline (dedupe_key = 'health:<eventId>').
  `UPDATE notifications nt
      SET node_kind = n.kind
     FROM node_events e
     JOIN nodes n ON n.id = e.node_id
    WHERE nt.dedupe_key = 'health:' || e.id
      AND nt.node_kind IS NULL`,
];

export const down: string[] = [`ALTER TABLE notifications DROP COLUMN IF EXISTS node_kind`];
