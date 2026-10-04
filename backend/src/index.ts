import dotenv from 'dotenv';
dotenv.config();

import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { initDatabase } from './db/schema';
import casesRouter from './routes/cases';
import manuscriptReviewRouter from './routes/manuscriptReview';
import researchRouter from './routes/research';
import scaffoldRouter from './routes/scaffold';
import sectionsRouter from './routes/sections';

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 5000;
const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
const frontendIndexPath = path.join(frontendDistPath, 'index.html');

function parseCorsOrigins(value?: string) {
  return (value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const allowedCorsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);

if (allowedCorsOrigins.length) {
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedCorsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      }
    })
  );
} else {
  app.use(cors());
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/cases', casesRouter);
app.use('/api/cases', sectionsRouter);
app.use('/api/cases', scaffoldRouter);
app.use('/api/research', researchRouter);
app.use('/api/manuscript-review', manuscriptReviewRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

if (fs.existsSync(frontendIndexPath)) {
  app.use(express.static(frontendDistPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      next();
      return;
    }

    res.sendFile(frontendIndexPath);
  });
} else {
  console.warn(
    `Frontend build not found at ${frontendDistPath}. API routes are available, but this process will not serve the web UI until the frontend is built.`
  );
}

async function start() {
  try {
    await initDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }

  app.listen(Number(PORT), HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
  });
}

void start();
