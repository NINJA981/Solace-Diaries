/**
 * Helplines shown by <CrisisResources />. Numbers change: re-check every entry and bump
 * CRISIS_LAST_REVIEWED when you do (needs a human, not a script).
 */
export const CRISIS_LAST_REVIEWED = '2026-10-24';

export type HelplineRegion = 'IN' | 'US' | 'GB-IE' | 'INTL';

export type Helpline = {
  id: string;
  region: HelplineRegion;
  name: string;
  /** One calm line about it. */
  about: string;
  /** Shown to people, e.g. "14416". */
  number?: string;
  /** Digits for a tel: link. */
  tel?: string;
  url?: string;
  hours: string;
};

export const REGION_LABELS: Record<HelplineRegion, string> = {
  IN: 'In India',
  US: 'In the United States',
  'GB-IE': 'In the UK and Ireland',
  INTL: 'Anywhere else',
};

export const REGION_ORDER: HelplineRegion[] = ['IN', 'US', 'GB-IE', 'INTL'];

export const HELPLINES: Helpline[] = [
  {
    id: 'tele-manas',
    region: 'IN',
    name: 'Tele-MANAS',
    about: 'Free mental health support from trained counsellors, in many languages.',
    number: '14416',
    tel: '14416',
    hours: 'Every day, all day',
  },
  {
    id: 'kiran',
    region: 'IN',
    name: 'KIRAN',
    about: 'The Government of India’s free mental health helpline.',
    number: '1800-599-0019',
    tel: '18005990019',
    hours: 'Every day, all day',
  },
  {
    id: 'childline-in',
    region: 'IN',
    name: 'CHILDLINE',
    about: 'For any child or teenager who is scared, hurt or needs help.',
    number: '1098',
    tel: '1098',
    hours: 'Every day, all day',
  },
  {
    id: '988',
    region: 'US',
    name: '988 Suicide and Crisis Lifeline',
    about: 'Call or text to talk with a trained counsellor.',
    number: '988',
    tel: '988',
    hours: 'Every day, all day',
  },
  {
    id: 'samaritans',
    region: 'GB-IE',
    name: 'Samaritans',
    about: 'Someone will listen, whatever you are going through.',
    number: '116 123',
    tel: '116123',
    hours: 'Every day, all day',
  },
  {
    id: 'findahelpline',
    region: 'INTL',
    name: 'Find a Helpline',
    about: 'A directory of free helplines in most countries.',
    url: 'https://findahelpline.com',
    hours: 'Search by country',
  },
];

/** Emergency numbers, for when someone is in danger right now. */
export const EMERGENCY_NUMBERS = 'India 112, United States 911, UK 999, EU 112';
