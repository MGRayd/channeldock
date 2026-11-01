import { getChannelItems, type Channel } from "./db.js";
import { getCollectionItems, getSelectedItems, type PlexMediaItem } from "./plex.js";

const FALLBACK_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_HORIZON_MS = 2 * 60 * 60 * 1000;

export type ScheduledProgramme = {
  ratingKey: string;
  title: string;
  subtitle: string | null;
  type: string;
  thumb: string | null;
  art: string | null;
  summary: string | null;
  year: number | null;
  contentRating: string | null;
  seriesTitle: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  durationMs: number;
  start: string;
  end: string;
};

export type ChannelSchedule = {
  channelId: number;
  generatedAt: string;
  itemCount: number;
  programmes: ScheduledProgramme[];
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function orderItems(channel: Channel, items: PlexMediaItem[]): PlexMediaItem[] {
  if (channel.playbackOrder === "sequential") {
    if (items.every((item) => item.type === "movie")) return items;
    return [...items].sort((a, b) => {
      const series = (a.grandparentTitle ?? a.title).localeCompare(b.grandparentTitle ?? b.title);
      if (series !== 0) return series;
      const season = (a.parentIndex ?? 0) - (b.parentIndex ?? 0);
      return season !== 0 ? season : (a.index ?? 0) - (b.index ?? 0);
    });
  }
  return [...items].sort(
    (a, b) => stableHash(`${channel.id}:${a.ratingKey}`) - stableHash(`${channel.id}:${b.ratingKey}`)
  );
}

function parseSqliteTimestamp(value: string): number {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function itemDuration(item: PlexMediaItem): number {
  return item.duration && item.duration > 0 ? item.duration : FALLBACK_DURATION_MS;
}

export async function buildChannelSchedule(
  channel: Channel,
  now = Date.now(),
  horizonMs = DEFAULT_HORIZON_MS
): Promise<ChannelSchedule> {
  const savedItems = getChannelItems(channel.id);
  const sourceItems = savedItems.length > 0
    ? await getSelectedItems(savedItems.map((item) => item.ratingKey))
    : channel.sourceType === "plex-selection" ? [] : await getCollectionItems(channel.sourceId);
  const items = orderItems(channel, sourceItems);
  if (!channel.isActive) {
    return { channelId: channel.id, generatedAt: new Date(now).toISOString(), itemCount: items.length, programmes: [] };
  }
  if (items.length === 0) {
    return { channelId: channel.id, generatedAt: new Date(now).toISOString(), itemCount: 0, programmes: [] };
  }

  const cycleDuration = items.reduce((total, item) => total + itemDuration(item), 0);
  const anchor = parseSqliteTimestamp(channel.createdAt);
  const offset = ((now - anchor) % cycleDuration + cycleDuration) % cycleDuration;
  let elapsed = 0;
  let currentIndex = 0;
  while (currentIndex < items.length - 1 && elapsed + itemDuration(items[currentIndex]) <= offset) {
    elapsed += itemDuration(items[currentIndex]);
    currentIndex += 1;
  }

  let cursor = now - (offset - elapsed);
  const endAt = now + horizonMs;
  const programmes: ScheduledProgramme[] = [];
  let safety = 0;
  while (cursor < endAt && safety < 500) {
    const item = items[currentIndex];
    const durationMs = itemDuration(item);
    programmes.push({
      ratingKey: item.ratingKey,
      title: item.title,
      subtitle: item.type === "episode"
        ? `${item.grandparentTitle ?? "Series"} · S${item.parentIndex ?? 0} E${item.index ?? 0}`
        : item.year ? String(item.year) : null,
      type: item.type,
      thumb: item.thumb ?? null,
      art: item.art ?? null,
      summary: item.summary ?? null,
      year: item.year ?? null,
      contentRating: item.contentRating ?? null,
      seriesTitle: item.grandparentTitle ?? null,
      seasonNumber: item.parentIndex ?? null,
      episodeNumber: item.index ?? null,
      durationMs,
      start: new Date(cursor).toISOString(),
      end: new Date(cursor + durationMs).toISOString()
    });
    cursor += durationMs;
    currentIndex = (currentIndex + 1) % items.length;
    safety += 1;
  }

  return {
    channelId: channel.id,
    generatedAt: new Date(now).toISOString(),
    itemCount: items.length,
    programmes
  };
}
