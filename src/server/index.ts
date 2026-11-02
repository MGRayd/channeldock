import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { createChannel, deleteChannel, getChannel, getChannelByNumber, getChannelItems, getSetting, listChannels, setChannelActive, setChannelCustomLogo, setSetting, updateChannel } from "./db.js";
import { buildDeviceXml, buildDiscover, buildLineup, buildLineupXml, HDHR_DEVICE_ID, HDHR_TUNER_COUNT } from "./hdhomerun.js";
import { buildM3u, buildXmltv } from "./iptv.js";
import { buildChannelSchedule } from "./schedule.js";
import { prepareChannelStream } from "./stream.js";
import {
  checkPlexPin,
  completePlexLink,
  createPlexPin,
  getCollections,
  getCollectionMembers,
  getArtwork,
  getBackdrop,
  getLibraries,
  getLibraryItems,
  getLibraryFilters,
  getMediaSource,
  selectPlexServer
} from "./plex.js";

const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });
const port = Number(process.env.PORT ?? 4100);
const logosDirectory = resolve(process.env.DATA_DIR ?? resolve(process.cwd(), "data"), "logos");
mkdirSync(logosDirectory, { recursive: true });
app.addContentTypeParser(/^image\/(png|jpeg|webp)$/, { parseAs: "buffer" }, (_request, body, done) => done(null, body));

function publicChannel(channel: NonNullable<ReturnType<typeof getChannel>>) {
  const { customLogoPath, ...rest } = channel;
  return { ...rest, hasCustomLogo: Boolean(customLogoPath) };
}

function requestOrigin(request: { protocol: string; headers: Record<string, string | string[] | undefined> }): string {
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const forwardedHost = request.headers["x-forwarded-host"];
  const protocol = typeof forwardedProtocol === "string" ? forwardedProtocol.split(",")[0].trim() : request.protocol;
  const host = typeof forwardedHost === "string" ? forwardedHost.split(",")[0].trim() : request.headers.host;
  return `${protocol}://${host}`;
}

const channelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  number: z.number().int().min(1).max(9999),
  sourceType: z.enum(["plex-collection", "plex-selection"]),
  sourceId: z.string().min(1),
  sourceTitle: z.string().min(1),
  libraryId: z.string().min(1),
  libraryTitle: z.string().min(1),
  playbackOrder: z.enum(["shuffle", "sequential"]),
  logoRatingKey: z.string().min(1).nullable().default(null),
  isActive: z.boolean().default(true),
  items: z.array(z.object({
    ratingKey: z.string().min(1),
    title: z.string().min(1),
    type: z.enum(["movie", "show"]),
    leafCount: z.number().int().nonnegative().nullable().default(null)
  })).max(5000).default([])
}).superRefine((value, context) => {
  if (value.sourceType === "plex-selection" && value.items.length === 0) {
    context.addIssue({ code: "custom", message: "Select at least one movie or show", path: ["items"] });
  }
});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: error.issues[0]?.message ?? "Invalid request" });
  }
  if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
    return reply.status(409).send({ error: "That channel number is already in use" });
  }
  app.log.error(error);
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return reply.status(500).send({ error: message });
});

app.get("/api/health", async () => ({ status: "ok" }));

app.get("/api/plex/status", async () => ({
  connected: Boolean(getSetting("plex.baseUrl") && getSetting("plex.token")),
  baseUrl: getSetting("plex.baseUrl") ?? null,
  serverName: getSetting("plex.serverName") ?? null,
  serverVersion: getSetting("plex.serverVersion") ?? null
}));

app.post("/api/plex/link", async (_request, reply) => {
  const pin = await createPlexPin();
  return reply.status(201).send({
    id: pin.id,
    code: pin.code,
    expiresAt: pin.expiresAt ?? null,
    linkUrl: `https://www.plex.tv/link/?pin=${encodeURIComponent(pin.code)}`
  });
});

app.get("/api/plex/link/:pinId", async (request) => {
  const params = z.object({ pinId: z.coerce.number().int().positive() }).parse(request.params);
  const pin = await checkPlexPin(params.pinId);
  if (!pin.authToken) return { linked: false, servers: [] };
  return { linked: true, servers: await completePlexLink(params.pinId) };
});

app.post("/api/plex/server", async (request) => {
  const input = z.object({
    machineIdentifier: z.string().min(1),
    connectionUri: z.url().optional()
  }).parse(request.body);
  const identity = await selectPlexServer(input.machineIdentifier, input.connectionUri);
  return {
    connected: true,
    baseUrl: getSetting("plex.baseUrl"),
    serverName: getSetting("plex.serverName") ?? identity.friendlyName ?? "Plex Media Server",
    serverVersion: getSetting("plex.serverVersion") ?? identity.version ?? "Unknown"
  };
});

app.get("/api/plex/libraries", async () => ({ libraries: await getLibraries() }));

app.get("/api/plex/collections", async (request) => {
  const query = z.object({ sectionId: z.string().min(1) }).parse(request.query);
  return { collections: await getCollections(query.sectionId) };
});

app.get("/api/plex/items", async (request) => {
  const query = z.object({ sectionId: z.string().min(1), genre: z.string().optional(), label: z.string().optional() }).parse(request.query);
  return { items: await getLibraryItems(query.sectionId, { genre: query.genre, label: query.label }) };
});

app.get("/api/plex/filters", async (request) => {
  const query = z.object({ sectionId: z.string().min(1) }).parse(request.query);
  return getLibraryFilters(query.sectionId);
});

app.get("/api/channels", async () => ({ channels: listChannels().map(publicChannel) }));
app.get("/api/channels/:channelId", async (request, reply) => {
  const params = z.object({ channelId: z.coerce.number().int().positive() }).parse(request.params);
  const channel = getChannel(params.channelId);
  if (!channel) return reply.status(404).send({ error: "Channel not found" });
  let items = getChannelItems(channel.id);
  if (items.length === 0 && channel.sourceType === "plex-collection") {
    items = (await getCollectionMembers(channel.sourceId)).map(({ ratingKey, title, type, leafCount }) => ({ ratingKey, title, type, leafCount: leafCount ?? null }));
  }
  return { channel: { ...publicChannel(channel), items } };
});

app.post("/api/channels/:channelId/logo", async (request, reply) => {
  const params = z.object({ channelId: z.coerce.number().int().positive() }).parse(request.params);
  if (!getChannel(params.channelId)) return reply.status(404).send({ error: "Channel not found" });
  const contentType = request.headers["content-type"]?.split(";")[0];
  const extension = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : null;
  const body = request.body as Buffer;
  if (!extension || !Buffer.isBuffer(body) || body.length === 0) return reply.status(400).send({ error: "Choose a PNG, JPEG or WebP logo" });
  const path = resolve(logosDirectory, `channel-${params.channelId}.${extension}`);
  writeFileSync(path, body);
  const channel = setChannelCustomLogo(params.channelId, path);
  return { channel: channel ? publicChannel(channel) : null };
});

app.patch("/api/channels/:channelId/active", async (request, reply) => {
  const params = z.object({ channelId: z.coerce.number().int().positive() }).parse(request.params);
  const body = z.object({ active: z.boolean() }).parse(request.body);
  const channel = setChannelActive(params.channelId, body.active);
  return channel ? { channel: publicChannel(channel) } : reply.status(404).send({ error: "Channel not found" });
});

app.patch("/api/channels/:channelId/settings", async (request, reply) => {
  const params = z.object({ channelId: z.coerce.number().int().positive() }).parse(request.params);
  const body = z.object({
    name: z.string().trim().min(1).max(80),
    number: z.number().int().min(1).max(9999),
    playbackOrder: z.enum(["shuffle", "sequential"])
  }).parse(request.body);
  const existing = getChannel(params.channelId);
  if (!existing) return reply.status(404).send({ error: "Channel not found" });
  const numberedChannel = getChannelByNumber(body.number);
  if (numberedChannel && numberedChannel.id !== existing.id) {
    return reply.status(409).send({ error: "That channel number is already in use" });
  }
  const channel = updateChannel(existing.id, {
    name: body.name,
    number: body.number,
    sourceType: existing.sourceType,
    sourceId: existing.sourceId,
    sourceTitle: existing.sourceTitle,
    libraryId: existing.libraryId,
    libraryTitle: existing.libraryTitle,
    playbackOrder: body.playbackOrder,
    logoRatingKey: existing.logoRatingKey,
    isActive: existing.isActive
  }, getChannelItems(existing.id));
  return { channel: publicChannel(channel!) };
});

app.get("/channel-logo/:channelId", async (request, reply) => {
  const params = z.object({ channelId: z.coerce.number().int().positive() }).parse(request.params);
  const channel = getChannel(params.channelId);
  if (!channel?.customLogoPath) return reply.status(404).send({ error: "Channel logo not found" });
  const type = channel.customLogoPath.endsWith(".png") ? "image/png" : channel.customLogoPath.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return reply.type(type).header("Cache-Control", "no-cache").send(createReadStream(channel.customLogoPath));
});
app.delete("/api/channels/:channelId", async (request, reply) => {
  const params = z.object({ channelId: z.coerce.number().int().positive() }).parse(request.params);
  if (!deleteChannel(params.channelId)) return reply.status(404).send({ error: "Channel not found" });
  return { deleted: true };
});
app.get("/api/channels/number/:number/available", async (request) => {
  const params = z.object({ number: z.coerce.number().int().min(1).max(9999) }).parse(request.params);
  return { available: !getChannelByNumber(params.number) };
});

async function tvPlayback(channelId: number, origin: string) {
  const channel = getChannel(channelId);
  if (!channel) return null;
  const now = Date.now();
  const schedule = await buildChannelSchedule(channel, now, 6 * 60 * 60 * 1000);
  const current = schedule.programmes[0];
  const channelWithLogo = {
    ...publicChannel(channel),
    logoUrl: channel.customLogoPath ? `${origin}/channel-logo/${channel.id}` : channel.logoRatingKey ? `${origin}/artwork/${encodeURIComponent(channel.logoRatingKey)}` : null
  };
  if (!current) return { channel: channelWithLogo, current: null, next: null };
  return {
    channel: channelWithLogo,
    current: {
      ...current,
      offsetMs: Math.max(0, now - Date.parse(current.start)),
      mediaUrl: `${origin}/media/${encodeURIComponent(current.ratingKey)}`,
      artworkUrl: current.thumb ? `${origin}/artwork/${encodeURIComponent(current.ratingKey)}` : null,
      backdropUrl: current.art ? `${origin}/backdrop/${encodeURIComponent(current.ratingKey)}` : current.thumb ? `${origin}/artwork/${encodeURIComponent(current.ratingKey)}` : null
    },
    next: schedule.programmes[1] ?? null
  };
}

app.get("/api/tv/channels", async (request) => {
  const origin = requestOrigin(request);
  const channels = await Promise.all(listChannels().filter((channel) => channel.isActive).map((channel) => tvPlayback(channel.id, origin)));
  return { channels: channels.filter(Boolean) };
});

app.get("/api/tv/channels/:channelId/now", async (request, reply) => {
  const params = z.object({ channelId: z.coerce.number().int().positive() }).parse(request.params);
  const playback = await tvPlayback(params.channelId, requestOrigin(request));
  return playback ?? reply.status(404).send({ error: "Channel not found" });
});

app.get("/media/:ratingKey", async (request, reply) => {
  const params = z.object({ ratingKey: z.string().min(1) }).parse(request.params);
  const source = await getMediaSource(params.ratingKey);
  const range = request.headers.range;
  const controller = new AbortController();
  const connectionTimeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(source.url, {
      headers: range ? { Range: range } : undefined,
      signal: controller.signal
    });
  } finally {
    clearTimeout(connectionTimeout);
  }
  reply.raw.on("close", () => controller.abort());
  if (!response.ok && response.status !== 206) {
    return reply.status(response.status).send({ error: `Plex media returned ${response.status}` });
  }
  for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const value = response.headers.get(header);
    if (value) reply.header(header, value);
  }
  reply.header("Cache-Control", "private, no-store");
  reply.status(response.status);
  if (!response.body) return reply.send();
  return reply.send(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream));
});

app.get("/api/schedules", async (request) => {
  const query = z.object({ hours: z.coerce.number().min(1).max(24).default(2) }).parse(request.query);
  const channels = listChannels();
  const schedules = await Promise.all(
    channels.map((channel) => buildChannelSchedule(channel, Date.now(), query.hours * 60 * 60 * 1000))
  );
  return { schedules };
});

app.get("/iptv/channels.m3u", async (request, reply) => {
  return reply
    .type("application/vnd.apple.mpegurl")
    .header("Content-Disposition", "attachment; filename=channeldock.m3u")
    .send(buildM3u(listChannels(), requestOrigin(request)));
});

app.get("/iptv/xmltv.xml", async (request, reply) => {
  const channels = listChannels();
  const schedules = await Promise.all(
    channels.map((channel) => buildChannelSchedule(channel, Date.now(), 24 * 60 * 60 * 1000))
  );
  return reply.type("application/xml; charset=utf-8").send(buildXmltv(channels, schedules, requestOrigin(request)));
});

app.get("/artwork/:ratingKey", async (request, reply) => {
  const params = z.object({ ratingKey: z.string().min(1) }).parse(request.params);
  const artwork = await getArtwork(params.ratingKey);
  return reply.type(artwork.contentType).header("Cache-Control", "public, max-age=86400").send(artwork.data);
});

app.get("/backdrop/:ratingKey", async (request, reply) => {
  const params = z.object({ ratingKey: z.string().min(1) }).parse(request.params);
  const artwork = await getBackdrop(params.ratingKey);
  return reply.type(artwork.contentType).header("Cache-Control", "public, max-age=86400").send(artwork.data);
});

app.get("/stream/channels/:channelId.ts", async (request, reply) => {
  const params = z.object({ channelId: z.coerce.number().int().positive() }).parse(request.params);
  const channel = getChannel(params.channelId);
  if (!channel) return reply.status(404).send({ error: "Channel not found" });
  const runStream = await prepareChannelStream(channel);
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Connection: "keep-alive"
  });
  void runStream(reply.raw).catch((error: Error) => {
    app.log.error(error, `Channel ${channel.id} stream stopped`);
    if (!reply.raw.destroyed) reply.raw.destroy(error);
  });
  return reply;
});

app.get("/discover.json", async (request) => buildDiscover(requestOrigin(request)));

app.get("/lineup_status.json", async () => ({
  ScanInProgress: 0,
  ScanPossible: 1,
  Source: "Cable",
  SourceList: ["Cable"]
}));

app.get("/lineup.json", async (request) => buildLineup(listChannels(), requestOrigin(request)));

app.get("/lineup.xml", async (request, reply) =>
  reply.type("application/xml; charset=utf-8").send(buildLineupXml(listChannels(), requestOrigin(request)))
);

app.post("/lineup.post", async (_request, reply) => reply.status(200).send(""));

app.get("/device.xml", async (request, reply) =>
  reply.type("application/xml; charset=utf-8").send(buildDeviceXml(requestOrigin(request)))
);

app.get("/hdhomerun", async (request) => ({
  ...buildDiscover(requestOrigin(request)),
  ChannelCount: listChannels().length,
  DeviceID: HDHR_DEVICE_ID,
  TunerCount: HDHR_TUNER_COUNT,
  XmltvURL: `${requestOrigin(request)}/iptv/xmltv.xml`
}));

app.get("/auto/v:channelNumber", async (request, reply) => {
  const params = z.object({ channelNumber: z.coerce.number().int().positive() }).parse(request.params);
  const channel = getChannelByNumber(params.channelNumber);
  if (!channel) return reply.status(404).send({ error: "Channel not found" });
  const runStream = await prepareChannelStream(channel);
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Connection: "keep-alive"
  });
  void runStream(reply.raw).catch((error: Error) => {
    app.log.error(error, `HDHomeRun channel ${channel.number} stream stopped`);
    if (!reply.raw.destroyed) reply.raw.destroy(error);
  });
  return reply;
});

app.post("/api/channels", async (request, reply) => {
  const input = channelSchema.parse(request.body);
  if (getChannelByNumber(input.number)) return reply.status(409).send({ error: "That channel number is already in use" });
  const { items, ...channel } = input;
  return reply.status(201).send({ channel: publicChannel(createChannel(channel, items)) });
});

app.put("/api/channels/:channelId", async (request, reply) => {
  const params = z.object({ channelId: z.coerce.number().int().positive() }).parse(request.params);
  const input = channelSchema.parse(request.body);
  const numberedChannel = getChannelByNumber(input.number);
  if (numberedChannel && numberedChannel.id !== params.channelId) {
    return reply.status(409).send({ error: "That channel number is already in use" });
  }
  const { items, ...channelInput } = input;
  const channel = updateChannel(params.channelId, channelInput, items);
  return channel ? { channel: publicChannel(channel) } : reply.status(404).send({ error: "Channel not found" });
});

if (process.env.NODE_ENV === "production") {
  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), "dist/client")
  });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.status(404).send({ error: "API route not found" });
    }
    return reply.sendFile("index.html");
  });
}

await app.listen({ host: "0.0.0.0", port });
