export interface GithubPullRequestMetadata {
  number: number;
  state: "open" | "closed";
  draft: boolean;
  awaitingReview: boolean;
  reviewRequested: boolean;
  requestedReviewerCount: number;
  requestedTeamCount: number;
}

export interface GithubVisibleRepo {
  id: string;
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  visibility: string;
  updatedAt: string | null;
}

export interface GithubConnectionSnapshot {
  connected: boolean;
  username: string | null;
  scopes: string[];
  permissionWarning: string | null;
  repos: GithubVisibleRepo[];
}

export interface GithubActivityItem {
  repo: string;
  title: string;
  content: string;
  source: "github_commit" | "github_pr";
  externalId: string;
  externalUrl?: string;
  metadata?: {
    githubPr?: GithubPullRequestMetadata;
  };
  createdAt: Date;
}

export interface GithubCommitLookup {
  repo: string;
  sha: string;
  message: string;
  createdAt: Date;
}

export interface GithubCommitDetail {
  repo: string;
  sha: string;
  message: string;
  authors: string[];
  createdAt: Date;
  files: Array<{
    filename: string;
    status?: string;
    patch?: string | null;
  }>;
}
