interface ScreenshotRequest {
  encoding: "jpg" | "png" | "webp";
  quality: number;
  headers: any;

  correlation: string;

  resultURL: string;

  targetURL: string;
  targetField: string;
}

class ScreenshotUI {
  canvas: HTMLCanvasElement;
  worker: Worker;
  pendingTasks = new Map<string, (result: any) => void>();
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
}

const ui = new ScreenshotUI();
ui.initialize();
