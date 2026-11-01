import type { Channel } from "./db.js";
import type { ChannelSchedule } from "./schedule.js";

function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;"
  })[character] ?? character);
}

function m3uEscape(value: string): string {
  return value.replace(/[\r\n"]/g, " ").trim();
}

function xmltvDate(value: string): string {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`;
}

export function buildM3u(channels: Channel[], origin: string): string {
  const lines = [`#EXTM3U url-tvg="${origin}/iptv/xmltv.xml"`];
  for (const channel of channels) {
    const name = m3uEscape(channel.name);
    lines.push(
      `#EXTINF:-1 tvg-id="channeldock.${channel.id}" tvg-chno="${channel.number}" tvg-name="${name}"${channel.logoRatingKey ? ` tvg-logo="${origin}/artwork/${channel.logoRatingKey}"` : ""} group-title="ChannelDock",${name}`,
      `${origin}/stream/channels/${channel.id}.ts`
    );
  }
  return `${lines.join("\n")}\n`;
}

export function buildXmltv(channels: Channel[], schedules: ChannelSchedule[], origin: string): string {
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const lines = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<tv generator-info-name=\"ChannelDock\">"];
  for (const channel of channels) {
    lines.push(`  <channel id="channeldock.${channel.id}"><display-name>${xmlEscape(channel.name)}</display-name><display-name>${channel.number}</display-name>${channel.logoRatingKey ? `<icon src="${xmlEscape(`${origin}/artwork/${channel.logoRatingKey}`)}" />` : ""}</channel>`);
  }
  for (const schedule of schedules) {
    const channel = channelById.get(schedule.channelId);
    if (!channel) continue;
    for (const programme of schedule.programmes) {
      lines.push(`  <programme start="${xmltvDate(programme.start)}" stop="${xmltvDate(programme.end)}" channel="channeldock.${channel.id}">`);
      const guideTitle = programme.type === "episode" && programme.seriesTitle ? programme.seriesTitle : programme.title;
      lines.push(`    <title lang="en">${xmlEscape(guideTitle)}</title>`);
      if (programme.type === "episode") lines.push(`    <sub-title lang="en">${xmlEscape(programme.title)}</sub-title>`);
      if (programme.summary) lines.push(`    <desc lang="en">${xmlEscape(programme.summary)}</desc>`);
      if (programme.year) lines.push(`    <date>${programme.year}</date>`);
      if (programme.thumb) lines.push(`    <icon src="${xmlEscape(`${origin}/artwork/${programme.ratingKey}`)}" />`);
      if (programme.type === "episode" && programme.seasonNumber !== null && programme.episodeNumber !== null) {
        lines.push(`    <episode-num system="xmltv_ns">${Math.max(0, programme.seasonNumber - 1)}.${Math.max(0, programme.episodeNumber - 1)}.</episode-num>`);
      }
      lines.push(`    <category lang="en">${programme.type === "episode" ? "Series" : "Movie"}</category>`);
      if (programme.contentRating) lines.push(`    <rating><value>${xmlEscape(programme.contentRating)}</value></rating>`);
      lines.push("  </programme>");
    }
  }
  lines.push("</tv>");
  return `${lines.join("\n")}\n`;
}
