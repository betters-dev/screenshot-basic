import {
  OrthographicCamera,
  Scene,
  WebGLRenderTarget,
  LinearFilter,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
  CfxTexture,
  ShaderMaterial,
  PlaneGeometry,
  Mesh,
  WebGLRenderer,
} from "@citizenfx/three";

interface ScreenshotRequest {
  encoding: "webp" | "jpg" | "png";
  quality?: number;
  headers: any;
  correlation: string;
  resultURL: string;
  targetURL: string;
  targetField: string;
}

const workerCode = `
    let canvas = new OffscreenCanvas(1, 1);
    let ctx = canvas.getContext('2d');

    self.onmessage = async (e) => {
        const { buffer, width, height, quality, encoding, taskId, needsBase64 } = e.data;

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }

        const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
        ctx.putImageData(imageData, 0, 0);

        let type = 'image/webp';
        if (encoding === 'jpg') type = 'image/jpeg';
        else if (encoding === 'png') type = 'image/png';

        const blob = await canvas.convertToBlob({ type, quality });

        if (needsBase64) {
            const reader = new FileReaderSync();
            const dataUrl = reader.readAsDataURL(blob);

            self.postMessage({ taskId, dataUrl, recycledBuffer: buffer }, [buffer]);
        } else {
            self.postMessage({ taskId, blob, recycledBuffer: buffer }, [buffer]);
        }
    };
`;

const workerBlob = new Blob([workerCode], { type: "application/javascript" });
const workerUrl = URL.createObjectURL(workerBlob);
const worker = new Worker(workerUrl);

class ScreenshotUI {
  renderer: WebGLRenderer;
  rtTexture: WebGLRenderTarget;
  sceneRTT: Scene;
  cameraRTT: OrthographicCamera;
  material: ShaderMaterial;
  quad: Mesh;

  requests: ScreenshotRequest[] = [];
  isAnimating: boolean = false;

  recycledBuffer: ArrayBuffer | null = null;

  pendingTasks = new Map<string, Function>();

  initialize() {
    this.animate = this.animate.bind(this);

    window.addEventListener("message", (event) => {
      if (event.data?.request) {
        this.requests.push(event.data.request);

        if (!this.isAnimating) {
          this.isAnimating = true;
          requestAnimationFrame(this.animate);
        }
      }
    });

    worker.addEventListener("message", (e) => {
      const { taskId, blob, dataUrl, recycledBuffer } = e.data;

      if (recycledBuffer) {
        this.recycledBuffer = recycledBuffer;
      }

      if (this.pendingTasks.has(taskId)) {
        const resolve = this.pendingTasks.get(taskId);
        resolve({ blob, dataUrl });
        this.pendingTasks.delete(taskId);
      }
    });

    window.addEventListener("resize", () => {
      this.resize();
    });

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.cameraRTT = new OrthographicCamera(
      width / -2,
      width / 2,
      height / 2,
      height / -2,
      -10000,
      10000,
    );
    this.cameraRTT.position.z = 100;

    this.sceneRTT = new Scene();

    this.rtTexture = new WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      minFilter: LinearFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: UnsignedByteType,
    });
    const gameTexture: any = new CfxTexture();
    gameTexture.needsUpdate = true;

    this.material = new ShaderMaterial({
      uniforms: { tDiffuse: { value: gameTexture } },
      vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = vec2(uv.x, 1.0-uv.y); // fuck gl uv coords
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,
      fragmentShader: `
			varying vec2 vUv;
			uniform sampler2D tDiffuse;
			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );
			}`,
    });

    const plane = new PlaneGeometry(1, 1);
    this.quad = new Mesh(plane, this.material);
    this.quad.scale.set(width, height, 1);
    this.quad.position.z = -100;
    this.sceneRTT.add(this.quad);

    this.renderer = new WebGLRenderer();
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height);
    this.renderer.autoClear = false;

    const appElement = document.getElementById("app");
    if (appElement) {
      appElement.appendChild(this.renderer.domElement);
      appElement.style.display = "none";
    }
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.cameraRTT.left = width / -2;
    this.cameraRTT.right = width / 2;
    this.cameraRTT.top = height / 2;
    this.cameraRTT.bottom = height / -2;
    this.cameraRTT.updateProjectionMatrix();

    this.quad.scale.set(width, height, 1);

    this.rtTexture.setSize(width, height);
    this.renderer.setSize(width, height);
  }

  async animate() {
    if (this.requests.length > 0) {
      const request = this.requests.shift();

      if (request) {
        this.renderer.clear();
        this.renderer.render(this.sceneRTT, this.cameraRTT, this.rtTexture, true);

        await this.handleRequest(request);
      }

      requestAnimationFrame(this.animate);
    } else {
      this.isAnimating = false;
    }
  }

  async handleRequest(request: ScreenshotRequest) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const expectedByteLength = width * height * 4;

    if (this.recycledBuffer && this.recycledBuffer.byteLength !== expectedByteLength) {
      this.recycledBuffer = null;
    }
    const buffer = this.recycledBuffer || new ArrayBuffer(expectedByteLength);
    const read = new Uint8Array(buffer);
    this.recycledBuffer = null;

    this.renderer.readRenderTargetPixels(this.rtTexture, 0, 0, width, height, read);

    const taskId = crypto.randomUUID();
    const needsBase64 = !request.targetField;

    const result: { blob?: Blob; dataUrl?: string } = await new Promise((resolve) => {
      this.pendingTasks.set(taskId, resolve);

      worker.postMessage(
        {
          buffer: read.buffer,
          width,
          height,
          quality: request.quality || 0.92,
          encoding: request.encoding,
          taskId,
          needsBase64,
        },
        [read.buffer],
      );
    });

    const upload = (body: any) => {
      fetch(request.targetURL, {
        method: "POST",
        mode: "cors",
        headers: request.headers,
        body,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`failed to upload: ${response.status}`);
          }
          return response.text();
        })
        .then((text) => {
          if (request.resultURL) {
            fetch(request.resultURL, {
              method: "POST",
              mode: "cors",
              body: JSON.stringify({
                data: text,
                id: request.correlation,
              }),
            }).catch((err) => console.error("error during result upload:", err));
          }
        })
        .catch((err) => console.error("error during file upload:", err));
    };

    if (request.targetField && result.blob) {
      const formData = new FormData();
      formData.append(request.targetField, result.blob, `screenshot.${request.encoding}`);
      upload(formData);
    } else if (result.dataUrl) {
      upload(
        JSON.stringify({
          data: result.dataUrl,
          id: request.correlation,
        }),
      );
    }
  }
}

const ui = new ScreenshotUI();
ui.initialize();
