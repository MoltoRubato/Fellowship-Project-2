import type { CommandModule } from "../types.js";
import {
  SUMMARY_MODAL_CALLBACK_ID,
  SUMMARY_REPO_PICK_ACTION_ID,
  SUMMARY_QUESTIONS_MODAL_CALLBACK_ID,
  SUMMARY_QUESTIONS_ACTION_ID,
} from "../shared/index.js";
import { handleSummarise, handleSummaryRepoPick, handleSummaryModalSubmission } from "./handlers";
import { handleSummaryQuestionsOpen, handleSummaryQuestionsSubmit } from "./question-modal";

const summary: CommandModule = {
  name: "summary",
  register(app) {
    app.command("/summarise", handleSummarise);
    app.view(SUMMARY_MODAL_CALLBACK_ID, handleSummaryModalSubmission);
    app.view(SUMMARY_QUESTIONS_MODAL_CALLBACK_ID, handleSummaryQuestionsSubmit);
    app.action(SUMMARY_REPO_PICK_ACTION_ID, handleSummaryRepoPick);
    app.action(SUMMARY_QUESTIONS_ACTION_ID, handleSummaryQuestionsOpen);
  },
};

export default summary;
