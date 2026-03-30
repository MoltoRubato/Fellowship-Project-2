import type { CommandModule } from "./types.js";
import { ensureSlackUser } from "@/server/services/standup";
import { sendAuthLinkDm } from "@/server/services/slack";

const auth: CommandModule = {
  name: "auth",
  register(app) {
    app.command("/auth", async ({ command, ack, respond }) => {
      await ack();

      await ensureSlackUser(command.user_id, command.team_id);
      await sendAuthLinkDm({
        slackUserId: command.user_id,
        slackTeamId: command.team_id,
        reason: "Here is your secure dashboard link for connecting GitHub and Linear.",
      });

      await respond({
        response_type: "ephemeral",
        text: "I sent your auth link in DM.",
      });
    });
  },
};

export default auth;
