const fs = require('fs');
const path = require('path');

const serverUrl = (process.env.SERVER_URL || process.env.API_URL || '').trim().replace(/\/+$/, '');
if (serverUrl) {
  const configPath = path.join(__dirname, 'config.js');
  let content = fs.readFileSync(configPath, 'utf8');
  content = content.replace(
    /var\s+RENDER_SERVER_URL\s*=\s*'[^']*';/,
    `var RENDER_SERVER_URL = '${serverUrl}';`
  );
  fs.writeFileSync(configPath, content, 'utf8');
  console.log('[frontend/build] Injected RENDER_SERVER_URL =', serverUrl);
} else {
  console.log('[frontend/build] No SERVER_URL env var set; keeping config.js as-is.');
}
