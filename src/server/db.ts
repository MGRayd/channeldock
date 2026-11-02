import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type Channel = {
  id: number;
  name: string;
  number: number;
  sourceType: "plex-collection" | "plex-selection";
  sourceId: string;
  sourceTitle: string;
  libraryId: string;
  libraryTitle: string;
  playbackOrder: "shuffle" | "sequential";
  logoRatingKey: string | null;
  customLogoPath: string | null;
  isActive: boolean;
  createdAt: string;
};

export type ChannelItem = { ratingKey: string; title: string; type: string; leafCount: number | null };

const dataDirectory = process.env.DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(dataDirectory, { recursive: true });

const database = new Database(join(dataDirectory, "channeldock.db"));
database.pragma("journal_mode = WAL");

database.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    number INTEGER NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_title TEXT NOT NULL,
    library_id TEXT NOT NULL,
    library_title TEXT NOT NULL,
    playback_order TEXT NOT NULL DEFAULT 'shuffle',
    logo_rating_key TEXT,
    custom_logo_path TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS channel_items (
    channel_id INTEGER NOT NULL,
    rating_key TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    leaf_count INTEGER,
    PRIMARY KEY (channel_id, rating_key),
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
  );
`);

const channelColumns = database.prepare("PRAGMA table_info(channels)").all() as Array<{ name: string }>;
if (!channelColumns.some((column) => column.name === "logo_rating_key")) {
  database.exec("ALTER TABLE channels ADD COLUMN logo_rating_key TEXT");
}
if (!channelColumns.some((column) => column.name === "custom_logo_path")) {
  database.exec("ALTER TABLE channels ADD COLUMN custom_logo_path TEXT");
}
if (!channelColumns.some((column) => column.name === "is_active")) {
  database.exec("ALTER TABLE channels ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
}
const channelItemColumns = database.prepare("PRAGMA table_info(channel_items)").all() as Array<{ name: string }>;
if (!channelItemColumns.some((column) => column.name === "leaf_count")) {
  database.exec("ALTER TABLE channel_items ADD COLUMN leaf_count INTEGER");
}

const channelSelect = `SELECT id, name, number, source_type AS sourceType, source_id AS sourceId,
  source_title AS sourceTitle, library_id AS libraryId, library_title AS libraryTitle,
  playback_order AS playbackOrder, logo_rating_key AS logoRatingKey, custom_logo_path AS customLogoPath,
  is_active AS isActive, created_at AS createdAt FROM channels`;

type ChannelRow = Omit<Channel, "isActive"> & { isActive: number };
const mapChannel = (row: ChannelRow): Channel => ({ ...row, isActive: Boolean(row.isActive) });

export function getSetting(key: string): string | undefined {
  const row = database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  database
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function listChannels(): Channel[] {
  return (database
    .prepare(`${channelSelect} ORDER BY number`)
    .all() as ChannelRow[]).map(mapChannel);
}

export function getChannel(id: number): Channel | undefined {
  const row = database
    .prepare(`${channelSelect} WHERE id = ?`)
    .get(id) as ChannelRow | undefined;
  return row ? mapChannel(row) : undefined;
}

export function getChannelByNumber(number: number): Channel | undefined {
  const row = database
    .prepare(`${channelSelect} WHERE number = ?`)
    .get(number) as ChannelRow | undefined;
  return row ? mapChannel(row) : undefined;
}

export function getChannelItems(channelId: number): ChannelItem[] {
  return database.prepare("SELECT rating_key AS ratingKey, title, type, leaf_count AS leafCount FROM channel_items WHERE channel_id = ? ORDER BY rowid").all(channelId) as ChannelItem[];
}

type ChannelWrite = Omit<Channel, "id" | "createdAt" | "customLogoPath">;

export function createChannel(input: ChannelWrite, items: ChannelItem[] = []): Channel {
  return database.transaction(() => {
    const result = database.prepare(`INSERT INTO channels
      (name, number, source_type, source_id, source_title, library_id, library_title, playback_order, logo_rating_key, is_active)
      VALUES (@name, @number, @sourceType, @sourceId, @sourceTitle, @libraryId, @libraryTitle, @playbackOrder, @logoRatingKey, @isActive)`).run({ ...input, isActive: input.isActive ? 1 : 0 });
    const channelId = Number(result.lastInsertRowid);
    const insertItem = database.prepare("INSERT INTO channel_items (channel_id, rating_key, title, type, leaf_count) VALUES (?, ?, ?, ?, ?)");
    for (const item of items) insertItem.run(channelId, item.ratingKey, item.title, item.type, item.leafCount);
    return mapChannel(database.prepare(`${channelSelect} WHERE id = ?`).get(channelId) as ChannelRow);
  })();
}

export function updateChannel(id: number, input: ChannelWrite, items: ChannelItem[] = []): Channel | undefined {
  return database.transaction(() => {
    const result = database.prepare(`UPDATE channels SET
      name = @name, number = @number, source_type = @sourceType, source_id = @sourceId,
      source_title = @sourceTitle, library_id = @libraryId, library_title = @libraryTitle,
      playback_order = @playbackOrder, logo_rating_key = @logoRatingKey, is_active = @isActive
      WHERE id = @id`).run({ id, ...input, isActive: input.isActive ? 1 : 0 });
    if (result.changes === 0) return undefined;
    database.prepare("DELETE FROM channel_items WHERE channel_id = ?").run(id);
    const insertItem = database.prepare("INSERT INTO channel_items (channel_id, rating_key, title, type, leaf_count) VALUES (?, ?, ?, ?, ?)");
    for (const item of items) insertItem.run(id, item.ratingKey, item.title, item.type, item.leafCount);
    return mapChannel(database.prepare(`${channelSelect} WHERE id = ?`).get(id) as ChannelRow);
  })();
}

export function setChannelCustomLogo(id: number, path: string): Channel | undefined {
  if (database.prepare("UPDATE channels SET custom_logo_path = ? WHERE id = ?").run(path, id).changes === 0) return undefined;
  return getChannel(id);
}

export function setChannelActive(id: number, active: boolean): Channel | undefined {
  if (database.prepare("UPDATE channels SET is_active = ? WHERE id = ?").run(active ? 1 : 0, id).changes === 0) return undefined;
  return getChannel(id);
}

export function deleteChannel(id: number): boolean {
  return database.transaction(() => {
    database.prepare("DELETE FROM channel_items WHERE channel_id = ?").run(id);
    return database.prepare("DELETE FROM channels WHERE id = ?").run(id).changes > 0;
  })();
}
