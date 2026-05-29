import { prisma } from '../db.client';
import { MemoryFragment, ProactivePrompt, MemoryFragmentSource } from '@prisma/client';

export class MemoryRepository {
  async getActiveMemoryFragments(userId: string): Promise<MemoryFragment[]> {
    return prisma.memoryFragment.findMany({
      where: { userId, status: 'active' },
      orderBy: { strength: 'desc' }
    });
  }

  async getPendingProactivePrompt(userId: string): Promise<ProactivePrompt | null> {
    const now = new Date();
    return prisma.proactivePrompt.findFirst({
      where: {
        userId,
        isDelivered: false,
        scheduledFor: { lte: now }
      },
      orderBy: { scheduledFor: 'asc' }
    });
  }

  async getPromptById(id: string, userId: string): Promise<ProactivePrompt | null> {
    return prisma.proactivePrompt.findFirst({
      where: { id, userId }
    });
  }

  async createMemoryFragment(
    userId: string,
    category: string,
    content: string,
    entryId: string
  ): Promise<MemoryFragment> {
    return prisma.memoryFragment.create({
      data: {
        userId,
        category,
        content,
        strength: 1,
        status: 'active',
        sourceEntries: {
          create: [{ entryId }]
        }
      }
    });
  }

  async updateMemoryFragmentStrength(fragmentId: string, strength: number, entryId: string): Promise<MemoryFragment> {
    return prisma.memoryFragment.update({
      where: { id: fragmentId },
      data: {
        strength,
        sourceEntries: {
          create: [{ entryId }]
        }
      }
    });
  }

  async createProactivePrompt(
    userId: string,
    promptText: string,
    triggerType: string,
    scheduledFor: Date,
    memoryFragmentId?: string
  ): Promise<ProactivePrompt> {
    return prisma.proactivePrompt.create({
      data: {
        userId,
        promptText,
        triggerType,
        scheduledFor,
        memoryFragmentId
      }
    });
  }

  async markPromptDelivered(id: string, response?: string): Promise<ProactivePrompt> {
    return prisma.proactivePrompt.update({
      where: { id },
      data: {
        isDelivered: true,
        deliveredAt: new Date(),
        ...(response ? { userResponse: response } : {})
      }
    });
  }
}
