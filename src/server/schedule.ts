import { getChannelItems, getScheduleItemCache, setScheduleItemCache, type Channel, type ChannelItem } from "./db.js";
import { getCollectionItems, getSelectedItems, type PlexMediaItem } from "./plex.js";

const FALLBACK_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_HORIZON_MS = 2 * 60 * 60 * 1000;
const SOURCE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const sourceRefreshes = new Map<number, Promise<PlexMediaItem[]>>();

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

    const groups = new Map<string, PlexMediaItem[]>();
    for (const item of items) {
      const key = item.type === "episode"
        ? `show:${item.grandparentRatingKey ?? item.grandparentTitle ?? item.ratingKey}`
        : `item:${item.ratingKey}`;
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    }

    const orderedGroups = [...groups.values()].map((group) => [...group].sort((a, b) => {
      const season = (a.parentIndex ?? 0) - (b.parentIndex ?? 0);
      if (season !== 0) return season;
      const episode = (a.index ?? 0) - (b.index ?? 0);
      return episode !== 0 ? episode : a.ratingKey.localeCompare(b.ratingKey);
    }));

    const interleaved: PlexMediaItem[] = [];
    const longestGroup = Math.max(...orderedGroups.map((group) => group.length));
    for (let index = 0; index < longestGroup; index += 1) {
      for (const group of orderedGroups) {
        if (group[index]) interleaved.push(group[index]);
      }
    }
    return interleaved;
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

function sourceFingerprint(channel: Channel, savedItems: ChannelItem[]): string {
  return JSON.stringify([
    channel.sourceType,
    channel.sourceId,
    savedItems.map((item) => item.ratingKey)
  ]);
}

async function fetchSourceItems(channel: Channel, savedItems: ChannelItem[]): Promise<PlexMediaItem[]> {
  return savedItems.length > 0
    ? getSelectedItems(savedItems.map((item) => item.ratingKey))
    : channel.sourceType === "plex-selection" ? [] : getCollectionItems(channel.sourceId);
}

function refreshSourceItems(channel: Channel, savedItems: ChannelItem[], fingerprint: string): Promise<PlexMediaItem[]> {
  const existing = sourceRefreshes.get(channel.id);
  if (existing) return existing;
  const refresh = fetchSourceItems(channel, savedItems).then((items) => {
    setScheduleItemCache(channel.id, fingerprint, JSON.stringify(items));
    return items;
  }).finally(() => sourceRefreshes.delete(channel.id));
  sourceRefreshes.set(channel.id, refresh);
  return refresh;
}

async function getSourceItems(channel: Channel): Promise<PlexMediaItem[]> {
  const savedItems = getChannelItems(channel.id);
  const fingerprint = sourceFingerprint(channel, savedItems);
  const cached = getScheduleItemCache(channel.id);
  if (cached?.fingerprint === fingerprint) {
    try {
      const items = JSON.parse(cached.itemsJson) as PlexMediaItem[];
      if (Date.now() - cached.refreshedAt > SOURCE_CACHE_MAX_AGE_MS) {
        void refreshSourceItems(channel, savedItems, fingerprint).catch((error) => {
          console.error(`Could not refresh schedule cache for channel ${channel.id}`, error);
        });
      }
      return items;
    } catch {
      // A damaged cache is replaced by a fresh Plex response below.
    }
  }
  return refreshSourceItems(channel, savedItems, fingerprint);
}

export async function buildChannelSchedule(
  channel: Channel,
  now = Date.now(),
  horizonMs = DEFAULT_HORIZON_MS
): Promise<ChannelSchedule> {
  const sourceItems = await getSourceItems(channel);
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
