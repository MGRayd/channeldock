import type { Channel, ChannelDetails, ChannelDraft, ChannelSchedule, PlexCollection, PlexItem, PlexLibrary, PlexLibraryFilters, PlexLink, PlexServerChoice, PlexStatus } from "./types";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers
  });
  const responseText = await response.text();
  let body: T & { error?: string };
  try {
    body = responseText ? JSON.parse(responseText) as T & { error?: string } : {} as T & { error?: string };
  } catch {
    body = {} as T & { error?: string };
  }
  if (!response.ok) {
    const detail = responseText && !body.error ? `: ${responseText.slice(0, 180)}` : "";
    throw new Error(body.error ?? `ChannelDock API returned ${response.status}${detail}`);
  }
  if (!responseText) throw new Error("ChannelDock API returned an empty response");
  return body;
}

export const getPlexStatus = () => api<PlexStatus>("/api/plex/status");

export const startPlexLink = () => api<PlexLink>("/api/plex/link", { method: "POST" });

export const checkPlexLink = (pinId: number) =>
  api<{ linked: boolean; servers: PlexServerChoice[] }>(`/api/plex/link/${pinId}`);

export const selectPlexServer = (machineIdentifier: string, connectionUri?: string) =>
  api<PlexStatus>("/api/plex/server", {
    method: "POST",
    body: JSON.stringify({ machineIdentifier, connectionUri })
  });

export const getLibraries = async () =>
  (await api<{ libraries: PlexLibrary[] }>("/api/plex/libraries")).libraries;

export const getCollections = async (sectionId: string) =>
  (
    await api<{ collections: PlexCollection[] }>(
      `/api/plex/collections?sectionId=${encodeURIComponent(sectionId)}`
    )
  ).collections;

export const getLibraryItems = async (sectionId: string, filters: { genre?: string; label?: string } = {}) => {
  const query = new URLSearchParams({ sectionId });
  if (filters.genre) query.set("genre", filters.genre);
  if (filters.label) query.set("label", filters.label);
  return (await api<{ items: PlexItem[] }>(`/api/plex/items?${query}`)).items;
};

export const getLibraryFilters = (sectionId: string) =>
  api<PlexLibraryFilters>(`/api/plex/filters?sectionId=${encodeURIComponent(sectionId)}`);

export const isChannelNumberAvailable = async (number: number) =>
  (await api<{ available: boolean }>(`/api/channels/number/${number}/available`)).available;

export const getChannels = async () =>
  (await api<{ channels: Channel[] }>("/api/channels")).channels;

export const getChannel = async (channelId: number) =>
  (await api<{ channel: ChannelDetails }>(`/api/channels/${channelId}`)).channel;

export const deleteChannel = (channelId: number) =>
  api<{ deleted: true }>(`/api/channels/${channelId}`, { method: "DELETE" });

export const getChannelSchedules = async () =>
  (await api<{ schedules: ChannelSchedule[] }>("/api/schedules?hours=2")).schedules;

export const createChannel = async (channel: ChannelDraft) =>
  (
    await api<{ channel: Channel }>("/api/channels", {
      method: "POST",
      body: JSON.stringify(channel)
    })
  ).channel;

export const updateChannel = async (channelId: number, channel: ChannelDraft) =>
  (
    await api<{ channel: Channel }>(`/api/channels/${channelId}`, {
      method: "PUT",
      body: JSON.stringify(channel)
    })
  ).channel;

export const uploadChannelLogo = async (channelId: number, file: File) =>
  (
    await api<{ channel: Channel }>(`/api/channels/${channelId}/logo`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file
    })
  ).channel;

export const setChannelActive = async (channelId: number, active: boolean) =>
  (
    await api<{ channel: Channel }>(`/api/channels/${channelId}/active`, {
      method: "PATCH",
      body: JSON.stringify({ active })
    })
  ).channel;
