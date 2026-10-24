import { Router } from 'express';
import { createThreadInput, encodeSse, sendMessageInput } from '@solace/shared';
import { aiConfigured, assertAiNotPaused } from '../ai/gemini';
import { mapAiErrors } from '../ai/errors';
import { aiUnavailable } from '../http/errors';
import { authOf } from '../http/types';
import { parseBody, uuidParam } from '../middleware/validate';
import {
  createThread,
  deleteThread,
  getThread,
  listThreads,
  prepareTurn,
  runTurn,
} from '../services/chat';
import { consumeAiQuota } from '../services/quota';

export const threadsRouter: Router = Router();

const HEARTBEAT_MS = 15_000;

threadsRouter.get('/threads', async (req, res) => {
  res.json({ items: await listThreads(authOf(req).userId) });
});

threadsRouter.post('/threads', async (req, res) => {
  const { title, mode } = parseBody(req, createThreadInput);
  res.status(201).json(await createThread(authOf(req).userId, title, mode));
});

threadsRouter.get('/threads/:id', async (req, res) => {
  res.json(await getThread(authOf(req).userId, uuidParam(req)));
});

threadsRouter.delete('/threads/:id', async (req, res) => {
  await deleteThread(authOf(req).userId, uuidParam(req));
  res.status(204).end();
});

/**
 * Streams one answer as server-sent events (see `chatStreamEvent`). Everything that can be
 * rejected up front (validation, unknown thread, no AI key, a spent daily budget, a model
 * Gemini has paused) fails as plain JSON before the stream opens — a spent budget is a 429
 * `ai_quota_exceeded` — and after that, failures arrive as a terminal `error` event.
 */
threadsRouter.post('/threads/:id/messages', async (req, res) => {
  const { userId } = authOf(req);
  const threadId = uuidParam(req);
  const input = parseBody(req, sendMessageInput);
  if (!aiConfigured(req.geminiKey)) throw aiUnavailable();
  await getThread(userId, threadId); // 404 before anything is consumed or stored
  // Retrieval embeds the question, then the answer streams from the chat model.
  assertAiNotPaused(['embed', 'chat'], req.geminiKey);
  await consumeAiQuota(userId, { usingOwnKey: Boolean(req.geminiKey) });
  const turn = await prepareTurn(userId, threadId, input);

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const disconnected = new AbortController();
  // `res` (not `req`) closes when the client goes away; a finished response has ended first.
  res.on('close', () => {
    if (!res.writableEnded) disconnected.abort();
  });
  const write = (chunk: string) => {
    if (!res.writableEnded && !res.destroyed) res.write(chunk);
  };
  const heartbeat = setInterval(() => write(': keep-alive\n\n'), HEARTBEAT_MS);

  try {
    await runTurn({
      userId,
      threadId,
      turn,
      ai: { apiKey: req.geminiKey },
      signal: disconnected.signal,
      emit: (event, data) => write(encodeSse(event, data)),
      requestId: req.id,
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

threadsRouter.use(mapAiErrors);
