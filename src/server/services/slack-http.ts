import { createHmac, timingSafeEqual } from "crypto";
import { handleAuthCommand } from "@/bot/commands/auth";
import {
  handleBlockerCommand,
  handleDidCommand,
  handleEntryModalSubmission,
} from "@/bot/commands/entries";
import {
  handleDeleteCommand,
  handleDeleteModalSubmission,
  handleEditCommand,
  handleEditModalSubmission,
  handleEntrySelectionChange,
} from "@/bot/commands/manage";
import {
  handleReminderConfigureAction,
  handleReminderConfigSubmission,
  handleRemindersCommand,
  handleReminderToggleAction,
} from "@/bot/commands/reminders";
import {
  REMINDERS_CONFIGURE_ACTION_ID,
  REMINDERS_CONFIG_MODAL_CALLBACK_ID,
  REMINDERS_TOGGLE_ACTION_ID,
} from "@/bot/commands/reminders/constants";
import {
  EDIT_MODAL_CALLBACK_ID,
  DELETE_MODAL_CALLBACK_ID,
  ENTRY_MODAL_CALLBACK_ID,
  ENTRY_SELECT_ACTION_ID,
  SUMMARY_MODAL_CALLBACK_ID,
  SUMMARY_QUESTIONS_ACTION_ID,
  SUMMARY_QUESTIONS_MODAL_CALLBACK_ID,
  SUMMARY_REPO_PICK_ACTION_ID,
  postToResponseUrl,
} from "@/bot/commands/shared";
import {
  handleSummarise,
  handleSummaryModalSubmission,
  handleSummaryRepoPick,
} from "@/bot/commands/summary/handlers";
import {
  handleSummaryQuestionsOpen,
  handleSummaryQuestionsSubmit,
} from "@/bot/commands/summary/question-modal";
import { getSlackWebClient } from "@/server/services/slack-client";

const SLACK_REQUEST_TOLERANCE_SECONDS = 60 * 5;
const ACK_TIMEOUT_MS = 2_500;

type AckResult =
  | { kind: "empty" }
  | { kind: "json"; body: unknown };

type SlashCommandHandler = (args: any) => Promise<void>;
type ActionHandler = (args: any) => Promise<void>;
type ViewHandler = (args: any) => Promise<void>;

const COMMAND_HANDLERS: Record<string, SlashCommandHandler> = {
  "/auth": handleAuthCommand as unknown as SlashCommandHandler,
  "/did": handleDidCommand as unknown as SlashCommandHandler,
  "/blocker": handleBlockerCommand as unknown as SlashCommandHandler,
  "/edit": handleEditCommand as unknown as SlashCommandHandler,
  "/delete": handleDeleteCommand as unknown as SlashCommandHandler,
  "/summarise": handleSummarise as unknown as SlashCommandHandler,
  "/reminders": handleRemindersCommand as unknown as SlashCommandHandler,
};

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  [ENTRY_SELECT_ACTION_ID]: handleEntrySelectionChange as unknown as ActionHandler,
  [SUMMARY_REPO_PICK_ACTION_ID]: handleSummaryRepoPick as unknown as ActionHandler,
  [SUMMARY_QUESTIONS_ACTION_ID]: handleSummaryQuestionsOpen as unknown as ActionHandler,
  [REMINDERS_TOGGLE_ACTION_ID]: handleReminderToggleAction as unknown as ActionHandler,
  [REMINDERS_CONFIGURE_ACTION_ID]: handleReminderConfigureAction as unknown as ActionHandler,
};

const VIEW_HANDLERS: Record<string, ViewHandler> = {
  [ENTRY_MODAL_CALLBACK_ID]: handleEntryModalSubmission as unknown as ViewHandler,
  [EDIT_MODAL_CALLBACK_ID]: handleEditModalSubmission as unknown as ViewHandler,
  [DELETE_MODAL_CALLBACK_ID]: handleDeleteModalSubmission as unknown as ViewHandler,
  [SUMMARY_MODAL_CALLBACK_ID]: handleSummaryModalSubmission as unknown as ViewHandler,
  [SUMMARY_QUESTIONS_MODAL_CALLBACK_ID]: handleSummaryQuestionsSubmit as unknown as ViewHandler,
  [REMINDERS_CONFIG_MODAL_CALLBACK_ID]: handleReminderConfigSubmission as unknown as ViewHandler,
};

function createAckController() {
  let settled = false;
  let resolveAck!: (value: AckResult) => void;
  let rejectAck!: (reason?: unknown) => void;
  const ackPromise = new Promise<AckResult>((resolve, reject) => {
    resolveAck = resolve;
    rejectAck = reject;
  });

  return {
    ack: async (payload?: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      resolveAck(payload === undefined ? { kind: "empty" } : { kind: "json", body: payload });
    },
    fail: (error: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      rejectAck(error);
    },
    waitForAck: async () => {
      const result = await Promise.race([
        ackPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Slack ack timed out")), ACK_TIMEOUT_MS);
        }),
      ]);

      return result;
    },
  };
}

function safeCompareSignatures(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function verifySlackRequestSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
}) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret || !input.timestamp || !input.signature) {
    return false;
  }

  const timestampSeconds = Number.parseInt(input.timestamp, 10);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > SLACK_REQUEST_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const base = `v0:${input.timestamp}:${input.rawBody}`;
  const computedSignature = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;

  return safeCompareSignatures(computedSignature, input.signature);
}

export function parseSlackFormBody(rawBody: string) {
  return new URLSearchParams(rawBody);
}

export function buildSlackAckResponse(result: AckResult) {
  if (result.kind === "json") {
    return result.body;
  }

  return null;
}

export function startSlackCommandExecution(command: Record<string, unknown>) {
  const ackController = createAckController();
  const client = getSlackWebClient();
  const commandName = typeof command.command === "string" ? command.command : "";
  const responseUrl = typeof command.response_url === "string" ? command.response_url : "";
  const handler = COMMAND_HANDLERS[commandName];

  if (!handler) {
    void ackController.ack({
      response_type: "ephemeral",
      text: "Unsupported Slack command.",
    });

    return {
      ackPromise: ackController.waitForAck(),
      handlerPromise: Promise.resolve(),
    };
  }

  const handlerPromise = handler({
    command,
    ack: ackController.ack,
    respond: async (payload: any) => {
      if (!responseUrl) {
        return;
      }

      await postToResponseUrl(responseUrl, payload);
    },
    client,
  }).catch((error) => {
    ackController.fail(error);
    console.error("Slack command failed", commandName, error);
  });

  return {
    ackPromise: ackController.waitForAck(),
    handlerPromise,
  };
}

export function startSlackInteractionExecution(payload: Record<string, unknown>) {
  const ackController = createAckController();
  const client = getSlackWebClient();
  const type = typeof payload.type === "string" ? payload.type : "";

  const handlerPromise = (async () => {
    if (type === "block_actions") {
      const action = Array.isArray(payload.actions) ? payload.actions[0] : null;
      const actionId =
        action && typeof action === "object" && "action_id" in action
          ? String((action as { action_id?: unknown }).action_id ?? "")
          : "";
      const handler = ACTION_HANDLERS[actionId];

      if (!handler) {
        await ackController.ack();
        return;
      }

      await handler({
        ack: ackController.ack,
        body: payload,
        client,
        action: (action ?? {}) as Record<string, unknown>,
      });
      return;
    }

    if (type === "view_submission") {
      const view = payload.view as Record<string, unknown> | undefined;
      const callbackId = typeof view?.callback_id === "string" ? view.callback_id : "";
      const handler = VIEW_HANDLERS[callbackId];

      if (!handler) {
        await ackController.ack();
        return;
      }

      await handler({
        ack: ackController.ack,
        body: payload,
        client,
        view: view ?? {},
      });
      return;
    }

    await ackController.ack();
  })().catch((error) => {
    ackController.fail(error);
    console.error("Slack interaction failed", type, error);
  });

  return {
    ackPromise: ackController.waitForAck(),
    handlerPromise,
  };
}
