// 把原始 bundle 解成 Vite 專案可用的檔案：
//   index.html                     ← template（UI 外殼原封不動，只換資源路徑）
//   public/vendor/*.js             ← dc-runtime、React、ReactDOM
//   public/vendor/fonts/*.woff2    ← 字型
// 引擎不輸出到這裡：它已移植到 src/engine，由 src/main.ts 載入。
// 用法：node tools/unbundle.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, UUID, readBundle } from './bundle-lib.mjs';

const { template, assets, extResources } = readBundle();
const vendor = join(ROOT, 'public', 'vendor');
mkdirSync(join(vendor, 'fonts'), { recursive: true });

const NAMED = {
  [UUID.dcRuntime]: 'dc-runtime.js',
  [UUID.react]: 'react.production.min.js',
  [UUID.reactDom]: 'react-dom.production.min.js',
};

const pathOf = {};
for (const [uuid, a] of Object.entries(assets)) {
  if (uuid === UUID.engine) continue;
  let rel;
  if (NAMED[uuid]) rel = `vendor/${NAMED[uuid]}`;
  else if (a.mime === 'font/woff2') rel = `vendor/fonts/${uuid}.woff2`;
  else throw new Error(`未知資源 ${uuid} (${a.mime})`);
  writeFileSync(join(ROOT, 'public', rel), a.buf);
  pathOf[uuid] = '/' + rel;
}

let html = template;
// 引擎改由 Vite 模組入口提供 window.FurballEngine
html = html.replace(`<script src="${UUID.engine}"></script>`, '<script type="module" src="/src/main.ts"></script>');
for (const [uuid, p] of Object.entries(pathOf)) html = html.split(uuid).join(p);
if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(html.replace(/<x-dc>[\s\S]*<\/x-dc>/, '')))
  throw new Error('template 內仍有未替換的 UUID');

// dc-runtime 會先查 window.__resources，命中就不去 unpkg 下載 React
const resources = {};
for (const e of extResources) resources[e.id] = pathOf[e.uuid];
const head = html.match(/<head[^>]*>/i)[0];
html = html.replace(head, `${head}\n<title>毛球大砲戰</title>\n<script>window.__resources = ${JSON.stringify(resources)};</script>`);

writeFileSync(join(ROOT, 'index.html'), html);
console.log(`index.html 與 ${Object.keys(pathOf).length} 個 vendor 資源已輸出`);
