import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { config } from './server/config/eventConfig.ts';
import { app } from './server/app.ts';

const PORT = Number(process.env.PORT || config.PORT) || 3000;

async function startServer() {
  if (config.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Yuva Shakti Portal running on http://0.0.0.0:${PORT}`);
    console.log(`💳 Payment Mode: ${config.PAYMENT_MODE} [Payee: ${config.PAYEE_UPI_ID}]`);
    console.log(`🌍 Environment: ${config.NODE_ENV || 'development'}`);
  });
}

if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export { app, startServer };
export default app;
