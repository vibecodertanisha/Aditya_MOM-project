// server.js
const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// Security + gzip
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,       // keep off if you inline scripts/styles
  crossOriginEmbedderPolicy: false,   // often safer off for SPAs unless needed
}));
app.use(compression());

// Serve static files from ./dist (Vite/CRA build output)
const buildPath = path.resolve(__dirname, 'dist');

app.use(express.static(buildPath, {
  etag: true,
  lastModified: true,
  maxAge: '1y',
  setHeaders: (res, filePath) => {
    // Never cache index.html (ensures users get latest bundle references)
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      // If your assets are content-hashed, make them immutable
      const base = path.basename(filePath);
      if (/\.[0-9a-f]{8,}\./i.test(base)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  },
}));

// ---- SPA fallback (Express 5 safe) ----
// Use a final middleware (no route pattern) so any non-file route returns index.html
app.use((_req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Static server running on http://localhost:${PORT}`);
});
