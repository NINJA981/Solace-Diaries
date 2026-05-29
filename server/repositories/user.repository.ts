import { prisma, shouldUseMock } from '../db.client';
import { User, Database } from '../db';

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    if (shouldUseMock()) {
      const users = Database.getUsers();
      return users.find((u) => u.id === id) || null;
    }
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
    if (shouldUseMock()) {
      const users = Database.getUsers();
      return users.find((u) => u.email === cleanEmail) || null;
    }
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
    if (shouldUseMock()) {
      const users = Database.getUsers();
      users.push(user);
      Database.saveUsers(users);
      return user;
    }
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
