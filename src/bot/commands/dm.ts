import { EntrySource, EntryType } from "@prisma/client";
import type { CommandModule } from "./types.js";
import {
  parseRepoAndText,
  resolveDefaultRepo,
  maybeSendOnboardingLink,
} from "./shared/index.js";
import { handlePendingSummarySessionReply } from "./summary/index.js";
import { ensureSlackUser, logEntry } from "@/server/services/standup";

const dm: CommandModule = {
  name: "dm",
  register(app) {
    app.message(async ({ message }) => {
      if (
        message.channel_type !== "im" ||
        !("user" in message) ||
        !("text" in message) ||
        ("subtype" in message && Boolean(message.subtype)) ||
        !message.user ||
        typeof message.text !== "string" ||
        !message.text.trim()
      ) {
        return;
      }

      const userId = message.user;
      const text = message.text.trim();

      const info = await app.client.users.info({ user: userId });
      const teamId = info.user?.team_id;
      if (!teamId) {
        return;
      }

      if (await handlePendingSummarySessionReply(app, userId, teamId, text)) {
        return;
      }

      const { created } = await ensureSlackUser(userId, teamId);
      const defaultRepo = (await resolveDefaultRepo(userId)) ?? null;
      const parsed = parseRepoAndText(text, defaultRepo);
      if (!parsed.text) {
        return;
      }

      const entry = await logEntry({
        slackUserId: userId,
        slackTeamId: teamId,
        repo: parsed.repo,
        content: parsed.text,
        entryType: EntryType.update,
        source: EntrySource.dm,
      });

      if (created) {
        await maybeSendOnboardingLink(userId, teamId, true);
      }

      await app.client.chat.postMessage({
        channel: userId,
        text: `✅ Logged DM update as #${entry.displayId}${parsed.repo ? ` for ${parsed.repo}` : ""}.`,
      });
    });
  },
};

export default dm;
