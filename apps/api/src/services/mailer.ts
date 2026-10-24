/**
 * Transactional email through a tiny pluggable interface (no dependencies):
 *   resend: Resend's HTTP API (RESEND_API_KEY, MAIL_FROM)
 *   smtp:   plain SMTP, meant for local Mailpit (SMTP_HOST, SMTP_PORT)
 *   log:    development/test; messages are kept in the in-memory `outbox` and logged
 * The transport is chosen from the config on every send, so tests can switch it.
 */
import net from 'node:net';
import { config, mailTransportName, type MailTransportName } from '../config';
import { logger } from '../logger';

export type MailMessage = { to: string; subject: string; text: string };

/** Messages sent through the log transport (newest last, capped). Tests read this. */
export const outbox: MailMessage[] = [];
const OUTBOX_MAX = 100;

export function clearOutbox(): void {
  outbox.length = 0;
}

export class MailError extends Error {}

async function sendLog(msg: MailMessage): Promise<void> {
  outbox.push(msg);
  if (outbox.length > OUTBOX_MAX) outbox.shift();
  // Development convenience only: the log transport is never the production path.
  logger.info({ to: msg.to, subject: msg.subject, body: msg.text }, 'mail (log transport)');
}

async function sendResend(msg: MailMessage): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.MAIL_FROM,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new MailError(`Resend answered ${res.status}`);
}

/** Minimal SMTP dialogue (no TLS, no auth): enough for Mailpit. */
function sendSmtp(msg: MailMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.SMTP_HOST, port: config.SMTP_PORT });
    socket.setTimeout(15_000, () => fail(new MailError('SMTP timeout')));
    let buffer = '';
    let step = 0;
    const bare = (a: string) => /<([^>]+)>/.exec(a)?.[1] ?? a;
    const from = bare(config.MAIL_FROM);
    const data =
      [
        `From: ${config.MAIL_FROM}`,
        `To: ${msg.to}`,
        `Subject: ${msg.subject.replace(/[\r\n]+/g, ' ')}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        '',
        msg.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..'),
      ].join('\r\n') + '\r\n.\r\n';
    const script: Array<[string, string]> = [
      ['220', 'EHLO solace\r\n'],
      ['250', `MAIL FROM:<${from}>\r\n`],
      ['250', `RCPT TO:<${msg.to}>\r\n`],
      ['250', 'DATA\r\n'],
      ['354', data],
      ['250', 'QUIT\r\n'],
    ];
    function fail(err: Error) {
      socket.destroy();
      reject(err);
    }
    socket.on('error', fail);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // A reply is complete at a line whose 4th char is a space ("250 ...").
      const lines = buffer.split('\r\n');
      const last = lines.length > 1 ? lines[lines.length - 2]! : '';
      if (!/^\d{3} /.test(last)) return;
      buffer = '';
      const [expect, next] = script[step] ?? ['221', ''];
      if (!last.startsWith(expect)) return fail(new MailError(`SMTP replied ${last}`));
      step += 1;
      if (step > script.length - 1 && expect === '250' && next === 'QUIT\r\n') {
        socket.write(next);
        socket.end();
        return resolve();
      }
      socket.write(next);
    });
  });
}

export function currentTransport(): MailTransportName {
  return mailTransportName();
}

export async function sendMail(msg: MailMessage): Promise<void> {
  switch (mailTransportName()) {
    case 'resend':
      return sendResend(msg);
    case 'smtp':
      return sendSmtp(msg);
    default:
      return sendLog(msg);
  }
}

/** "parent@gmail.com" → "p•••@gmail.com" */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}
