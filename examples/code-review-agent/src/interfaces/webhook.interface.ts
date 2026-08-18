/**
 * Represents the parsed payload from a GitHub Webhook event for pull requests and issue comments.
 */
export interface GitHubWebhookPayload {
  action: 'opened' | 'synchronize' | 'reopened' | 'created';
  number?: number;
  pull_request?: {
    number: number;
    title: string;
    body: string;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
    user: {
      login: string;
      id: number;
    };
    html_url: string;
  };
  issue?: {
    number: number;
    pull_request?: {
      url: string;
    };
    user: {
      login: string;
    };
  };
  comment?: {
    id: number;
    body: string;
    user: {
      login: string;
    };
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
  sender: {
    login: string;
    id: number;
  };
}

/**
 * Normalized trigger event for Njent code review and fix actions.
 */
export interface NjentTriggerEvent {
  eventType: 'pr_opened' | 'pr_synchronized' | 'comment_trigger';
  repoFullName: string;
  prNumber: number;
  author: string;
  triggerComment?: string;
  action: 'review' | 'apply_fixes' | 'false_positive';
  headSha: string;
  baseSha: string;
  timestamp: string;
}
