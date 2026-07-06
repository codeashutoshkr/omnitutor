// MicProcessor: runs in the AudioWorklet context at sampleRate = 16kHz.
// The AudioContext is already created at 16kHz — NO downsampling needed.
//
// Buffer size: 2048 samples = 128ms per chunk @ 16kHz.
// This halves the previous 256ms delay, meaning the last words you say
// before stopping reach Gemini ~128ms sooner, making turn detection faster.
// Still sends only ~8 packets/sec — far better than the original 125/sec.

class MicProcessor extends AudioWorkletProcessor {

  constructor() {
    super();
    this._buffer = new Float32Array(2048);
    this._writePos = 0;
    this._SEND_SIZE = 2048; // 128ms of audio @ 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0]; // Float32Array @ 16000 Hz — correct, no downsample
    const inLen = channelData.length;

    let srcOffset = 0;
    while (srcOffset < inLen) {
      const remaining = inLen - srcOffset;
      const space = this._SEND_SIZE - this._writePos;
      const toCopy = Math.min(remaining, space);

      this._buffer.set(channelData.subarray(srcOffset, srcOffset + toCopy), this._writePos);
      this._writePos += toCopy;
      srcOffset += toCopy;

      if (this._writePos >= this._SEND_SIZE) {
        // Post a copy (not the same buffer reference) to avoid data races
        this.port.postMessage(this._buffer.slice(0));
        this._writePos = 0;
      }
    }

    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);