import { EntryRepository } from '../repositories/entry.repository';
import { AIService } from './ai.service';

export interface MoodMetric {
  mood: string;
  count: number;
}

export interface TagMetric {
  tag: string;
  count: number;
}

export interface WeeklyInsightResult {
  markdownSummary: string;
  moodDistribution: MoodMetric[];
  tagDistribution: TagMetric[];
  totalEntriesCount: number;
}

export class InsightService {
  private entryRepository = new EntryRepository();
  private aiService = new AIService();

  public async generateInsights(userId: string, apiKey?: string): Promise<WeeklyInsightResult> {
    const entries = await this.entryRepository.findAllByUserId(userId);

    // Compute stats programmatically for reliable analytics graphics!
    const moodCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};

    entries.forEach((e) => {
      // Mood distributions
      const mood = e.mood.toLowerCase().trim();
      moodCounts[mood] = (moodCounts[mood] || 0) + 1;

      // Tag distributions
      e.tags.forEach((tag) => {
        const cleanTag = tag.toLowerCase().trim();
        tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
      });
    });

    const moodDistribution: MoodMetric[] = Object.entries(moodCounts)
      .map(([mood, count]) => ({ mood, count }))
      .sort((a, b) => b.count - a.count);

    const tagDistribution: TagMetric[] = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Limit to top 10

    if (entries.length === 0) {
      return {
        markdownSummary: "### Let's Begin Your Journey\nWrite your first journal entry to unlock deep AI-powered mood patterns, personal learning trends, and encouraging insights!",
        moodDistribution: [],
        tagDistribution: [],
        totalEntriesCount: 0
      };
    }

    // Format text summaries of the last 7 entries for Gemini's deep contextual synthesis
    const contextualText = entries
      .slice(0, 7)
      .map((e, index) => `Entry #${index + 1} | Date: ${e.createdAt} | Title: ${e.title}\nMood: ${e.mood}\nTags: ${e.tags.join(', ')}\nContent: ${e.content}`)
      .join('\n\n---\n\n');

    const markdownSummary = await this.aiService.getWeeklySummary(contextualText, apiKey);

    return {
      markdownSummary,
      moodDistribution,
      tagDistribution,
      totalEntriesCount: entries.length
    };
  }
}
