interface WorkerRequest {
  taskId: string;
  encoding: string;
  quality: number;
  targetURL: string;
  resultURL?: string;
  targetField?: string;
  headers?: Record<string, string>;
  correlation?: string;
  fields?: Record<string, string>;
}

let gl: WebGLRenderingContext | null = null;
let canvas: OffscreenCanvas | null = null;
let flipYLocation: WebGLUniformLocation | null = null;
let tex: WebGLTexture | null = null;

let requestQueue: WorkerRequest[] = [];
let isProcessing = false;
let isVideoRecording = false;

let recycledBuffer: ArrayBuffer | null = null;
let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

const vsSource = `
    attribute vec2 a_position;
    attribute vec2 a_texcoord;
    varying vec2 vUv;

    uniform float u_flipY;

    void main() {
        float y = mix(1.0 - a_texcoord.y, a_texcoord.y, u_flipY);

        vUv = vec2(a_texcoord.x, y);
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
      throw new Error(gl!.getShaderInfoLog(shader)!);
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

  tex = gl.createTexture();
  const texPixels = new Uint8Array([0, 0, 0, 0]);

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texPixels);

  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const vertexBuff = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuff);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const texBuff = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuff);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

  const vloc = gl.getAttribLocation(program, "a_position");
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuff);
  gl.vertexAttribPointer(vloc, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vloc);

  const tloc = gl.getAttribLocation(program, "a_texcoord");
  gl.bindBuffer(gl.ARRAY_BUFFER, texBuff);
  gl.vertexAttribPointer(tloc, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(tloc);

  gl.uniform1i(gl.getUniformLocation(program, "tDiffuse"), 0);
  flipYLocation = gl.getUniformLocation(program, "u_flipY");
  gl.uniform1f(flipYLocation, 0.0);
}

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;

  const req = requestQueue.shift()!;

  if (gl && canvas) {
    gl.uniform1f(flipYLocation, 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    await handleRequest(req);
  }

  isProcessing = false;
  if (requestQueue.length > 0) {
    requestAnimationFrame(processQueue);
  }
}

async function upload(req: WorkerRequest, body: BodyInit) {
  try {
    const response = await fetch(req.targetURL, {
      method: "POST",
      mode: "cors",
      headers: req.headers,
      body,
    });

    const text = await response.text();

    if (req.resultURL) {
      fetch(req.resultURL, {
        method: "POST",
        mode: "cors",
        body: JSON.stringify({ data: text, id: req.correlation }),
      });
    }

    return text;
  } catch (error) {
    throw error;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function handleRequest(req: WorkerRequest) {
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

  const blob = await offscreenCanvas!.convertToBlob({ type, quality: req.quality || 0.92 });

  if (req.targetField) {
    const formData = new FormData();
    formData.append(req.targetField, blob, `screenshot.${req.encoding}`);

    if (req.fields) {
      for (const [key, value] of Object.entries(req.fields)) {
        formData.append(key, value);
      }
    }

    await upload(req, formData);
  } else {
    const dataUrl = await blobToBase64(blob);
    await upload(req, JSON.stringify({ data: dataUrl, id: req.correlation }));
  }

  recycledBuffer = read.buffer;
  self.postMessage({ taskId: req.taskId, type: "screenshot_done" });
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
    // FIX BLACK SCREEN when resize
    if (canvas && gl && tex) {
      canvas.width = payload.width;
      canvas.height = payload.height;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  } else if (type === "request") {
    requestQueue.push(payload);
    processQueue();
  } else if (type === "start_video") {
    isVideoRecording = true;
    const loop = () => {
      if (!isVideoRecording) return;
      if (gl && canvas) {
        gl.uniform1f(flipYLocation, 1.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } else if (type === "stop_video") {
    isVideoRecording = false;
  } else if (type === "upload_video") {
    const { videoBlob, request } = payload;

    const uploadTask = async () => {
      if (request.targetField) {
        const formData = new FormData();
        formData.append(request.targetField, videoBlob, "video.webm");
        await upload(request, formData);
      } else {
        const dataUrl = await blobToBase64(videoBlob);
        await upload(request, JSON.stringify({ data: dataUrl, id: request.correlation }));
      }
      self.postMessage({ type: "video_uploaded", taskId: request.taskId });
    };

    uploadTask()
  }
};
