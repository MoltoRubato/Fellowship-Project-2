import type { App } from "@slack/bolt";
import type { CommandModule } from "./types";
import entries from "./entries";
import manage from "./manage";
import summary from "./summary";
import auth from "./auth";
import reminders from "./reminders";

const modules: CommandModule[] = [entries, manage, summary, auth, reminders];

export function registerAllCommands(app: App) {
  for (const mod of modules) {
    mod.register(app);
  }
}

export type { CommandModule } from "./types";
