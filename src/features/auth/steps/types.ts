import type { ReactNode } from 'react';
import type { Topic } from '../schemas';

export type Step = 'start' | 'verify' | 'forgot' | 'reset' | 'blocked';
export type NoticeState = { kind: 'info' | 'good' | 'bad' | 'warn'; text: ReactNode } | null;

/** What every step needs from the page around it. */
export interface StepProps {
  email: string;
  setEmail: (email: string) => void;
  go: (step: Step) => void;
  notice: (state: NoticeState) => void;
  openContact: (topic?: Topic) => void;
}
