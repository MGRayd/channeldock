export type PlexStatus = {
  connected: boolean;
  baseUrl: string | null;
  serverName: string | null;
  serverVersion: string | null;
};

export type PlexConnection = {
  uri: string;
  local: boolean;
  relay: boolean;
  protocol: string;
};

export type PlexServerChoice = {
  name: string;
  clientIdentifier: string;
  owned: boolean;
  connections: PlexConnection[];
};

export type PlexLink = {
  id: number;
  code: string;
  expiresAt: string | null;
  linkUrl: string;
};

export type PlexLibrary = {
  key: string;
  title: string;
  type: string;
};

export type PlexCollection = {
  ratingKey: string;
  key: string;
  title: string;
  type: string;
  subtype?: string;
  childCount?: number;
  summary?: string;
};

export type PlexItem = {
  ratingKey: string;
  title: string;
  type: "movie" | "show";
  leafCount?: number | null;
  year?: number;
  thumb?: string;
  summary?: string;
};

export type PlexFilterValue = {
  key: string;
  title: string;
};

export type PlexLibraryFilters = {
  genres: PlexFilterValue[];
  labels: PlexFilterValue[];
};

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
  hasCustomLogo: boolean;
  isActive: boolean;
};

export type ChannelDraft = Omit<Channel, "id" | "hasCustomLogo"> & { items?: Array<Pick<PlexItem, "ratingKey" | "title" | "type" | "leafCount">> };
export type ChannelDetails = Channel & { items: Array<Pick<PlexItem, "ratingKey" | "title" | "type" | "leafCount">> };

export type ScheduledProgramme = {
  ratingKey: string;
  title: string;
  subtitle: string | null;
  type: string;
  thumb: string | null;
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
