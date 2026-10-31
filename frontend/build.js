const fs = require('fs');
const path = require('path');

const serverUrl = (process.env.SERVER_URL || process.env.API_URL || '').trim().replace(/\/+$/, '');
const configPath = path.join(__dirname, 'config.js');

if (serverUrl && fs.existsSync(configPath)) {
  let content = fs.readFileSync(configPath, 'utf8');
  content = content.replace(
    /var\s+RENDER_SERVER_URL\s*=\s*'[^']*';/,
    `var RENDER_SERVER_URL = '${serverUrl}';`
  );
  fs.writeFileSync(configPath, content, 'utf8');
  console.log('[frontend/build] Injected RENDER_SERVER_URL =', serverUrl);
}

// Create "public" output directory for Vercel / static hosts
const pubDir = path.join(__dirname, 'public');
fs.rmSync(pubDir, { recursive: true, force: true });
fs.mkdirSync(pubDir, { recursive: true });

const skip = new Set(['public', 'node_modules', 'package.json', 'package-lock.json', 'build.js', '.git']);
for (const entry of fs.readdirSync(__dirname)) {
  if (skip.has(entry)) continue;
  fs.cpSync(path.join(__dirname, entry), path.join(pubDir, entry), { recursive: true });
}
console.log('[frontend/build] Built static files into public/');
