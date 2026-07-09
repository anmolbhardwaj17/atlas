// Where an AI conversation was started (docs/04 §ai_conversations). The Ask Atlas history mixes
// chats begun on the Ask page with ones begun from the map's docked chat; `origin` lets the UI mark
// the latter with a "Map" badge. Additive + safe: existing rows default to 'ask'; chats the map
// created before this migration were titled "Map · …", so we backfill those to 'map'.
export const up: string[] = [
  `ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'ask'`,
  `ALTER TABLE ai_conversations DROP CONSTRAINT IF EXISTS ai_conversations_origin_check`,
  `ALTER TABLE ai_conversations
     ADD CONSTRAINT ai_conversations_origin_check CHECK (origin IN ('ask','map'))`,
  `UPDATE ai_conversations SET origin = 'map' WHERE title LIKE 'Map · %'`,
];

export const down: string[] = [
  `ALTER TABLE ai_conversations DROP CONSTRAINT IF EXISTS ai_conversations_origin_check`,
  `ALTER TABLE ai_conversations DROP COLUMN IF EXISTS origin`,
];
