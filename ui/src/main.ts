interface ScreenshotRequest {
  encoding: "jpg" | "png" | "webp";
  quality: number;
  headers: any;

  correlation: string;

  resultURL: string;

  targetURL: string;
  targetField: string;

  recordVideo?: boolean;
  duration?: number;
}

class ScreenshotUI {
  canvas: HTMLCanvasElement;
  worker: Worker;
  pendingTasks = new Map<string, (result: any) => void>();
  pendingVideoFrameHandlers = new Map<string, (bitmap: ImageBitmap) => void>();
  recycledBuffer: ArrayBuffer | null = null;

  initialize() {
    this.worker = new Worker("webworker.js");
    this.worker.onmessage = (e) => {
      const { taskId, blob, dataUrl, recycledBuffer } = e.data;

      if (recycledBuffer) {
        this.recycledBuffer = recycledBuffer;
      }

      if (this.pendingTasks.has(taskId)) {
        const resolve = this.pendingTasks.get(taskId)!;
        resolve({ blob, dataUrl });
        this.pendingTasks.delete(taskId);
      }

      if (e.data.type === "video_frame" && e.data.bitmap) {
        const handler = this.pendingVideoFrameHandlers.get(e.data.taskId);
        if (handler) {
          handler(e.data.bitmap);
        } else {
          e.data.bitmap.close();
        }
      }
    };

    // Transfer canvas
    this.canvas = document.createElement("canvas");
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    const offscreen = this.canvas.transferControlToOffscreen();
    this.worker.postMessage(
      {
        type: "init",
        payload: { canvas: offscreen },
      },
      [offscreen],
    );

    const appDiv = document.getElementById("app");
    if (appDiv) {
      appDiv.appendChild(this.canvas);
      appDiv.style.display = "none";
    }

    window.addEventListener("message", (event) => {
      if (event.data?.request) {
        this.handleRequest(event.data.request);
      }
    });

    window.addEventListener("resize", () => {
      this.worker.postMessage({
        type: "resize",
        payload: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
      });
    });
  }

  async handleRequest(request: ScreenshotRequest) {
    if (request.recordVideo) {
      return this.handleVideoRequest(request);
    }

    const taskId = crypto.randomUUID();

    const result: { blob?: Blob; dataUrl?: string } = await new Promise((resolve) => {
      this.pendingTasks.set(taskId, resolve);

      this.worker.postMessage({
        type: "request",
        payload: {
          ...request,
          taskId,
        },
      });
    });

    const upload = (body: any) => {
      fetch(request.targetURL, {
        method: "POST",
        mode: "cors",
        headers: request.headers,
        body,
      })
        .then((response) => response.text())
        .then((text) => {
          if (request.resultURL) {
            fetch(request.resultURL, {
              method: "POST",
              mode: "cors",
              body: JSON.stringify({
                data: text,
                id: request.correlation,
              }),
            });
          }
        });
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

  async handleVideoRequest(request: ScreenshotRequest) {
    const taskId = crypto.randomUUID();
    const duration = request.duration || 5000;

    const recordCanvas = document.createElement("canvas");
    recordCanvas.width = window.innerWidth;
    recordCanvas.height = window.innerHeight;
    const ctx = recordCanvas.getContext("2d")!;

    const stream = recordCanvas.captureStream(30);
    const mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    const frameHandler = (bitmap: ImageBitmap) => {
      ctx.save();
      ctx.scale(1, -1);
      ctx.drawImage(bitmap, 0, -recordCanvas.height);
      ctx.restore();
      bitmap.close();
    };

    this.pendingVideoFrameHandlers.set(taskId, frameHandler);

    mediaRecorder.start();
    this.worker.postMessage({ type: "start_video", payload: { taskId } });

    await new Promise((resolve) => setTimeout(resolve, duration));

    this.worker.postMessage({ type: "stop_video" });
    mediaRecorder.stop();

    const videoBlob = await new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () => {
        this.pendingVideoFrameHandlers.delete(taskId);
        resolve(new Blob(chunks, { type: "video/webm" }));
      };
    });

    const upload = (body: any) => {
      fetch(request.targetURL, {
        method: "POST",
        mode: "cors",
        headers: request.headers,
        body,
      })
        .then((response) => response.text())
        .then((text) => {
          if (request.resultURL) {
            fetch(request.resultURL, {
              method: "POST",
              mode: "cors",
              body: JSON.stringify({
                data: text,
                id: request.correlation,
              }),
            });
          }
        });
    };

    if (request.targetField) {
      const formData = new FormData();
      formData.append(request.targetField, videoBlob, "video.webm");
      upload(formData);
    } else {
      const reader = new FileReader();
      reader.onloadend = () => {
        upload(
          JSON.stringify({
            data: reader.result,
            id: request.correlation,
          }),
        );
      };
      reader.readAsDataURL(videoBlob);
    }
  }
}

const ui = new ScreenshotUI();
ui.initialize();
