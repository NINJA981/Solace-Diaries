import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserRepository } from '../repositories/user.repository';
import { User } from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'haven-journal-cozy-jwt-secret-key-92837492';

export interface Session {
  token: string;
  userId: string;
  email: string;
  createdAt: string;
}

export class AuthService {
  private userRepository = new UserRepository();

  public async signUp(email: string, pd: string): Promise<{ user: Omit<User, 'passwordHash'>; token: string }> {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail || pd.length < 6) {
      throw new Error('Invalid email or password (minimum 6 characters required).');
    }

    const existing = await this.userRepository.findByEmail(cleanEmail);
    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(pd, salt);

    const user: User = {
      id: crypto.randomUUID(),
      email: cleanEmail,
      passwordHash,
      createdAt: new Date().toISOString()
    };

    await this.userRepository.create(user);
    const token = this.createSession(user.id, user.email);

    const { passwordHash: _, ...safeUser } = user;
    return { user: safeUser, token };
  }

  public async login(email: string, pd: string): Promise<{ user: Omit<User, 'passwordHash'>; token: string }> {
    const cleanEmail = email.toLowerCase().trim();
    const user = await this.userRepository.findByEmail(cleanEmail);
    if (!user) {
      throw new Error('Invalid email or password.');
    }

    const isMatch = await bcrypt.compare(pd, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid email or password.');
    }

    const token = this.createSession(user.id, user.email);

    const { passwordHash: _, ...safeUser } = user;
    return { user: safeUser, token };
  }

  private createSession(userId: string, email: string): string {
    return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });
  }

  public static getSession(token: string): { userId: string; email: string } | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
      return decoded;
    } catch (err) {
      return null;
    }
  }

  public async logout(token: string): Promise<void> {
    // In stateless JWT, logout is handled client-side by deleting the token.
    // Optionally add to a redis blacklist in future, but for free tier, stateless client-side deletion is standard.
  }
}
