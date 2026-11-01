import { spawn } from "node:child_process";
import { getChannel } from "../src/server/db.js";
import { getMediaSource } from "../src/server/plex.js";
import { getStreamCodecArguments } from "../src/server/stream.js";
import { buildChannelSchedule } from "../src/server/schedule.js";

const channelId = Number(process.argv[2] ?? 1);
const channel = getChannel(channelId);
if (!channel) throw new Error(`Channel ${channelId} was not found`);

const now = Date.now();
const schedule = await buildChannelSchedule(channel, now, 60 * 60 * 1000);
const programme = schedule.programmes[0];
if (!programme) throw new Error("The channel schedule is empty");

const source = await getMediaSource(programme.ratingKey);
const offsetSeconds = Math.max(0, now - Date.parse(programme.start)) / 1000;
const streamEncoding = getStreamCodecArguments(source);
const ffmpeg = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", [
  "-hide_banner", "-loglevel", "warning",
  "-ss", offsetSeconds.toFixed(3),
  "-i", source.url,
  "-map", "0:v:0", "-map", "0:a:0?",
  "-t", "5",
  ...streamEncoding.args,
  "-f", "mpegts", "-mpegts_flags", "+resend_headers", "-muxdelay", "0",
  "-y", "NUL"
]);

let stderr = "";
ffmpeg.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
const exitCode = await new Promise<number | null>((resolve, reject) => {
  ffmpeg.once("error", reject);
  ffmpeg.once("close", resolve);
});

const safeError = stderr.replaceAll(source.url, "[PLEX_MEDIA_URL]");
if (exitCode !== 0) throw new Error(`FFmpeg exited with ${exitCode}: ${safeError.trim()}`);
console.log(JSON.stringify({
  channel: channel.name,
  programme: programme.title,
  offsetSeconds: Math.round(offsetSeconds),
  sourceVideo: source.videoCodec ?? "unknown",
  sourceAudio: source.audioCodec ?? "unknown",
  mode: streamEncoding.mode,
  ffmpeg: "ok"
}));
