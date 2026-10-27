import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, mailTransportName, teenSignupEnabled } from '../../src/config';
import { clearOutbox, outbox, parseAddress, sendMail } from '../../src/services/mailer';

const c = config as {
  RESEND_API_KEY: string;
  BREVO_API_KEY: string;
  MAIL_FROM: string;
  SMTP_HOST: string;
  NODE_ENV: string;
};
const defaultFrom = c.MAIL_FROM;

afterEach(() => {
  c.RESEND_API_KEY = '';
  c.BREVO_API_KEY = '';
  c.MAIL_FROM = defaultFrom;
  c.SMTP_HOST = '';
  c.NODE_ENV = 'test';
  vi.unstubAllGlobals();
  clearOutbox();
});

describe('mailer', () => {
  it('uses the log transport by default and records the message', async () => {
    expect(mailTransportName()).toBe('log');
    await sendMail({ to: 'a@b.co', subject: 'Hi', text: 'Body' });
    expect(outbox).toEqual([{ to: 'a@b.co', subject: 'Hi', text: 'Body' }]);
  });

  it('posts to Resend with the key and sender', async () => {
    c.RESEND_API_KEY = 're_test';
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendMail({ to: 'a@b.co', subject: 'Hi', text: 'Body' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: ['a@b.co'],
      subject: 'Hi',
      text: 'Body',
    });
    expect(outbox).toHaveLength(0);
  });

  it('throws when Resend refuses', async () => {
    c.RESEND_API_KEY = 're_test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 422 })),
    );
    await expect(sendMail({ to: 'a@b.co', subject: 'Hi', text: 'Body' })).rejects.toThrow();
  });

  it('posts to Brevo with the key and a structured sender', async () => {
    c.BREVO_API_KEY = 'xkeysib-test';
    c.MAIL_FROM = 'Solace Diaries <solace.diaries@gmail.com>';
    const fetchMock = vi.fn(async () => new Response('{"messageId":"m"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(mailTransportName()).toBe('brevo');
    await sendMail({ to: 'a@b.co', subject: 'Hi', text: 'Body' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { name: 'Solace Diaries', email: 'solace.diaries@gmail.com' },
      to: [{ email: 'a@b.co' }],
      subject: 'Hi',
      textContent: 'Body',
    });
  });

  it('throws when Brevo refuses', async () => {
    c.BREVO_API_KEY = 'xkeysib-test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 401 })),
    );
    await expect(sendMail({ to: 'a@b.co', subject: 'Hi', text: 'Body' })).rejects.toThrow(
      'Brevo answered 401',
    );
  });

  it('Resend wins over Brevo when both keys are set', () => {
    c.RESEND_API_KEY = 're_test';
    c.BREVO_API_KEY = 'xkeysib-test';
    expect(mailTransportName()).toBe('resend');
  });

  it('parses sender addresses', () => {
    expect(parseAddress('Solace Diaries <hello@x.co>')).toEqual({
      name: 'Solace Diaries',
      email: 'hello@x.co',
    });
    expect(parseAddress('"Solace" <hello@x.co>')).toEqual({ name: 'Solace', email: 'hello@x.co' });
    expect(parseAddress('<hello@x.co>')).toEqual({ email: 'hello@x.co' });
    expect(parseAddress(' hello@x.co ')).toEqual({ email: 'hello@x.co' });
  });

  it('teen sign-up needs a real provider only in production', () => {
    c.NODE_ENV = 'production';
    expect(teenSignupEnabled()).toBe(false);
    c.SMTP_HOST = '127.0.0.1';
    expect(teenSignupEnabled()).toBe(true);
    c.SMTP_HOST = '';
    c.RESEND_API_KEY = 'k';
    expect(teenSignupEnabled()).toBe(true);
    c.RESEND_API_KEY = '';
    c.BREVO_API_KEY = 'k';
    expect(teenSignupEnabled()).toBe(true);
    c.BREVO_API_KEY = '';
    c.NODE_ENV = 'development';
    c.RESEND_API_KEY = '';
    expect(teenSignupEnabled()).toBe(true);
  });
});
