export interface MuxerOptions {
  width: number;
  height: number;
  codec?: 'vp8' | 'vp9';
}

export class WebCodecMuxer {
  private chunks: Uint8Array[] = [];
  private options: MuxerOptions;
  private isHeaderWritten = false;
  private lastTimestamp = 0;

  constructor(options: MuxerOptions) {
    this.options = { codec: 'vp9', ...options };
  }

  private writeVint(value: number): Uint8Array {
    if (value < 128) return new Uint8Array([value | 0x80]);
    if (value < 16384) return new Uint8Array([(value >> 8) | 0x40, value & 0xff]);
    if (value < 2097152) return new Uint8Array([(value >> 16) | 0x20, (value >> 8) & 0xff, value & 0xff]);
    return new Uint8Array([(value >> 24) | 0x10, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
  }

  private writeFloat64(value: number): Uint8Array {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, value, false);
    return new Uint8Array(buffer);
  }

  private createElement(id: number[], data: Uint8Array | number[]): Uint8Array {
    const dataBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const sizeBytes = this.writeVint(dataBytes.length);
    const element = new Uint8Array(id.length + sizeBytes.length + dataBytes.length);
    element.set(id, 0);
    element.set(sizeBytes, id.length);
    element.set(dataBytes, id.length + sizeBytes.length);
    return element;
  }

  private writeHeader() {
    if (this.isHeaderWritten) return;

    const ebmlHeader = this.createElement([0x1A, 0x45, 0xDF, 0xA3], new Uint8Array([
      ...this.createElement([0x42, 0x86], [1]), // EBMLVersion
      ...this.createElement([0x42, 0xF7], [1]), // EBMLReadVersion
      ...this.createElement([0x42, 0xF2], [4]), // EBMLMaxIDLength
      ...this.createElement([0x42, 0xF3], [8]), // EBMLMaxSizeLength
      ...this.createElement([0x42, 0x82], new TextEncoder().encode("webm")), // DocType
      ...this.createElement([0x42, 0x87], [2]), // DocTypeVersion
      ...this.createElement([0x42, 0x85], [2])  // DocTypeReadVersion
    ]));

    const timecodeScale = this.createElement([0x2A, 0xD7, 0xB1], [0x00, 0x0F, 0x42, 0x40]); // 1,000,000 (1ms)
    const info = this.createElement([0x15, 0x49, 0xA9, 0x66], timecodeScale);

    const codecIdStr = this.options.codec === 'vp8' ? "V_VP8" : "V_VP9";
    const codecId = this.createElement([0x86], new TextEncoder().encode(codecIdStr));
    const width = this.createElement([0xB0], [(this.options.width >> 8) & 0xff, this.options.width & 0xff]);
    const height = this.createElement([0xBA], [(this.options.height >> 8) & 0xff, this.options.height & 0xff]);
    const video = this.createElement([0xE0], new Uint8Array([...width, ...height]));

    const trackEntry = this.createElement([0xAE], new Uint8Array([
      ...this.createElement([0xD7], [1]), // TrackNumber
      ...this.createElement([0x83], [1]), // TrackType (Video)
      ...codecId,
      ...video
    ]));

    const tracks = this.createElement([0x16, 0x54, 0xAE, 0x6B], trackEntry);

    const segmentId = new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);

    this.chunks.push(ebmlHeader, segmentId, info, tracks);
    this.isHeaderWritten = true;
  }

  public addVideoChunk(chunk: EncodedVideoChunk) {
    if (!this.isHeaderWritten) this.writeHeader();

    this.lastTimestamp = Math.max(this.lastTimestamp, chunk.timestamp);

    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);

    const trackNumber = 1;
    const timecode = Math.floor(chunk.timestamp / 1000); // Absolute time in ms
    const flags = chunk.type === 'key' ? 0x80 : 0x00;

    const trackNumVint = this.writeVint(trackNumber);
    const simpleBlockHeader = new Uint8Array(trackNumVint.length + 3);
    simpleBlockHeader.set(trackNumVint, 0);

    simpleBlockHeader[trackNumVint.length] = 0x00;
    simpleBlockHeader[trackNumVint.length + 1] = 0x00;
    simpleBlockHeader[trackNumVint.length + 2] = flags;

    const simpleBlockData = new Uint8Array(simpleBlockHeader.length + data.length);
    simpleBlockData.set(simpleBlockHeader, 0);
    simpleBlockData.set(data, simpleBlockHeader.length);

    const simpleBlock = this.createElement([0xA3], simpleBlockData);

    const clusterTimecode = this.createElement([0xE7], [(timecode >> 8) & 0xff, timecode & 0xff]);
    const cluster = this.createElement([0x1F, 0x43, 0xB6, 0x75], new Uint8Array([...clusterTimecode, ...simpleBlock]));

    this.chunks.push(cluster);
  }

  public finalize(): Blob {
    const durationInMs = this.lastTimestamp / 1000;

    const durationElement = this.createElement([0x44, 0x89], this.writeFloat64(durationInMs));
    const timecodeScale = this.createElement([0x2A, 0xD7, 0xB1], [0x00, 0x0F, 0x42, 0x40]); // 1ms
    const info = this.createElement([0x15, 0x49, 0xA9, 0x66], new Uint8Array([...timecodeScale, ...durationElement]));

    const finalizedChunks = [...this.chunks];
    if (finalizedChunks.length >= 3) {
      finalizedChunks[2] = info;
    }

    return new Blob(finalizedChunks, { type: 'video/webm' });
  }
}