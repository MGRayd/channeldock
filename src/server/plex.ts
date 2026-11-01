import { randomUUID } from "node:crypto";
import { getSetting, setSetting } from "./db.js";

const PLEX_PRODUCT = "ChannelDock";

export type PlexPin = {
  id: number;
  code: string;
  authToken: string | null;
  expiresAt?: string;
};

export type PlexConnection = {
  uri: string;
  local: boolean;
  relay: boolean;
  protocol: string;
};

export type PlexResource = {
  name: string;
  clientIdentifier: string;
  provides: string;
  owned: boolean;
  accessToken: string;
  connections: PlexConnection[];
};

export type PlexServerChoice = {
  name: string;
  clientIdentifier: string;
  owned: boolean;
  connections: PlexConnection[];
};

type PlexContainer<T> = {
  MediaContainer?: T;
};

export type PlexIdentity = {
  machineIdentifier?: string;
  version?: string;
  claimed?: boolean;
  friendlyName?: string;
};

export type PlexLibrary = {
  key: string;
  title: string;
  type: string;
  uuid?: string;
  agent?: string;
  scanner?: string;
};

export type PlexCollection = {
  ratingKey: string;
  key: string;
  title: string;
  type: string;
  subtype?: string;
  childCount?: number;
  thumb?: string;
  summary?: string;
};

export type PlexMediaItem = {
  ratingKey: string;
  key: string;
  title: string;
  type: "movie" | "show" | "season" | "episode" | string;
  duration?: number;
  year?: number;
  thumb?: string;
  art?: string;
  grandparentThumb?: string;
  summary?: string;
  contentRating?: string;
  parentTitle?: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  Media?: Array<{
    videoCodec?: string;
    audioCodec?: string;
    videoProfile?: string;
    Part?: Array<{
      key: string;
      duration?: number;
      container?: string;
    }>;
  }>;
};

export type PlexFilterValue = { key: string; title: string };

export type PlexMediaSource = {
  url: string;
  videoCodec?: string;
  audioCodec?: string;
  videoProfile?: string;
};

function normaliseBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

async function request<T>(baseUrl: string, token: string, path: string): Promise<T> {
  const clientIdentifier = getClientIdentifier();
  const response = await fetch(`${normaliseBaseUrl(baseUrl)}${path}`, {
    headers: {
      Accept: "application/json",
      "X-Plex-Token": token,
      "X-Plex-Client-Identifier": clientIdentifier,
      "X-Plex-Product": PLEX_PRODUCT,
      "X-Plex-Version": "0.1.0"
    },
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`Plex returned ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export function getClientIdentifier(): string {
  const existing = getSetting("plex.clientIdentifier");
  if (existing) return existing;
  const created = randomUUID();
  setSetting("plex.clientIdentifier", created);
  return created;
}

function plexHeaders(token?: string): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Plex-Product": PLEX_PRODUCT,
    "X-Plex-Version": "0.1.0",
    "X-Plex-Client-Identifier": getClientIdentifier(),
    ...(token ? { "X-Plex-Token": token } : {})
  };
}

async function plexTvRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { ...plexHeaders(), ...options?.headers },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`Plex sign-in returned ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function createPlexPin(): Promise<PlexPin> {
  const pin = await plexTvRequest<PlexPin>("https://plex.tv/api/v2/pins?strong=false", {
    method: "POST"
  });
  setSetting("plex.pendingPinId", String(pin.id));
  return pin;
}

export async function checkPlexPin(pinId: number): Promise<PlexPin> {
  if (getSetting("plex.pendingPinId") !== String(pinId)) {
    throw new Error("This Plex link code is no longer active");
  }
  return plexTvRequest<PlexPin>(`https://plex.tv/api/v2/pins/${pinId}`);
}

export async function getPlexResources(accountToken: string): Promise<PlexResource[]> {
  const resources = await plexTvRequest<PlexResource[]>(
    "https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1",
    { headers: plexHeaders(accountToken) }
  );
  return resources.filter((resource) => resource.provides.split(",").includes("server"));
}

export function sanitiseResources(resources: PlexResource[]): PlexServerChoice[] {
  return resources.map(({ name, clientIdentifier, owned, connections }) => ({
    name,
    clientIdentifier,
    owned,
    connections: connections
      .map((connection) => ({
        uri: connection.uri,
        local: Boolean(connection.local),
        relay: Boolean(connection.relay),
        protocol: connection.protocol
      }))
      .sort((a, b) => Number(b.local) - Number(a.local) || Number(a.relay) - Number(b.relay))
  }));
}

export async function completePlexLink(pinId: number): Promise<PlexServerChoice[]> {
  const pin = await checkPlexPin(pinId);
  if (!pin.authToken) return [];
  setSetting("plex.accountToken", pin.authToken);
  setSetting("plex.pendingPinId", "");
  return sanitiseResources(await getPlexResources(pin.authToken));
}

export async function selectPlexServer(machineIdentifier: string, connectionUri?: string): Promise<PlexIdentity> {
  const accountToken = getSetting("plex.accountToken");
  if (!accountToken) throw new Error("Link your Plex account first");
  const resources = await getPlexResources(accountToken);
  const server = resources.find((resource) => resource.clientIdentifier === machineIdentifier);
  if (!server) throw new Error("That Plex server is no longer available");
  const connection = connectionUri
    ? server.connections.find((candidate) => candidate.uri === connectionUri)
    : server.connections.find((candidate) => candidate.local && !candidate.relay) ??
      server.connections.find((candidate) => !candidate.relay) ??
      server.connections[0];
  if (!connection) throw new Error("Plex did not provide a usable connection for this server");
  const identity = await verifyPlex(connection.uri, server.accessToken);
  setSetting("plex.baseUrl", normaliseBaseUrl(connection.uri));
  setSetting("plex.token", server.accessToken);
  setSetting("plex.serverName", identity.friendlyName ?? server.name);
  setSetting("plex.serverVersion", identity.version ?? "Unknown");
  setSetting("plex.machineIdentifier", identity.machineIdentifier ?? server.clientIdentifier);
  return identity;
}

export async function verifyPlex(baseUrl: string, token: string): Promise<PlexIdentity> {
  const identity = await request<PlexContainer<PlexIdentity>>(baseUrl, token, "/identity");
  const root = await request<PlexContainer<PlexIdentity>>(baseUrl, token, "/");
  return { ...identity.MediaContainer, ...root.MediaContainer };
}

function configuredConnection(): { baseUrl: string; token: string } {
  const baseUrl = getSetting("plex.baseUrl");
  const token = getSetting("plex.token");
  if (!baseUrl || !token) {
    throw new Error("Plex is not connected");
  }
  return { baseUrl, token };
}

export async function getLibraries(): Promise<PlexLibrary[]> {
  const connection = configuredConnection();
  const result = await request<PlexContainer<{ Directory?: PlexLibrary[] }>>(
    connection.baseUrl,
    connection.token,
    "/library/sections"
  );
  return result.MediaContainer?.Directory ?? [];
}

export async function getCollections(sectionId: string): Promise<PlexCollection[]> {
  const connection = configuredConnection();
  const result = await request<PlexContainer<{ Metadata?: PlexCollection[] }>>(
    connection.baseUrl,
    connection.token,
    `/library/sections/${encodeURIComponent(sectionId)}/collections`
  );
  return result.MediaContainer?.Metadata ?? [];
}

async function getMetadataItems(path: string): Promise<PlexMediaItem[]> {
  const connection = configuredConnection();
  const items: PlexMediaItem[] = [];
  const pageSize = 500;
  for (let start = 0; start < 100_000; start += pageSize) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await request<PlexContainer<{ Metadata?: PlexMediaItem[]; totalSize?: number }>>(
      connection.baseUrl,
      connection.token,
      `${path}${separator}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`
    );
    const page = result.MediaContainer?.Metadata ?? [];
    items.push(...page);
    const total = result.MediaContainer?.totalSize;
    if (page.length < pageSize || (total !== undefined && items.length >= total)) break;
  }
  return items;
}

export async function getCollectionItems(collectionId: string): Promise<PlexMediaItem[]> {
  const members = await getCollectionMembers(collectionId);
  const expanded = await Promise.all(
    members.map(async (item) => {
      if (item.type !== "show") return [item];
      return getMetadataItems(`/library/metadata/${encodeURIComponent(item.ratingKey)}/allLeaves`);
    })
  );
  return expanded.flat().filter((item) => item.type === "movie" || item.type === "episode");
}

export async function getCollectionMembers(collectionId: string): Promise<PlexMediaItem[]> {
  return (await getMetadataItems(`/library/collections/${encodeURIComponent(collectionId)}/children`))
    .filter((item) => item.type === "movie" || item.type === "show");
}

export async function getLibraryItems(sectionId: string, filters: { genre?: string; label?: string } = {}): Promise<PlexMediaItem[]> {
  const query = new URLSearchParams();
  if (filters.genre) query.set("genre", filters.genre);
  if (filters.label) query.set("label", filters.label);
  const suffix = query.size ? `?${query}` : "";
  return (await getMetadataItems(`/library/sections/${encodeURIComponent(sectionId)}/all${suffix}`))
    .filter((item) => item.type === "movie" || item.type === "show");
}

async function getSectionFilterValues(sectionId: string, filter: "genre" | "label"): Promise<PlexFilterValue[]> {
  const connection = configuredConnection();
  const result = await request<PlexContainer<{ Directory?: Array<{ key?: string; fastKey?: string; title: string }> }>>(
    connection.baseUrl,
    connection.token,
    `/library/sections/${encodeURIComponent(sectionId)}/${filter}`
  );
  return (result.MediaContainer?.Directory ?? []).flatMap((entry) => {
    const queryKey = [entry.fastKey, entry.key].find((key) => key?.match(new RegExp(`[?&]${filter}=`)));
    const match = queryKey?.match(new RegExp(`[?&]${filter}=([^&]+)`));
    if (match) return [{ key: decodeURIComponent(match[1]), title: entry.title }];
    return entry.key ? [{ key: entry.key, title: entry.title }] : [];
  });
}

export async function getLibraryFilters(sectionId: string): Promise<{ genres: PlexFilterValue[]; labels: PlexFilterValue[] }> {
  const [genres, labels] = await Promise.all([
    getSectionFilterValues(sectionId, "genre"),
    getSectionFilterValues(sectionId, "label")
  ]);
  return { genres, labels };
}

export async function getSelectedItems(ratingKeys: string[]): Promise<PlexMediaItem[]> {
  const selected = await Promise.all(ratingKeys.map(async (ratingKey) => {
    const items = await getMetadataItems(`/library/metadata/${encodeURIComponent(ratingKey)}`);
    const item = items[0];
    if (!item) return [];
    if (item.type === "show") return getMetadataItems(`/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves`);
    return [item];
  }));
  return selected.flat().filter((item) => item.type === "movie" || item.type === "episode");
}

export async function getMediaSource(ratingKey: string): Promise<PlexMediaSource> {
  const connection = configuredConnection();
  const result = await request<PlexContainer<{ Metadata?: PlexMediaItem[] }>>(
    connection.baseUrl,
    connection.token,
    `/library/metadata/${encodeURIComponent(ratingKey)}`
  );
  const item = result.MediaContainer?.Metadata?.[0];
  const media = item?.Media?.[0];
  const part = media?.Part?.[0];
  if (!part?.key) throw new Error(`Plex returned no playable media for ${item?.title ?? ratingKey}`);
  const separator = part.key.includes("?") ? "&" : "?";
  return {
    url: `${connection.baseUrl}${part.key}${separator}X-Plex-Token=${encodeURIComponent(connection.token)}`,
    videoCodec: media?.videoCodec?.toLowerCase(),
    audioCodec: media?.audioCodec?.toLowerCase(),
    videoProfile: media?.videoProfile
  };
}

export async function getMediaStreamUrl(ratingKey: string): Promise<string> {
  return (await getMediaSource(ratingKey)).url;
}

export async function getArtwork(ratingKey: string): Promise<{ data: Buffer; contentType: string }> {
  const connection = configuredConnection();
  const result = await request<PlexContainer<{ Metadata?: PlexMediaItem[] }>>(
    connection.baseUrl,
    connection.token,
    `/library/metadata/${encodeURIComponent(ratingKey)}`
  );
  const item = result.MediaContainer?.Metadata?.[0];
  const imagePath = item?.type === "episode" ? item.grandparentThumb ?? item.thumb : item?.thumb;
  if (!imagePath) throw new Error("Artwork not found");
  const response = await fetch(`${connection.baseUrl}${imagePath}`, {
    headers: { "X-Plex-Token": connection.token },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Plex artwork returned ${response.status}`);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "image/jpeg"
  };
}

export async function getBackdrop(ratingKey: string): Promise<{ data: Buffer; contentType: string }> {
  const connection = configuredConnection();
  const result = await request<PlexContainer<{ Metadata?: PlexMediaItem[] }>>(
    connection.baseUrl,
    connection.token,
    `/library/metadata/${encodeURIComponent(ratingKey)}`
  );
  const item = result.MediaContainer?.Metadata?.[0];
  const imagePath = item?.art ?? item?.thumb;
  if (!imagePath) throw new Error("Backdrop not found");
  const response = await fetch(`${connection.baseUrl}${imagePath}`, {
    headers: { "X-Plex-Token": connection.token },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Plex backdrop returned ${response.status}`);
  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "image/jpeg"
  };
}

export { normaliseBaseUrl };
