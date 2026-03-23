interface ScreenshotRequest {
  encoding: "jpg" | "png" | "webp";
  quality: number;
  headers: Record<string, string>;
  correlation: string;
  resultURL?: string;
  targetURL: string;
  targetField?: string;
  recordVideo?: boolean;
  duration?: number;
}

class ScreenshotUI {
  canvas!: HTMLCanvasElement;
  worker!: Worker;
  pendingTasks = new Map<string, (result: unknown) => void>();
  nextTaskId = 0;

  initialize() {
    this.worker = new Worker("webworker.ts");
    this.worker.onmessage = (e) => {
      const { taskId, type, payload } = e.data;

      if (this.pendingTasks.has(taskId) && type !== "video_frame") {
        const resolve = this.pendingTasks.get(taskId)!;
        resolve(payload || e.data);
        this.pendingTasks.delete(taskId);
      }
    };

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

    window.addEventListener("message", (event) => {
      if (event.data?.request) {
        this.handleRequest(event.data.request);
      }
    });

    window.addEventListener("resize", () => {
      this.worker.postMessage({
        type: "resize",
        payload: { width: window.innerWidth, height: window.innerHeight },
      });
    });
  }

  async handleRequest(request: ScreenshotRequest) {
    if (request.recordVideo) {
      return this.handleVideoRequest(request);
    }

    const taskId = `${this.nextTaskId++}`;
    await new Promise((resolve) => {
      this.pendingTasks.set(taskId, resolve);
      this.worker.postMessage({
        type: "request",
        payload: { ...request, taskId },
      });
    });
  }

  async handleVideoRequest(request: ScreenshotRequest) {
    const taskId = `${this.nextTaskId++}`;
    const duration = request.duration || 5000;
    const fps = 30;

    const recordCanvas = document.createElement("canvas");
    recordCanvas.width = this.canvas.width;
    recordCanvas.height = this.canvas.height;
    const ctx = recordCanvas.getContext("2d", { alpha: false })!;

    const stream = recordCanvas.captureStream(fps);
    const mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    const chunks: Blob[] = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.start();

    this.worker.postMessage({ type: "start_video", payload: { taskId } });

    let isRecording = true;
    const frameInterval = setInterval(() => {
      if (isRecording) {
        ctx.drawImage(this.canvas, 0, 0);
      }
    }, 1000 / fps);

    await new Promise((resolve) => setTimeout(resolve, duration));

    isRecording = false;
    clearInterval(frameInterval);
    this.worker.postMessage({ type: "stop_video" });
    mediaRecorder.stop();

    const videoBlob = await new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () => {
        resolve(new Blob(chunks, { type: "video/webm" }));
      };
    });

    await new Promise((resolve) => {
      this.pendingTasks.set(taskId, resolve);
      this.worker.postMessage({
        type: "upload_video",
        payload: {
          videoBlob,
          request: { ...request, taskId },
        },
      });
    });
  }
}

const ui = new ScreenshotUI();
ui.initialize();
