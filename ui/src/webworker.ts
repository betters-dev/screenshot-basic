let gl: WebGLRenderingContext | null = null;
let canvas: OffscreenCanvas | null = null;

let requestQueue: any[] = [];
let isProcessing = false;

let recycledBuffer: ArrayBuffer | null = null;
let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

const vsSource = `
    attribute vec2 a_position;
    attribute vec2 a_texcoord;
    varying vec2 vUv;

    void main() {
        vUv = vec2(a_texcoord.x, 1.0 - a_texcoord.y); // fuck gl uv coords
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

const fsSource = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;

    void main() {
        gl_FragColor = texture2D(tDiffuse, vUv);
    }
`;

function setupWebGL() {
  if (!gl) return;

  const makeShader = (type: number, src: string) => {
    const shader = gl!.createShader(type);
    if (!shader) return null;
    gl!.shaderSource(shader, src);
    gl!.compileShader(shader);

    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      console.error(gl!.getShaderInfoLog(shader));
    }
    return shader;
  };

  const vertexShader = makeShader(gl.VERTEX_SHADER, vsSource);
  const fragmentShader = makeShader(gl.FRAGMENT_SHADER, fsSource);

  const program = gl.createProgram();
  if (!program || !vertexShader || !fragmentShader) return;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.useProgram(program);

  // Texture Setup
  const tex = gl.createTexture();
  const texPixels = new Uint8Array([0, 0, 0, 0]);

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texPixels);

  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

  // Magic hook sequence for FiveM
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  // Reset
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Buffer Setup
  const vertexBuff = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuff);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const texBuff = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuff);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

  // Attribute Binding
  const vloc = gl.getAttribLocation(program, "a_position");
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuff);
  gl.vertexAttribPointer(vloc, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vloc);

  const tloc = gl.getAttribLocation(program, "a_texcoord");
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuff);
  gl.vertexAttribPointer(tloc, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(tloc);

  gl.uniform1i(gl.getUniformLocation(program, "tDiffuse"), 0);
}

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;

  const req = requestQueue.shift();

  if (gl && canvas) {
    // 1. Render exactly one frame
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.finish();

    // 2. Handle the request
    await handleRequest(req);
  }

  isProcessing = false;
  // Request next frame if queue not empty
  if (requestQueue.length > 0) {
    requestAnimationFrame(processQueue);
  }
}

async function handleRequest(req: any) {
  if (!gl || !canvas) return;

  const width = canvas.width;
  const height = canvas.height;

  const expectedByteLength = width * height * 4;
  if (recycledBuffer && recycledBuffer.byteLength !== expectedByteLength) {
    recycledBuffer = null;
  }

  const buffer = recycledBuffer || new ArrayBuffer(expectedByteLength);
  const read = new Uint8Array(buffer);
  recycledBuffer = null;

  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, read);

  // Reuse OffscreenCanvas for 2D processing
  if (!offscreenCanvas || offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas = new OffscreenCanvas(width, height);
    offscreenCtx = offscreenCanvas.getContext("2d");
  }

  if (offscreenCtx) {
    const imageData = new ImageData(new Uint8ClampedArray(read.buffer), width, height);
    offscreenCtx.putImageData(imageData, 0, 0);
  }

  let type = "image/png";
  if (req.encoding === "jpg") type = "image/jpeg";
  else if (req.encoding === "webp") type = "image/webp";

  const blob = await offscreenCanvas.convertToBlob({ type, quality: req.quality || 0.92 });

  if (!req.targetField) {
    const reader = new FileReaderSync();
    const dataUrl = reader.readAsDataURL(blob);
    self.postMessage({ taskId: req.taskId, dataUrl, recycledBuffer: read.buffer }, [read.buffer]);
  } else {
    self.postMessage({ taskId: req.taskId, blob, recycledBuffer: read.buffer }, [read.buffer]);
  }
}

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === "init") {
    canvas = payload.canvas;
    gl = canvas!.getContext("webgl", {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      desynchronized: true,
      failIfMajorPerformanceCaveat: false,
      preserveDrawingBuffer: true,
    }) as WebGLRenderingContext;

    setupWebGL();
  } else if (type === "resize") {
    if (canvas && gl) {
      canvas.width = payload.width;
      canvas.height = payload.height;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  } else if (type === "request") {
    requestQueue.push(payload);
    processQueue();
  }
};
