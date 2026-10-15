export const ROOT: string;
export const BUNDLE_PATH: string;
export const UUID: { engine: string; dcRuntime: string; react: string; reactDom: string };
export function readBundle(path?: string): {
  template: string;
  assets: Record<string, { mime: string; buf: Buffer }>;
  extResources: { id: string; uuid: string }[];
};
export function readOriginalEngineSource(path?: string): string;
