import type { ActionArgs, ViewArgs } from "../types.js";

const QUESTIONS_REMOVED_TEXT =
  "Clarifying questions have been removed. Please run `/summarise` again to get the summary directly.";

export async function handleSummaryQuestionsOpen(args: ActionArgs) {
  const { ack, body, client } = args;
  await ack();

  await client.chat.postMessage({
    channel: body.user.id,
    text: QUESTIONS_REMOVED_TEXT,
  });
}

export async function handleSummaryQuestionsSubmit(args: ViewArgs) {
  const { ack, body, client } = args;
  await ack();

  await client.chat.postMessage({
    channel: body.user.id,
    text: QUESTIONS_REMOVED_TEXT,
  });
}
