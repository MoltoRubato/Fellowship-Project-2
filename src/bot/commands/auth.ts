import type { CommandModule } from "./types";
import { ensureSlackUser } from "@/server/services/standup";
import { sendAuthLinkDm } from "@/server/services/slack";
import type { CommandArgs } from "./types";

export async function handleAuthCommand({ command, ack, respond }: CommandArgs) {
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
}

const auth: CommandModule = {
  name: "auth",
  register(app) {
    app.command("/auth", handleAuthCommand);
  },
};

export default auth;
