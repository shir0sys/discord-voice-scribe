// Transcription via whisper.cpp — a system binary, not an npm package, same
// pattern as ffmpeg/yt-dlp in discordbot.js's own music-bot.js example:
//   https://github.com/ggml-org/whisper.cpp
// Needs WHISPER_MODEL set to a ggml model file's path (e.g. ggml-base.bin),
// and WHISPER_BIN if the binary isn't named "whisper-cli" on your system.
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");

const WHISPER_BIN = process.env.WHISPER_BIN || "whisper-cli";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stderr = "";
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => reject(new Error(`${command} failed to start: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
      else resolve();
    });
  });
}

const SRT_TIME = /(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/;

function toSeconds(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function parseSrt(content) {
  const segments = [];
  for (const block of content.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((line) => line.length > 0);
    const timeLineIndex = lines.findIndex((line) => SRT_TIME.test(line));
    if (timeLineIndex === -1) continue;

    const match = lines[timeLineIndex].match(SRT_TIME);
    const text = lines.slice(timeLineIndex + 1).join(" ").trim();
    if (!text) continue;

    segments.push({
      start: toSeconds(match[1], match[2], match[3], match[4]),
      end: toSeconds(match[5], match[6], match[7], match[8]),
      text,
    });
  }
  return segments;
}

/** Resamples to 16kHz mono (what whisper.cpp expects) then runs whisper.cpp, returning timestamped segments. */
async function transcribeFile(wavPath) {
  const model = process.env.WHISPER_MODEL;
  if (!model) throw new Error("WHISPER_MODEL n'est pas défini (chemin vers un modèle ggml .bin)");

  const resampledPath = wavPath.replace(/\.wav$/, ".16k.wav");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-ar", "16000", "-ac", "1", resampledPath]);

  const outPrefix = wavPath.replace(/\.wav$/, "");
  try {
    await run(WHISPER_BIN, ["-m", model, "-f", resampledPath, "-osrt", "-of", outPrefix]);
    const content = await fs.readFile(`${outPrefix}.srt`, "utf8");
    return parseSrt(content);
  } finally {
    await fs.unlink(resampledPath).catch(() => {});
  }
}

module.exports = { transcribeFile, parseSrt };
