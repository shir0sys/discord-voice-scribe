# discord-voice-scribe

Discord bot that records a voice channel **track by track** (one WAV file per speaker) and transcribes each track locally with [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — nothing is sent to an external service.

Built on [`discordbot.js`](https://github.com/shir0sys/discordbot.js), specifically its voice receive support (`audioPacket`). This project is what first verified that feature against a real Discord call, and surfaced several fixes in the library itself (RTP decryption with header extensions, filtering out RTCP traffic).

## How it works

- `/record` — joins your current voice channel, starts capturing everyone who speaks.
- `/stoprecord` — stops, leaves the channel, transcribes each track, and writes a merged chronological transcript.

Each speaker's WAV track is silence-padded to the session's wall-clock timeline (not to anyone else's speech), so even without transcription the files stay aligned in time with each other — handy if you want to resync them in an audio editor.

Output in `recordings/<guildId>-<timestamp>/`:
- `<userId>.wav` per speaker (48kHz, stereo, 16-bit)
- `transcript.txt` — every speaker's lines merged and sorted chronologically, formatted as `[mm:ss] Username#0000: text`

## Requirements

- **Node.js >= 22**
- **`ffmpeg`** installed and on your PATH (resamples 48kHz→16kHz before transcription)
- **[whisper.cpp](https://github.com/ggml-org/whisper.cpp)** — optional, only needed for transcription (without it, audio is still recorded)

Without transcription configured, the bot still works — it just records audio without producing a `transcript.txt`.

## Installation

```bash
git clone https://github.com/shir0sys/discord-voice-scribe.git
cd discord-voice-scribe
npm install
cp .env.example .env
```

Fill in `DISCORD_TOKEN` in `.env` with your Discord application's token (create one at https://discord.com/developers/applications, with the `bot` + `applications.commands` scopes, and at least the `Connect` permission on the voice channel).

```bash
npm start
```

In Discord, run `/record` in a voice channel, talk, then `/stoprecord`.

## Enabling transcription (whisper.cpp)

Unlike most whisper.cpp integrations that re-launch the `whisper-cli` binary for every file (which reloads the whole model into memory — several seconds lost before transcription even starts), this bot talks over HTTP to a **`whisper-server`** that stays running in the background with the model already loaded. A `/stoprecord` then only pays for the actual inference time.

### 1. Get whisper.cpp

Download a prebuilt release from the [releases page](https://github.com/ggml-org/whisper.cpp/releases) (look for assets named `whisper-bin-*`):

- **CPU only**: `whisper-bin-win-x64.zip` (or the Linux/macOS equivalent)
- **NVIDIA GPU (recommended if you have one)**: `whisper-bin-win-cuda-12.4.0-x64.zip` — noticeably faster, the real way to get near-instant transcription

Unzip it wherever you like, e.g. `C:\whisper\`.

### 2. Download a model

```bash
curl -L -o ggml-large-v3-turbo.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

`large-v3-turbo` is currently the best accuracy/speed tradeoff (full encoder, lightened decoder). For a more modest machine: `ggml-small.bin` or `ggml-medium.bin` (smaller, less accurate on slang/fast speech, but faster CPU-only).

### 3. Launch whisper-server

```bash
# Windows, example with the CUDA build:
C:\whisper\Release\whisper-server.exe -m C:\whisper\ggml-large-v3-turbo.bin -l fr -t 8 --port 8080
```

Leave it running in its own terminal — it needs to stay up while the bot is running. `-l fr` forces the language (without it, whisper.cpp defaults to English, **not** auto-detection, despite what you'd expect — change it to match whatever language you'll actually be speaking). `-t` is the CPU thread count; bump it up if you have a lot of cores and no GPU.

### 4. Configure `.env`

```
WHISPER_SERVER_URL=http://127.0.0.1:8080
WHISPER_LANGUAGE=fr
```

That's it — restart `npm start`, and `/stoprecord` will transcribe automatically.

## Known limitations

- **No VAD**: every Opus frame received is written as-is, including background noise if someone's mic stays open.
- **Whisper sometimes hallucinates text** on silence or on very short/fast slangy speech — a known behavior of Whisper models, not a bug in this bot. A bigger model (`medium` → `large-v3-turbo`) reduces this without eliminating it.
- **Transcription happens after the fact, not live**: each track is transcribed once the recording stops, no live captions while people are talking.
- **DAVE (end-to-end encryption) with many simultaneous participants**: tested and working with one or two speakers; behavior in a very active channel (frequent joins/leaves, frequent key rotation) is less exercised.

## Troubleshooting

- **"Join a voice channel first"** → you need to be in a voice channel on the server before running `/record`.
- **Empty transcript or "WHISPER_SERVER_URL not configured"** → check that `whisper-server` is actually running and that `.env` points at the right URL/port.
- **`ffmpeg`/`whisper-server` not found** → give the full path in the launch command if the binary isn't on your PATH.
