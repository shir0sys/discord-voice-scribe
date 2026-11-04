// Transcription via a running whisper.cpp server (whisper-server.exe),
// not the one-shot whisper-cli binary: whisper-cli reloads the whole
// model (1-3GB) from disk on every single call, which alone takes longer
// than transcribing a short clip. Pointing this at a server that keeps the
// model resident in memory (and optionally on a GPU) cuts turnaround from
// "reload + transcribe" down to just "transcribe".
//   https://github.com/ggml-org/whisper.cpp/tree/master/examples/server
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");

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
    const text = lines
      .slice(timeLineIndex + 1)
      .join(" ")
      .trim();
    if (!text) continue;

    segments.push({
      start: toSeconds(match[1], match[2], match[3], match[4]),
      end: toSeconds(match[5], match[6], match[7], match[8]),
      text,
    });
  }
  return segments;
}

/** Resamples to 16kHz mono (what whisper.cpp expects) then POSTs it to a running whisper-server, returning timestamped segments. */
async function transcribeFile(wavPath) {
  const serverUrl = process.env.WHISPER_SERVER_URL;
  if (!serverUrl) throw new Error("WHISPER_SERVER_URL n'est pas défini (ex: http://127.0.0.1:8080)");

  const resampledPath = wavPath.replace(/\.wav$/, ".16k.wav");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", wavPath, "-ar", "16000", "-ac", "1", resampledPath]);

  try {
    const audio = await fs.readFile(resampledPath);
    const form = new FormData();
    form.append("file", new Blob([audio]), "audio.wav");
    form.append("response_format", "srt");
    if (process.env.WHISPER_LANGUAGE) form.append("language", process.env.WHISPER_LANGUAGE);

    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/inference`, { method: "POST", body: form });
    if (!response.ok) {
      throw new Error(`whisper-server a répondu ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    return parseSrt(await response.text());
  } finally {
    await fs.unlink(resampledPath).catch(() => {});
  }
}

module.exports = { transcribeFile, parseSrt };
