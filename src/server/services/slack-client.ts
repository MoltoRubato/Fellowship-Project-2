import { WebClient } from "@slack/web-api";

let slackClient: WebClient | null = null;

export type SlackClient = Pick<WebClient, "chat" | "views">;

export function getSlackWebClient() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN is required");
  }

  if (!slackClient) {
    slackClient = new WebClient(token);
  }

  return slackClient;
}
