export interface LinearProjectOption {
  id: string;
  name: string;
  teamId: string;
  teamKey: string;
  teamName: string;
}

export interface LinearConnectionSnapshot {
  connected: boolean;
  username: string | null;
  permissionWarning: string | null;
  projects: LinearProjectOption[];
}

export interface LinearActivityItem {
  repo: string;
  title: string;
  content: string;
  source: "linear_issue";
  externalId: string;
  externalUrl?: string;
  createdAt: Date;
}
