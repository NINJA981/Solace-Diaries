import crypto from 'crypto';
import { prisma, shouldUseMock } from '../db.client';
import { GraphEntity, GraphRelationship } from '@prisma/client';
import { Database, GraphEntity as DbGraphEntity, GraphRelationship as DbGraphRelationship } from '../db';

export class GraphRepository {
  async getEntities(userId: string): Promise<GraphEntity[]> {
    if (shouldUseMock()) {
      const entities = Database.getEntities().filter((e) => e.userId === userId);
      return entities.map((e) => ({
        id: e.id,
        userId: e.userId,
        name: e.name,
        type: e.type,
        createdAt: new Date(e.createdAt),
        updatedAt: new Date(e.updatedAt)
      }));
    }
    return prisma.graphEntity.findMany({
      where: { userId },
      orderBy: { name: 'asc' }
    });
  }

  async getRelationships(userId: string): Promise<GraphRelationship[]> {
    if (shouldUseMock()) {
      const relationships = Database.getRelationships().filter((r) => r.userId === userId);
      return relationships.map((r) => ({
        id: r.id,
        userId: r.userId,
        sourceId: r.sourceId,
        targetId: r.targetId,
        type: r.type,
        strength: r.strength,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt)
      }));
    }
    return prisma.graphRelationship.findMany({
      where: { userId },
      orderBy: { strength: 'desc' }
    });
  }

  async findEntityByNameAndType(userId: string, name: string, type: string): Promise<GraphEntity | null> {
    const cleanName = name.trim();
    const cleanType = type.toLowerCase().trim();

    if (shouldUseMock()) {
      const entity = Database.getEntities().find(
        (e) => e.userId === userId && e.name.toLowerCase() === cleanName.toLowerCase() && e.type === cleanType
      );
      if (!entity) return null;
      return {
        id: entity.id,
        userId: entity.userId,
        name: entity.name,
        type: entity.type,
        createdAt: new Date(entity.createdAt),
        updatedAt: new Date(entity.updatedAt)
      };
    }
    return prisma.graphEntity.findFirst({
      where: {
        userId,
        name: { equals: cleanName, mode: 'insensitive' },
        type: cleanType
      }
    });
  }

  async createEntity(userId: string, name: string, type: string): Promise<GraphEntity> {
    const cleanName = name.trim();
    const cleanType = type.toLowerCase().trim();

    if (shouldUseMock()) {
      const entities = Database.getEntities();
      const newEntity: DbGraphEntity = {
        id: crypto.randomUUID(),
        userId,
        name: cleanName,
        type: cleanType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      entities.push(newEntity);
      Database.saveEntities(entities);
      return {
        id: newEntity.id,
        userId: newEntity.userId,
        name: newEntity.name,
        type: newEntity.type,
        createdAt: new Date(newEntity.createdAt),
        updatedAt: new Date(newEntity.updatedAt)
      };
    }
    return prisma.graphEntity.create({
      data: {
        userId,
        name: cleanName,
        type: cleanType
      }
    });
  }

  async findRelationship(userId: string, sourceId: string, targetId: string, type: string): Promise<GraphRelationship | null> {
    const cleanType = type.toLowerCase().trim();

    if (shouldUseMock()) {
      const rel = Database.getRelationships().find(
        (r) => r.userId === userId && r.sourceId === sourceId && r.targetId === targetId && r.type === cleanType
      );
      if (!rel) return null;
      return {
        id: rel.id,
        userId: rel.userId,
        sourceId: rel.sourceId,
        targetId: rel.targetId,
        type: rel.type,
        strength: rel.strength,
        createdAt: new Date(rel.createdAt),
        updatedAt: new Date(rel.updatedAt)
      };
    }
    return prisma.graphRelationship.findFirst({
      where: { userId, sourceId, targetId, type: cleanType }
    });
  }

  async createRelationship(userId: string, sourceId: string, targetId: string, type: string): Promise<GraphRelationship> {
    const cleanType = type.toLowerCase().trim();

    if (shouldUseMock()) {
      const rels = Database.getRelationships();
      const newRel: DbGraphRelationship = {
        id: crypto.randomUUID(),
        userId,
        sourceId,
        targetId,
        type: cleanType,
        strength: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      rels.push(newRel);
      Database.saveRelationships(rels);
      return {
        id: newRel.id,
        userId: newRel.userId,
        sourceId: newRel.sourceId,
        targetId: newRel.targetId,
        type: newRel.type,
        strength: newRel.strength,
        createdAt: new Date(newRel.createdAt),
        updatedAt: new Date(newRel.updatedAt)
      };
    }
    return prisma.graphRelationship.create({
      data: {
        userId,
        sourceId,
        targetId,
        type: cleanType,
        strength: 1
      }
    });
  }

  async incrementRelationshipStrength(relationshipId: string, strength: number): Promise<GraphRelationship> {
    if (shouldUseMock()) {
      const rels = Database.getRelationships();
      const idx = rels.findIndex((r) => r.id === relationshipId);
      if (idx === -1) {
        throw new Error('Relationship not found');
      }
      rels[idx].strength = strength;
      rels[idx].updatedAt = new Date().toISOString();
      Database.saveRelationships(rels);
      const r = rels[idx];
      return {
        id: r.id,
        userId: r.userId,
        sourceId: r.sourceId,
        targetId: r.targetId,
        type: r.type,
        strength: r.strength,
        createdAt: new Date(r.createdAt),
        updatedAt: new Date(r.updatedAt)
      };
    }
    return prisma.graphRelationship.update({
      where: { id: relationshipId },
      data: { strength }
    });
  }
}
