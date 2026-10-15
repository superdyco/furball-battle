// 讀取 Claude Design bundler 產出的單檔 HTML。
// manifest：{ uuid: { mime, compressed, data(base64) } }；template：完整頁面 HTML 字串。
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLE_PATH = join(ROOT, '線上百戰天蟲遊戲企劃.html');

// 已知資源的 UUID（對照解包結果確認過）
export const UUID = {
  engine: 'd040a82f-9641-445a-9812-8ee8d94d1fd5',
  dcRuntime: 'd1eacb4b-8582-485a-b53b-37a7373d63da',
  react: '84076b69-ec59-4c3f-be94-f0c09eb139cb',
  reactDom: '77a6527c-dacb-4b19-b63c-ac67b90d7363',
};

function scriptBlock(html, type) {
  const open = `<script type="__bundler/${type}">`;
  const i = html.indexOf(open);
  if (i < 0) throw new Error(`bundle 缺少 __bundler/${type}`);
  const j = html.indexOf('</script>', i);
  return html.slice(i + open.length, j).trim();
}

export function readBundle(path = BUNDLE_PATH) {
  const html = readFileSync(path, 'utf8');
  const manifest = JSON.parse(scriptBlock(html, 'manifest'));
  const template = JSON.parse(scriptBlock(html, 'template'));
  const extResources = JSON.parse(scriptBlock(html, 'ext_resources'));
  const assets = {};
  for (const [uuid, e] of Object.entries(manifest)) {
    let buf = Buffer.from(e.data, 'base64');
    if (e.compressed) buf = gunzipSync(buf);
    assets[uuid] = { mime: e.mime, buf };
  }
  return { template, assets, extResources };
}

// 原版引擎原始碼（golden-master 測試的對照基準）
export function readOriginalEngineSource(path = BUNDLE_PATH) {
  return readBundle(path).assets[UUID.engine].buf.toString('utf8');
}
