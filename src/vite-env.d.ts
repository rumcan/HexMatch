/// <reference types="vite/client" />

declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.png" {
  const src: string;
  export default src;
}

/** The build's short git commit, injected by vite.config.ts (`define`). */
declare const __BUILD_ID__: string;
