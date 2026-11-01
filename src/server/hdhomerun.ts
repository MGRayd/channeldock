import type { Channel } from "./db.js";

export const HDHR_DEVICE_ID = "12345678";
export const HDHR_TUNER_COUNT = 4;

function xmlEscape(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;"
  })[character] ?? character);
}

export function buildDiscover(origin: string) {
  return {
    FriendlyName: "ChannelDock",
    Manufacturer: "Silicondust",
    ModelNumber: "HDHR5-4DT",
    FirmwareName: "hdhomerun5_dvbt",
    FirmwareVersion: "20261101",
    DeviceID: HDHR_DEVICE_ID,
    DeviceAuth: "channeldock",
    TunerCount: HDHR_TUNER_COUNT,
    BaseURL: origin,
    LineupURL: `${origin}/lineup.json`
  };
}

export function buildLineup(channels: Channel[], origin: string) {
  return channels.map((channel) => ({
    GuideNumber: String(channel.number),
    GuideName: channel.name,
    URL: `${origin}/auto/v${channel.number}`
  }));
}

export function buildLineupXml(channels: Channel[], origin: string): string {
  const programmes = channels.map((channel) => [
    "  <Program>",
    `    <GuideNumber>${channel.number}</GuideNumber>`,
    `    <GuideName>${xmlEscape(channel.name)}</GuideName>`,
    `    <URL>${xmlEscape(`${origin}/auto/v${channel.number}`)}</URL>`,
    "  </Program>"
  ].join("\n"));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Lineup>\n${programmes.join("\n")}\n</Lineup>\n`;
}

export function buildDeviceXml(origin: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <URLBase>${xmlEscape(origin)}</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>ChannelDock</friendlyName>
    <manufacturer>Silicondust</manufacturer>
    <manufacturerURL>https://www.silicondust.com/</manufacturerURL>
    <modelDescription>ChannelDock Virtual TV Tuner</modelDescription>
    <modelName>HDHomeRun</modelName>
    <modelNumber>HDHR5-4DT</modelNumber>
    <serialNumber>${HDHR_DEVICE_ID}</serialNumber>
    <UDN>uuid:ChannelDock-${HDHR_DEVICE_ID}</UDN>
  </device>
</root>`;
}
