export interface User {
  userId: string;
  email: string;
}

export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  mood: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  entry: JournalEntry;
  score: number;
}

export interface ChatSource {
  id: string;
  title: string;
  date: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: ChatSource[];
}

export interface MoodMetric {
  mood: string;
  count: number;
}

export interface TagMetric {
  tag: string;
  count: number;
}

export interface WeeklyInsights {
  markdownSummary: string;
  moodDistribution: MoodMetric[];
  tagDistribution: TagMetric[];
  totalEntriesCount: number;
}
