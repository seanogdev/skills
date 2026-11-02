export interface Pr {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  isOwn: boolean;
  additions: number;
  deletions: number;
  files: string[];
  body: string;
  baseRisk: number;
  signals: string[];
}

export interface Assessment {
  summary: string;
  risk: number;
  reason: string;
}

export type Action = 'approve' | 'approve-comment' | 'comment';

export interface Decision {
  id: string;
  action: Action;
  body?: string;
}

export interface Option {
  label: string;
  description: string;
}

export interface Question {
  question: string;
  header: string;
  multiSelect: boolean;
  options: Option[];
}
