'use strict';

// Read the exact static assets used by the page, in browser load order.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const assets = {};
const scripts = [];
for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) || []) {
  if (tag.startsWith('<link') && !/rel="stylesheet"/.test(tag)) continue;
  for (const match of tag.matchAll(/\s(data-worker-src|src|href)="([^"]+)"/g)) {
    if (/^(?:https?:)?\/\//.test(match[2])) continue;
    const url = new URL(match[2], 'https://dashboard.invalid/');
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep)) throw new Error('Asset outside repository: ' + url.pathname);
    const content = fs.readFileSync(file, 'utf8');
    assets[url.pathname] = {content, type: file.endsWith('.css') ? 'text/css' : 'application/javascript'};
    if (tag.startsWith('<script') && match[1] === 'src') scripts.push(content);
  }
}
// Self-hosted fonts are referenced from the stylesheet, not the page, so the tag scan above
// never sees them. Serve them too: layout and contrast checks should measure the real faces.
const fontDir = path.join(root, 'assets', 'fonts');
if (fs.existsSync(fontDir)) for (const name of fs.readdirSync(fontDir)) {
  if (name.endsWith('.woff2')) assets['/assets/fonts/' + name] = {content: fs.readFileSync(path.join(fontDir, name)), type: 'font/woff2'};
}
module.exports = {html, assets, source: html + '\n' + scripts.join('\n')};
