import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { attachment as attachmentSchema, LIMITS } from '@solace/shared';
import { db } from '../src/db/client';
import { attachments, jobs } from '../src/db/schema';
import { JOB } from '../src/jobs/types';
import { getObject, listObjects } from '../src/storage';
import { createTestUser, pngBytes, resetDb, testApi, type TestUser } from './helpers';

const api = testApi();

beforeEach(resetDb);

async function newEntry(user: TestUser): Promise<string> {
  const res = await api.post('/api/entries').set(user.headers).send({ body: 'with photos' });
  return res.body.id;
}

const upload = (
  user: TestUser,
  entryId: string,
  bytes: Buffer,
  filename: string,
  contentType = 'image/png',
) =>
  api
    .post(`/api/entries/${entryId}/attachments`)
    .set(user.headers)
    .attach('file', bytes, { filename, contentType });

describe('upload', () => {
  it('re-encodes a real PNG to WebP, records dimensions and queues a description job', async () => {
    const user = await createTestUser();
    const entryId = await newEntry(user);
    const res = await upload(user, entryId, await pngBytes(40, 30), 'photo.png');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const att = attachmentSchema.parse(res.body);
    expect(att).toMatchObject({
      entryId,
      mime: 'image/webp',
      width: 40,
      height: 30,
      description: null,
    });
    expect(att.url).toMatch(/^http:\/\/storage\.test\//);

    const [row] = await db.select().from(attachments).where(eq(attachments.id, att.id));
    expect(row!.storagePath).toBe(`${user.id}/${entryId}/${att.id}.webp`);
    const stored = await getObject(row!.storagePath);
    expect((await sharp(stored).metadata()).format).toBe('webp');
    expect(row!.bytes).toBe(stored.length);

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.dedupeKey, `describe:${att.id}`));
    expect(job).toMatchObject({
      type: JOB.describeAttachment,
      payload: { attachmentId: att.id, userId: user.id },
    });

    const entry = await api.get(`/api/entries/${entryId}`).set(user.headers);
    expect(entry.body.attachments).toHaveLength(1);
    const list = await api.get('/api/entries').set(user.headers);
    expect(list.body.items[0].attachmentCount).toBe(1);
  });

  it('caps the longest side at 2560px', async () => {
    const user = await createTestUser();
    const entryId = await newEntry(user);
    const res = await upload(user, entryId, await pngBytes(3000, 1500), 'wide.png');
    expect(res.body).toMatchObject({ width: 2560, height: 1280 });
  });

  it('rejects disguised files regardless of name or declared type', async () => {
    const user = await createTestUser();
    const entryId = await newEntry(user);
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    for (const [bytes, name] of [
      [html, 'cute.png'],
      [svg, 'cute.png'],
      [Buffer.from('GIF89a...'), 'anim.gif'],
    ] as const) {
      const res = await upload(user, entryId, bytes, name);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    }
    expect(await db.select().from(attachments)).toHaveLength(0);
    expect(await listObjects(`${user.id}/`)).toHaveLength(0);
  });

  it('rejects a request without a file and enforces the per-entry limit', async () => {
    const user = await createTestUser();
    const entryId = await newEntry(user);
    const none = await api
      .post(`/api/entries/${entryId}/attachments`)
      .set(user.headers)
      .field('note', 'x');
    expect(none.status).toBe(400);

    const png = await pngBytes();
    for (let i = 0; i < LIMITS.attachmentsPerEntry; i++) {
      expect((await upload(user, entryId, png, `p${i}.png`)).status).toBe(201);
    }
    const over = await upload(user, entryId, png, 'one-too-many.png');
    expect(over.status).toBe(400);
  });

  it('rejects files over the size limit with 413', async () => {
    const user = await createTestUser();
    const entryId = await newEntry(user);
    const big = Buffer.concat([await pngBytes(), Buffer.alloc(LIMITS.attachmentBytes)]);
    const res = await upload(user, entryId, big, 'huge.png');
    expect(res.status).toBe(413);
  });
});

describe('delete', () => {
  it('removes the row and the stored object', async () => {
    const user = await createTestUser();
    const entryId = await newEntry(user);
    const att = (await upload(user, entryId, await pngBytes(), 'p.png')).body;
    const path = `${user.id}/${entryId}/${att.id}.webp`;

    const intruder = await createTestUser();
    expect(
      (await api.delete(`/api/entries/${entryId}/attachments/${att.id}`).set(intruder.headers))
        .status,
    ).toBe(404);

    expect(
      (await api.delete(`/api/entries/${entryId}/attachments/${att.id}`).set(user.headers)).status,
    ).toBe(204);
    expect(await db.select().from(attachments)).toHaveLength(0);
    await expect(getObject(path)).rejects.toThrow();
  });

  it('deleting an entry removes its photos from storage', async () => {
    const user = await createTestUser();
    const entryId = await newEntry(user);
    await upload(user, entryId, await pngBytes(), 'p.png');
    expect(await listObjects(`${user.id}/${entryId}/`)).toHaveLength(1);
    await api.delete(`/api/entries/${entryId}`).set(user.headers);
    expect(await listObjects(`${user.id}/`)).toHaveLength(0);
  });
});
