import crypto from 'crypto';
import { prisma, shouldUseMock } from '../db.client';
import { MemoryFragment, ProactivePrompt } from '@prisma/client';
import { Database, MemoryFragment as DbMemoryFragment, ProactivePrompt as DbProactivePrompt } from '../db';

export class MemoryRepository {
  async getActiveMemoryFragments(userId: string): Promise<MemoryFragment[]> {
    if (shouldUseMock()) {
      const memories = Database.getMemories().filter((m) => m.userId === userId && m.status === 'active');
      return memories.map((m) => ({
        id: m.id,
        userId: m.userId,
        category: m.category,
        content: m.content,
        strength: m.strength,
        status: m.status,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt)
      }));
    }
    return prisma.memoryFragment.findMany({
      where: { userId, status: 'active' },
      orderBy: { strength: 'desc' }
    });
  }

  async getPendingProactivePrompt(userId: string): Promise<ProactivePrompt | null> {
    if (shouldUseMock()) {
      const now = new Date();
      const prompts = Database.getPrompts().filter(
        (p) => p.userId === userId && !p.isDelivered && new Date(p.scheduledFor) <= now
      );
      if (prompts.length === 0) return null;
      // Sort by scheduledFor asc
      prompts.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
      const p = prompts[0];
      return {
        id: p.id,
        userId: p.userId,
        memoryFragmentId: p.memoryFragmentId,
        promptText: p.promptText,
        triggerType: p.triggerType,
        scheduledFor: new Date(p.scheduledFor),
        isDelivered: p.isDelivered,
        deliveredAt: p.deliveredAt ? new Date(p.deliveredAt) : null,
        userResponse: p.userResponse,
        createdAt: new Date(p.createdAt)
      };
    }
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
    if (shouldUseMock()) {
      const p = Database.getPrompts().find((pr) => pr.id === id && pr.userId === userId);
      if (!p) return null;
      return {
        id: p.id,
        userId: p.userId,
        memoryFragmentId: p.memoryFragmentId,
        promptText: p.promptText,
        triggerType: p.triggerType,
        scheduledFor: new Date(p.scheduledFor),
        isDelivered: p.isDelivered,
        deliveredAt: p.deliveredAt ? new Date(p.deliveredAt) : null,
        userResponse: p.userResponse,
        createdAt: new Date(p.createdAt)
      };
    }
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
    if (shouldUseMock()) {
      const memories = Database.getMemories();
      const newFragment: DbMemoryFragment = {
        id: crypto.randomUUID(),
        userId,
        category,
        content,
        strength: 1,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      memories.push(newFragment);
      Database.saveMemories(memories);
      return {
        id: newFragment.id,
        userId: newFragment.userId,
        category: newFragment.category,
        content: newFragment.content,
        strength: newFragment.strength,
        status: newFragment.status,
        createdAt: new Date(newFragment.createdAt),
        updatedAt: new Date(newFragment.updatedAt)
      };
    }
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
    if (shouldUseMock()) {
      const memories = Database.getMemories();
      const idx = memories.findIndex((m) => m.id === fragmentId);
      if (idx === -1) {
        throw new Error('Memory fragment not found');
      }
      memories[idx].strength = strength;
      memories[idx].updatedAt = new Date().toISOString();
      Database.saveMemories(memories);
      const m = memories[idx];
      return {
        id: m.id,
        userId: m.userId,
        category: m.category,
        content: m.content,
        strength: m.strength,
        status: m.status,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt)
      };
    }
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
    if (shouldUseMock()) {
      const prompts = Database.getPrompts();
      const newPrompt: DbProactivePrompt = {
        id: crypto.randomUUID(),
        userId,
        memoryFragmentId: memoryFragmentId || null,
        promptText,
        triggerType,
        scheduledFor: scheduledFor.toISOString(),
        isDelivered: false,
        deliveredAt: null,
        userResponse: null,
        createdAt: new Date().toISOString()
      };
      prompts.push(newPrompt);
      Database.savePrompts(prompts);
      return {
        id: newPrompt.id,
        userId: newPrompt.userId,
        memoryFragmentId: newPrompt.memoryFragmentId,
        promptText: newPrompt.promptText,
        triggerType: newPrompt.triggerType,
        scheduledFor: new Date(newPrompt.scheduledFor),
        isDelivered: newPrompt.isDelivered,
        deliveredAt: null,
        userResponse: null,
        createdAt: new Date(newPrompt.createdAt)
      };
    }
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
    if (shouldUseMock()) {
      const prompts = Database.getPrompts();
      const idx = prompts.findIndex((p) => p.id === id);
      if (idx === -1) {
        throw new Error('Proactive prompt not found');
      }
      prompts[idx].isDelivered = true;
      prompts[idx].deliveredAt = new Date().toISOString();
      if (response) {
        prompts[idx].userResponse = response;
      }
      Database.savePrompts(prompts);
      const p = prompts[idx];
      return {
        id: p.id,
        userId: p.userId,
        memoryFragmentId: p.memoryFragmentId,
        promptText: p.promptText,
        triggerType: p.triggerType,
        scheduledFor: new Date(p.scheduledFor),
        isDelivered: p.isDelivered,
        deliveredAt: new Date(p.deliveredAt!),
        userResponse: p.userResponse,
        createdAt: new Date(p.createdAt)
      };
    }
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
