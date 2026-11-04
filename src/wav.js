const fs = require("node:fs");

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;

// RIFF/data chunk sizes aren't known until the recording ends, so the header
// is written with placeholder zeros up front and patched in place on close
// instead of buffering the whole file in memory first.
function writeHeaderPlaceholder(fd) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28); // byte rate
  header.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32); // block align
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  fs.writeSync(fd, header, 0, header.length, 0);
}

function patchSizes(fd, dataBytes) {
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(36 + dataBytes, 0);
  fs.writeSync(fd, riffSize, 0, 4, 4);

  const dataSize = Buffer.alloc(4);
  dataSize.writeUInt32LE(dataBytes, 0);
  fs.writeSync(fd, dataSize, 0, 4, 40);
}

/** One 48kHz/stereo/16-bit WAV file, written incrementally so a long recording never sits fully in memory. */
class WavWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.fd = fs.openSync(filePath, "w");
    this.bytesWritten = 0;
    writeHeaderPlaceholder(this.fd);
  }

  get samplesWritten() {
    return this.bytesWritten / (CHANNELS * (BITS_PER_SAMPLE / 8));
  }

  append(pcm) {
    fs.writeSync(this.fd, pcm, 0, pcm.length, 44 + this.bytesWritten);
    this.bytesWritten += pcm.length;
  }

  /** Pads with silence up to `targetSamples`, so every speaker's file stays aligned to the same wall-clock timeline. */
  padToSamples(targetSamples) {
    const targetBytes = targetSamples * CHANNELS * (BITS_PER_SAMPLE / 8);
    if (targetBytes <= this.bytesWritten) return;
    this.append(Buffer.alloc(targetBytes - this.bytesWritten));
  }

  close() {
    patchSizes(this.fd, this.bytesWritten);
    fs.closeSync(this.fd);
  }
}

module.exports = { WavWriter, SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE };
