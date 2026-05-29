import { PrismaClient } from '@prisma/client';

let useMock = false;
let initialized = false;

export const prisma = new PrismaClient();

function checkEnv() {
  if (initialized) return;
  
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl || dbUrl.includes('[PASSWORD]') || dbUrl.includes('[PROJECT-REF]')) {
    useMock = true;
    // Set a valid connection format to prevent Prisma's query parser from crashing on startup
    process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5432/postgres';
  }
  initialized = true;
}

export function shouldUseMock(): boolean {
  checkEnv();
  return useMock;
}

export async function initDb(): Promise<void> {
  checkEnv();
  if (useMock) {
    console.log('[Solace Diaries] Launching in local sandbox mode (using data/db.json).');
    return;
  }

  try {
    // Run a quick query to verify active connection
    await prisma.$connect();
    console.log('[Solace Diaries] PostgreSQL database connection verified successfully.');
  } catch (err: any) {
    console.warn('[Solace Diaries] Database connection failed. Falling back to local file-based database (data/db.json).');
    console.warn(`[Solace Connection Warn]: ${err.message || err}`);
    useMock = true;
  }
}
