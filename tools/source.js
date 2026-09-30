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
  const match = /(?:src|href)="([^"]+)"/.exec(tag);
  if (!match || /^(?:https?:)?\/\//.test(match[1])) continue;
  const url = new URL(match[1], 'https://dashboard.invalid/');
  const file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + path.sep)) throw new Error('Asset outside repository: ' + url.pathname);
  const content = fs.readFileSync(file, 'utf8');
  assets[url.pathname] = {content, type: file.endsWith('.css') ? 'text/css' : 'application/javascript'};
  if (tag.startsWith('<script')) scripts.push(content);
}
module.exports = {html, assets, source: html + '\n' + scripts.join('\n')};
