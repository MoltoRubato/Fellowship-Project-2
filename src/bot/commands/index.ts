import type { App } from "@slack/bolt";
import type { CommandModule } from "./types.js";
import entries from "./entries.js";
import manage from "./manage.js";
import summary from "./summary/index.js";
import auth from "./auth.js";
import dm from "./dm.js";

const modules: CommandModule[] = [entries, manage, summary, auth, dm];

export function registerAllCommands(app: App) {
  for (const mod of modules) {
    mod.register(app);
  }
}

export type { CommandModule } from "./types.js";
