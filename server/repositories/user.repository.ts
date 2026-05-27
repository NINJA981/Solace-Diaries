import { prisma } from '../db.client';
import { User } from '../db';

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    const user = await prisma.user.findUnique({
      where: { id }
    });
    if (!user) return null;
    return {
      ...user,
      createdAt: user.createdAt.toISOString()
    };
  }

  async findByEmail(email: string): Promise<User | null> {
    const cleanEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: cleanEmail }
    });
    if (!user) return null;
    return {
      ...user,
      createdAt: user.createdAt.toISOString()
    };
  }

  async create(user: User): Promise<User> {
    const created = await prisma.user.create({
      data: {
        id: user.id,
        email: user.email,
        passwordHash: user.passwordHash,
        createdAt: new Date(user.createdAt)
      }
    });
    return {
      ...created,
      createdAt: created.createdAt.toISOString()
    };
  }
}
