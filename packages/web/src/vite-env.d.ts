/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_FORCE_BOOT_STALL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url' {
  const url: string;
  export default url;
}
declare module '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url' {
  const url: string;
  export default url;
}
declare module '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url' {
  const url: string;
  export default url;
}

/** Where the app serves MediaPipe's WebAssembly (`src/build/visionAssets.mjs`). */
declare module 'virtual:vision-assets' {
  export const VISION_WASM_BASE: string;
}

declare module '*.tflite?url' {
  const url: string;
  export default url;
}

/**
 * hls.js's light build (no subtitles, alternate audio or DRM), which plays Bluesky's videos
 * (`chat/embeds/BlueskyVideo.tsx`). The package ships its types for the full build only; the light
 * one has the same interface.
 */
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
