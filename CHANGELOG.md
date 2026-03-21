# 1.1.0 - 21 Mar 2026

- Implemented **video recording** functionality (`requestRecordVideoUpload`) using `MediaRecorder` and `ImageBitmap` frame transfers.
- Added `duration` option for video recording (defaults to 5 seconds).

# 1.0.2 - 21 Mar 2026

- **Completely removed Three.js**, rewriting the rendering pipeline in raw WebGL (`main.ts` / `webworker.ts`) to drastically reduce bundle size and execution time.

# 1.0.1 - 20 Mar 2026

- Updated client.lua to use JPG as the default format to support legacy systems.
- Fixed an error in client.lua.

# 1.0.0 - 20 Mar 2026

- Removed all TypeScript source files (`src/client/client.ts`, `src/server/server.ts`) and legacy typing files.
- Removed complex build configurations (`client.config.js`, `server.config.js`, `ui.config.js`).
- Updated `package.json` to focus on build/release scripts and removed legacy dependencies.
- Updated `.gitignore` to reflect the new project structure.
- Simplified `fxmanifest.lua` by removing Webpack builds, server-side logic and replace Client with Lua script.
- Heavily optimized screenshot capture using **Web Workers** and **OffscreenCanvas** for non-blocking processing.
- Implemented **zero-copy data transfers** to the worker for improved performance.
- Updated `client.lua` to use `webp` as the default encoding and improved variable scoping.
- Refactored `main.ts` for full TypeScript type safety and modernized Three.js syntax.
- Optimized window resize logic in the UI to reuse resources and prevent memory leaks.
- Implemented request queuing to handle multiple rapid screenshot requests without data loss.
- Added on-demand animation loop that only renders when requests are pending, saving GPU idle cycles.
- Reusable `OffscreenCanvas` in the Web Worker to reduce garbage collection pressure.
- Added `ArrayBuffer` recycling between worker and main thread for minimal memory allocation.
- Moved Base64 conversion into the Worker using `FileReaderSync` to fully offload the main thread.
- Simplified `ui/index.html` by removing inline styles.
- Changed build output from `dist/ui.html` to `ui.html` at project root.
- Added a new build script (`scripts/build.ts`) using Bun.
- Added a new GitHub Actions release workflow (`.github/workflows/release.yml`).
