import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { ServerResponse } from "node:http";
import type { Channel } from "./db.js";
import { getMediaSource, type PlexMediaSource } from "./plex.js";
import { buildChannelSchedule, type ScheduledProgramme } from "./schedule.js";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

type PreparedStream = {
  programmes: ScheduledProgramme[];
  firstSource: PlexMediaSource;
  preparedAt: number;
};

let detectedEncoder: string | null = null;

function videoEncoder(): string {
  const configured = process.env.VIDEO_ENCODER?.toLowerCase();
  if (configured && configured !== "auto") return configured;
  if (detectedEncoder) return detectedEncoder;

  const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
  for (const encoder of ["h264_nvenc", "h264_qsv", "h264_amf"]) {
    const probe = spawnSync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25",
      "-frames:v", "2", "-c:v", encoder, "-f", "null", "-"
    ], { stdio: "ignore", timeout: 5_000 });
    if (probe.status === 0) {
      detectedEncoder = encoder;
      return encoder;
    }
  }
  detectedEncoder = "libx264";
  return detectedEncoder;
}

function videoEncodeArguments(): { encoder: string; args: string[] } {
  const encoder = videoEncoder();
  if (encoder === "h264_nvenc") {
    return { encoder, args: ["-c:v", encoder, "-preset", "p4", "-tune", "ll", "-rc", "vbr", "-cq", "23", "-b:v", "0", "-pix_fmt", "yuv420p"] };
  }
  if (encoder === "h264_qsv") {
    return { encoder, args: ["-c:v", encoder, "-preset", "veryfast", "-global_quality", "23", "-look_ahead", "0", "-pix_fmt", "nv12"] };
  }
  if (encoder === "h264_amf") {
    return { encoder, args: ["-c:v", encoder, "-usage", "lowlatency", "-quality", "speed", "-qp_i", "23", "-qp_p", "23", "-pix_fmt", "yuv420p"] };
  }
  return { encoder: "libx264", args: ["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "23", "-pix_fmt", "yuv420p"] };
}

export async function prepareChannelStream(channel: Channel): Promise<(output: ServerResponse) => Promise<void>> {
  const preparedAt = Date.now();
  const schedule = await buildChannelSchedule(channel, preparedAt, SIX_HOURS_MS);
  if (schedule.programmes.length === 0) throw new Error("This channel has no playable programmes");
  const prepared: PreparedStream = {
    programmes: schedule.programmes,
    firstSource: await getMediaSource(schedule.programmes[0].ratingKey),
    preparedAt
  };
  return (output) => runPreparedStream(channel, prepared, output);
}

async function runPreparedStream(channel: Channel, initial: PreparedStream, output: ServerResponse): Promise<void> {
  let active = true;
  let process: ChildProcessWithoutNullStreams | null = null;
  output.on("close", () => {
    active = false;
    process?.kill("SIGKILL");
  });

  let programmes = initial.programmes;
  let firstSource: PlexMediaSource | null = initial.firstSource;
  let firstOffsetMs = Math.max(0, initial.preparedAt - Date.parse(programmes[0].start));

  while (active) {
    for (let index = 0; index < programmes.length && active; index += 1) {
      const programme = programmes[index];
      const source = index === 0 && firstSource ? firstSource : await getMediaSource(programme.ratingKey);
      const offsetMs = index === 0 ? firstOffsetMs : 0;
      await transcodeProgramme(source, offsetMs, output, () => active, (spawned) => {
        process = spawned;
      });
      process = null;
    }
    if (!active) break;
    const nextSchedule = await buildChannelSchedule(channel, Date.now(), SIX_HOURS_MS);
    programmes = nextSchedule.programmes;
    firstSource = null;
    firstOffsetMs = programmes[0] ? Math.max(0, Date.now() - Date.parse(programmes[0].start)) : 0;
    if (programmes.length === 0) break;
  }
  if (!output.destroyed) output.end();
}

export function getStreamCodecArguments(source: PlexMediaSource): { mode: string; args: string[] } {
  const requestedMode = process.env.STREAM_MODE?.toLowerCase() ?? "auto";
  if (requestedMode === "transcode") {
    const video = videoEncodeArguments();
    return {
      mode: `transcode (${video.encoder})`,
      args: [...video.args, "-c:a", "aac", "-ar", "48000", "-ac", "2"]
    };
  }
  if (requestedMode === "remux") {
    return { mode: "remux", args: ["-c:v", "copy", "-c:a", "copy", "-avoid_negative_ts", "make_zero"] };
  }

  const compatibleVideo = new Set(["h264", "avc", "mpeg2video"]);
  const compatibleAudio = new Set(["aac", "ac3", "eac3", "mp2"]);
  const copyVideo = Boolean(source.videoCodec && compatibleVideo.has(source.videoCodec));
  // Plex's tuner path is less tolerant than normal library playback. When video
  // must be converted, use the known-compatible stereo AAC output as well.
  const copyAudio = copyVideo && Boolean(source.audioCodec && compatibleAudio.has(source.audioCodec));
  const video = copyVideo ? null : videoEncodeArguments();
  return {
    mode: `auto (${copyVideo ? "video copy" : `video ${video?.encoder}`}, ${copyAudio ? "audio copy" : "audio aac"})`,
    args: [
      ...(copyVideo
        ? ["-c:v", "copy"]
        : video!.args),
      ...(copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-ar", "48000", "-ac", "2"]),
      "-avoid_negative_ts", "make_zero"
    ]
  };
}

function transcodeProgramme(
  source: PlexMediaSource,
  offsetMs: number,
  output: ServerResponse,
  isActive: () => boolean,
  onSpawn: (process: ChildProcessWithoutNullStreams) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const codecArguments = getStreamCodecArguments(source).args;
    const ffmpeg = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner",
      "-loglevel", "warning",
      "-re",
      "-ss", (offsetMs / 1000).toFixed(3),
      "-i", source.url,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      ...codecArguments,
      "-f", "mpegts",
      "-mpegts_flags", "+resend_headers",
      "-muxdelay", "0",
      "pipe:1"
    ]);
    onSpawn(ffmpeg);
    let stderr = "";
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    ffmpeg.stdout.pipe(output, { end: false });
    ffmpeg.once("error", (error) => reject(new Error(`Unable to start FFmpeg: ${error.message}`)));
    ffmpeg.once("close", (code) => {
      ffmpeg.stdout.unpipe(output);
      if (isActive() && code !== 0) {
        reject(new Error(`FFmpeg stopped with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      } else {
        resolve();
      }
    });
  });
}
