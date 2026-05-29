import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from './services/auth.service';
import { EntryService } from './services/entry.service';
import { ChatService } from './services/chat.service';
import { InsightService } from './services/insight.service';
import { MemoryService } from './services/memory.service';

const router = Router();

const authService = new AuthService();
const entryService = new EntryService();
const chatService = new ChatService();
const insightService = new InsightService();
const memoryService = new MemoryService();

// Extends Express Request with a custom user field safely
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

// Middlware to assert token session validity
export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header is missing or malformed.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const session = AuthService.getSession(token);

  if (!session) {
    res.status(401).json({ error: 'Session is invalid or expired. Please login again.' });
    return;
  }

  req.user = {
    userId: session.userId,
    email: session.email
  };
  next();
}

// --- AUTHENTICATION ROUTES ---

router.post('/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authService.signUp(email, password);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Signup failed' });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.status(200).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Login failed' });
  }
});

router.post('/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      await authService.logout(token);
    }
    res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Logout failed' });
  }
});

router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.status(200).json({ user: req.user });
});

// --- JOURNAL ENTRIES CRUD ROUTING ---

router.get('/entries', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const entries = await entryService.getEntries(userId);
    res.status(200).json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch entries' });
  }
});

router.get('/entries/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const entry = await entryService.getEntry(req.params.id, userId);
    if (!entry) {
      res.status(404).json({ error: 'Entry not found.' });
      return;
    }
    res.status(200).json(entry);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch entry' });
  }
});

router.post('/entries', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { title, content } = req.body;
    const apiKey = req.headers['x-gemini-api-key'] as string | undefined;
    const customPrompt = req.headers['x-custom-prompt'] as string | undefined;
    const entry = await entryService.createEntry(userId, title, content, apiKey, customPrompt);
    res.status(201).json(entry);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create entry' });
  }
});

router.put('/entries/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { title, content } = req.body;
    const apiKey = req.headers['x-gemini-api-key'] as string | undefined;
    const customPrompt = req.headers['x-custom-prompt'] as string | undefined;
    const entry = await entryService.updateEntry(req.params.id, userId, title, content, apiKey, customPrompt);
    if (!entry) {
      res.status(404).json({ error: 'Entry not found or unauthorized.' });
      return;
    }
    res.status(200).json(entry);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update entry' });
  }
});

router.delete('/entries/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const success = await entryService.deleteEntry(req.params.id, userId);
    if (!success) {
      res.status(404).json({ error: 'Entry not found or unauthorized.' });
      return;
    }
    res.status(200).json({ success: true, message: 'Entry and vector memory successfully cleared.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete entry' });
  }
});

// --- ADVANCED AI RETRIEVAL ENDPOINTS ---

router.get('/search', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const query = (req.query.q as string) || '';
    const apiKey = req.headers['x-gemini-api-key'] as string | undefined;
    const results = await entryService.searchEntries(userId, query, apiKey);
    res.status(200).json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Search execution failed.' });
  }
});

router.post('/chat', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { question } = req.body;
    const apiKey = req.headers['x-gemini-api-key'] as string | undefined;
    const customPrompt = req.headers['x-custom-prompt'] as string | undefined;
    const response = await chatService.askPastEntries(userId, question, apiKey, customPrompt);
    res.status(200).json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Chat retrieval failed.' });
  }
});

router.get('/insights', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const apiKey = req.headers['x-gemini-api-key'] as string | undefined;
    const customPrompt = req.headers['x-custom-prompt'] as string | undefined;
    const insights = await insightService.generateInsights(userId, apiKey, customPrompt);
    res.status(200).json(insights);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate week insights.' });
  }
});

// --- MEMORY LAYER ENDPOINTS ---

router.get('/memories/graph', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const memories = await memoryService.getActiveMemories(userId);
    res.status(200).json(memories);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch memories.' });
  }
});

router.get('/memories/pending-prompt', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const prompt = await memoryService.getPendingPrompt(userId);
    res.status(200).json(prompt || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch pending prompt.' });
  }
});

router.post('/memories/prompt/:id/respond', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { responseText } = req.body;
    const prompt = await memoryService.respondToPrompt(userId, req.params.id, responseText);
    res.status(200).json(prompt);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to respond to prompt.' });
  }
});

export default router;
