import type {
  App,
  BlockAction,
  SlackActionMiddlewareArgs,
  SlackCommandMiddlewareArgs,
  AllMiddlewareArgs,
  SlackViewMiddlewareArgs,
} from "@slack/bolt";

export type CommandArgs = SlackCommandMiddlewareArgs & AllMiddlewareArgs;
export type ViewArgs = SlackViewMiddlewareArgs & AllMiddlewareArgs;
export type ActionArgs = SlackActionMiddlewareArgs<BlockAction> & AllMiddlewareArgs;

export type ModalEntryType = "update" | "blocker";
export type SummaryPeriod = "today" | "week";

export type EntryModalItem = {
  entryId: string;
  displayId: number;
  displayDateKey: string;
  content: string;
  repoLabel: string;
};

export interface CommandModule {
  name: string;
  register(app: App): void;
}
