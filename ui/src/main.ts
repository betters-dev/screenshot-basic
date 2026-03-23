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

    await new Promise((resolve) => {
      this.pendingTasks.set(taskId, resolve);
      this.worker.postMessage({ type: "start_video", payload: { taskId } });

      setTimeout(() => {
        this.worker.postMessage({
          type: "stop_video",
          payload: { taskId, request: { ...request, taskId } },
        });
      }, duration);
    });
  }
}

const ui = new ScreenshotUI();
ui.initialize();
