import dotenv from 'dotenv';
// .env 파일을 가장 먼저 로드
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initDatabase } from './db/schema';
import casesRouter from './routes/cases';
import sectionsRouter from './routes/sections';
import aiPipelineRouter from './routes/aiPipeline';

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize database
initDatabase().catch((error) => {
  console.error('Failed to initialize database:', error);
  process.exit(1);
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/cases', casesRouter);
app.use('/api/cases', sectionsRouter);
app.use('/api/ai', aiPipelineRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
