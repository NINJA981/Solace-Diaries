import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, localDate, weekStart } from '@solace/shared';
import { db } from '../../src/db/client';
import { entries, intentions, memories } from '../../src/db/schema';
import { resetDb, testApi } from '../helpers';
import { seedEntry, seedUser } from '../ai/seed';

const api = testApi();
beforeEach(resetDb);

const weekly = (userId: string) =>
  db
    .select()
    .from(entries)
    .where(and(eq(entries.userId, userId), eq(entries.title, 'Weekly review')));

describe('weekly ritual', () => {
  it('builds one tagged entry with labelled sections and returns the intention', async () => {
    const u = await seedUser({ timezone: 'Pacific/Kiritimati' });
    const res = await api
      .post('/api/rituals/weekly')
      .set(u.headers)
      .send({
        highs: 'Finished the draft',
        lows: 'Slept badly',
        intention: { title: 'Stretch', kind: 'habit', cadence: 'daily' },
      })
      .expect(200);
    expect(res.body.entry.title).toBe('Weekly review');
    expect(res.body.entry.tags).toEqual(['weekly-review']);
    expect(res.body.entry.entryDate).toBe(localDate(new Date(), 'Pacific/Kiritimati'));
    expect(res.body.entry.body).toBe(
      'Highs\nFinished the draft\n\nLows\nSlept badly\n\nNext week\nStretch',
    );
    expect(res.body.intention).toMatchObject({
      title: 'Stretch',
      kind: 'habit',
      cadence: 'daily',
      source: 'user',
    });
  });

  it('omits empty sections and returns intention null', async () => {
    const u = await seedUser();
    const res = await api
      .post('/api/rituals/weekly')
      .set(u.headers)
      .send({ highs: 'Good', lows: '  ' })
      .expect(200);
    expect(res.body.entry.body).toBe('Highs\nGood');
    expect(res.body.intention).toBeNull();
  });

  it('requires at least one of highs, lows, intention', async () => {
    const u = await seedUser();
    await api.post('/api/rituals/weekly').set(u.headers).send({ highs: ' ', lows: '' }).expect(400);
    await api.post('/api/rituals/weekly').set(u.headers).send({}).expect(400);
  });

  it('is idempotent within a Monday-week', async () => {
    const u = await seedUser();
    const a = await api.post('/api/rituals/weekly').set(u.headers).send({ highs: 'one' });
    const b = await api
      .post('/api/rituals/weekly')
      .set(u.headers)
      .send({ highs: 'two', lows: 'x' });
    expect(b.body.entry.id).toBe(a.body.entry.id);
    expect(b.body.entry.body).toBe('Highs\ntwo\n\nLows\nx');
    expect(await weekly(u.id)).toHaveLength(1);
  });

  it('does not duplicate the same active intention on a repeat', async () => {
    const u = await seedUser();
    const body = { highs: 'a', intention: { title: 'Read', kind: 'goal' } };
    const a = await api.post('/api/rituals/weekly').set(u.headers).send(body);
    const b = await api.post('/api/rituals/weekly').set(u.headers).send(body);
    expect(b.body.intention.id).toBe(a.body.intention.id);
    expect(await db.select().from(intentions).where(eq(intentions.userId, u.id))).toHaveLength(1);
  });

  it('starts a new entry for a different week and reuses one from earlier in the same week', async () => {
    const u = await seedUser();
    const today = localDate(new Date(), 'UTC');
    const prev = await seedEntry(u.id, {
      title: 'Weekly review',
      body: 'old',
      tags: ['weekly-review'],
      entryDate: addDays(weekStart(today), -1),
    });
    const res = await api.post('/api/rituals/weekly').set(u.headers).send({ highs: 'new' });
    expect(res.body.entry.id).not.toBe(prev.id);

    const same = await seedUser();
    const mon = await seedEntry(same.id, {
      title: 'Weekly review',
      body: 'old',
      tags: ['weekly-review'],
      entryDate: weekStart(today),
    });
    const res2 = await api.post('/api/rituals/weekly').set(same.headers).send({ highs: 'new' });
    expect(res2.body.entry.id).toBe(mon.id);
  });

  it('never touches another user weekly review', async () => {
    const u = await seedUser();
    const o = await seedUser();
    const today = localDate(new Date(), 'UTC');
    await seedEntry(o.id, {
      title: 'Weekly review',
      tags: ['weekly-review'],
      entryDate: weekStart(today),
    });
    const res = await api.post('/api/rituals/weekly').set(u.headers).send({ highs: 'mine' });
    expect(res.body.entry.body).toBe('Highs\nmine');
    const theirs = await weekly(o.id);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.body).toBe('');
  });

  it('adopts a detected memory through the ritual intention', async () => {
    const u = await seedUser();
    const [m] = await db
      .insert(memories)
      .values({ userId: u.id, kind: 'habit', content: 'Meditate' })
      .returning();
    const res = await api
      .post('/api/rituals/weekly')
      .set(u.headers)
      .send({ intention: { title: 'Meditate', kind: 'habit', memoryId: m!.id } })
      .expect(200);
    expect(res.body.intention.source).toBe('detected');
    expect(res.body.entry.body).toBe('Next week\nMeditate');
  });
});
