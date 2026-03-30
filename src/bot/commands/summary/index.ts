import type { CommandModule } from "../types.js";
import {
  SUMMARY_MODAL_CALLBACK_ID,
  SUMMARY_REPO_PICK_ACTION_ID,
} from "../shared/index.js";
import { handleSummarise, handleSummaryRepoPick, handleSummaryModalSubmission } from "./handlers";

export { handlePendingSummarySessionReply } from "./dm-followup";

const summary: CommandModule = {
  name: "summary",
  register(app) {
    app.command("/summarise", handleSummarise);
    app.view(SUMMARY_MODAL_CALLBACK_ID, handleSummaryModalSubmission);
    app.action(SUMMARY_REPO_PICK_ACTION_ID, handleSummaryRepoPick);
  },
};

export default summary;
