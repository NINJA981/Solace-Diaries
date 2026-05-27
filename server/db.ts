import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface JournalEntry {
  id: string;
  userId: string;
  title: string;
  content: string;
  mood: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface VectorRecord {
  id: string;
  entryId: string;
  userId: string;
  vector: number[];
  createdAt: string;
}

export interface DbSchema {
  users: User[];
  entries: JournalEntry[];
  vectors: VectorRecord[];
}

export class Database {
  private static load(): DbSchema {
    try {
      if (!fs.existsSync(DB_PATH)) {
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const initial: DbSchema = { users: [], entries: [], vectors: [] };
        fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), 'utf-8');
        return initial;
      }
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Failed to load database. Returning empty schema.', err);
      return { users: [], entries: [], vectors: [] };
    }
  }

  private static save(schema: DbSchema): void {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DB_PATH, JSON.stringify(schema, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save database.', err);
    }
  }

  public static getUsers(): User[] {
    return this.load().users;
  }

  public static saveUsers(users: User[]): void {
    const db = this.load();
    db.users = users;
    this.save(db);
  }

  public static getEntries(): JournalEntry[] {
    return this.load().entries;
  }

  public static saveEntries(entries: JournalEntry[]): void {
    const db = this.load();
    db.entries = entries;
    this.save(db);
  }

  public static getVectors(): VectorRecord[] {
    return this.load().vectors;
  }

  public static saveVectors(vectors: VectorRecord[]): void {
    const db = this.load();
    db.vectors = vectors;
    this.save(db);
  }
}
