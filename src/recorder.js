const path = require("node:path");
const { OpusEncoder } = require("discordbot.js");
const { WavWriter, SAMPLE_RATE } = require("./wav");

function elapsedSamples(startedAt) {
  return Math.round(((Date.now() - startedAt) / 1000) * SAMPLE_RATE);
}

/**
 * One recording session for one guild's voice connection. Every speaker gets
 * their own WAV file, silence-padded to the wall-clock timeline (not to each
 * other's speech) so all files stay aligned — transcribing each one
 * separately later still produces timestamps comparable across speakers.
 */
class RecordingSession {
  constructor(connection, outDir) {
    this.connection = connection;
    this.outDir = outDir;
    this.startedAt = Date.now();
    this.tracks = new Map(); // userId -> { writer, decoder }

    this.onPacket = this.onPacket.bind(this);
    connection.on("audioPacket", this.onPacket);
  }

  onPacket({ userId, opusFrame }) {
    let track = this.tracks.get(userId);
    if (!track) {
      track = {
        writer: new WavWriter(path.join(this.outDir, `${userId}.wav`)),
        decoder: new OpusEncoder(),
      };
      this.tracks.set(userId, track);
    }

    let pcm;
    try {
      pcm = track.decoder.decode(opusFrame);
    } catch (error) {
      console.warn(`Opus decode failed for ${userId}, dropping frame:`, error.message);
      return;
    }

    track.writer.padToSamples(elapsedSamples(this.startedAt));
    track.writer.append(pcm);
  }

  /** Stops capturing and closes every track's file. Returns the list of {userId, filePath} recorded. */
  finish() {
    this.connection.off("audioPacket", this.onPacket);

    const total = elapsedSamples(this.startedAt);
    const files = [];
    for (const [userId, track] of this.tracks) {
      track.writer.padToSamples(total);
      track.writer.close();
      track.decoder.destroy();
      files.push({ userId, filePath: track.writer.filePath });
    }
    return files;
  }
}

module.exports = { RecordingSession };
