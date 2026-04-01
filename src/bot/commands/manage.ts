import type { KnownBlock, Block } from "@slack/types";
import type { CommandModule, CommandArgs, ViewArgs, ActionArgs, EntryModalItem } from "./types.js";
import {
  EDIT_MODAL_CALLBACK_ID,
  DELETE_MODAL_CALLBACK_ID,
  ENTRY_SELECT_BLOCK_ID,
  ENTRY_SELECT_ACTION_ID,
  ENTRY_PREVIEW_BLOCK_ID,
  EDIT_TEXT_BLOCK_ID,
  EDIT_TEXT_ACTION_ID,
  ENTRY_MODAL_RECENT_LIMIT,
  buildEntryOption,
  buildEntryPreviewText,
  buildEntryManagementMetadata,
  sanitizeEntryModalCache,
  toEntryModalItem,
  parseEditArgs,
  parseDeleteArgs,
  resolveEntryIdFromModal,
  resolveEditTextFromModal,
  resolveDefaultRepo,
  sendModalConfirmation,
} from "./shared/index.js";
import {
  editManualEntryById,
  deleteManualEntryById,
  listRecentManualEntries,
} from "@/server/services/standup";

function buildEntryManagementModalView(input: {
  callbackId: string;
  title: string;
  submitLabel: string;
  channelId: string;
  teamId: string;
  responseUrl?: string;
  selectedEntry: EntryModalItem;
  entries: EntryModalItem[];
  editText?: string;
}) {
  const entryOptions = input.entries.map((entry) => buildEntryOption(entry));
  const initialOption =
    entryOptions.find((option) => option.value === input.selectedEntry.entryId) ?? entryOptions[0];

  const blocks: (KnownBlock | Block)[] = [
    {
      type: "input",
      block_id: ENTRY_SELECT_BLOCK_ID,
      dispatch_action: true,
      label: {
        type: "plain_text",
        text: "Entry",
      },
      element: {
        type: "static_select",
        action_id: ENTRY_SELECT_ACTION_ID,
        placeholder: {
          type: "plain_text",
          text: "Pick an entry",
        },
        options: entryOptions,
        ...(initialOption ? { initial_option: initialOption } : {}),
      },
    },
    {
      type: "section",
      block_id: ENTRY_PREVIEW_BLOCK_ID,
      text: {
        type: "mrkdwn",
        text: buildEntryPreviewText(input.selectedEntry),
      },
    },
  ];

  if (input.callbackId === EDIT_MODAL_CALLBACK_ID) {
    blocks.push({
      type: "input",
      block_id: `${EDIT_TEXT_BLOCK_ID}:${input.selectedEntry.entryId}`,
      label: {
        type: "plain_text",
        text: "Updated text",
      },
      element: {
        type: "plain_text_input",
        action_id: `${EDIT_TEXT_ACTION_ID}:${input.selectedEntry.entryId}`,
        multiline: true,
        initial_value: input.editText ?? input.selectedEntry.content,
        placeholder: {
          type: "plain_text",
          text: "Write the replacement text for this entry.",
        },
      },
    });
  }

  return {
    type: "modal" as const,
    callback_id: input.callbackId,
    private_metadata: buildEntryManagementMetadata({
      channelId: input.channelId,
      teamId: input.teamId,
      responseUrl: input.responseUrl,
      selectedEntryId: input.selectedEntry.entryId,
      entries: input.entries,
    }),
    title: {
      type: "plain_text" as const,
      text: input.title,
    },
    submit: {
      type: "plain_text" as const,
      text: input.submitLabel,
    },
    close: {
      type: "plain_text" as const,
      text: "Cancel",
    },
    blocks,
  };
}

async function openEditModal(args: CommandArgs) {
  const { command, ack, client, respond } = args;
  await ack();

  const defaultRepo = (await resolveDefaultRepo(command.user_id)) ?? null;
  const parsed = parseEditArgs(command.text ?? "", defaultRepo);
  const entries = (await listRecentManualEntries(command.user_id, ENTRY_MODAL_RECENT_LIMIT)).map(toEntryModalItem);

  if (!entries.length) {
    await respond({
      response_type: "ephemeral",
      text: "No editable entries found yet.",
    });
    return;
  }

  const initialEntry = entries.find((entry) => entry.displayId === parsed?.displayId) ?? entries[0];
  await client.views.open({
    trigger_id: command.trigger_id,
    view: buildEntryManagementModalView({
      callbackId: EDIT_MODAL_CALLBACK_ID,
      title: "Edit entry",
      submitLabel: "Save",
      channelId: command.channel_id,
      teamId: command.team_id,
      responseUrl: command.response_url,
      selectedEntry: initialEntry,
      entries,
      editText: parsed?.text || initialEntry.content,
    }),
  });
}

async function openDeleteModal(args: CommandArgs) {
  const { command, ack, client, respond } = args;
  await ack();

  const defaultRepo = (await resolveDefaultRepo(command.user_id)) ?? null;
  const parsed = parseDeleteArgs(command.text ?? "", defaultRepo);
  const entries = (await listRecentManualEntries(command.user_id, ENTRY_MODAL_RECENT_LIMIT)).map(toEntryModalItem);

  if (!entries.length) {
    await respond({
      response_type: "ephemeral",
      text: "No deletable entries found yet.",
    });
    return;
  }

  const initialEntry = entries.find((entry) => entry.displayId === parsed?.displayId) ?? entries[0];
  await client.views.open({
    trigger_id: command.trigger_id,
    view: buildEntryManagementModalView({
      callbackId: DELETE_MODAL_CALLBACK_ID,
      title: "Delete entry",
      submitLabel: "Delete",
      channelId: command.channel_id,
      teamId: command.team_id,
      responseUrl: command.response_url,
      selectedEntry: initialEntry,
      entries,
    }),
  });
}

async function handleEditModalSubmission(args: ViewArgs) {
  const { ack, body, client, view } = args;
  const content = resolveEditTextFromModal(view);

  if (!content) {
    const editTextBlockId =
      Object.keys(view.state.values).find((blockId) => blockId.startsWith(EDIT_TEXT_BLOCK_ID)) ?? EDIT_TEXT_BLOCK_ID;
    await ack({
      response_action: "errors",
      errors: {
        [editTextBlockId]: "Please enter the updated text.",
      },
    });
    return;
  }

  await ack();

  const metadata = JSON.parse(view.private_metadata || "{}") as {
    channelId?: string;
    responseUrl?: string;
  };
  const entryId = resolveEntryIdFromModal(view);
  const channelId = metadata.channelId ?? body.user.id;

  if (!entryId) {
    await sendModalConfirmation(client, channelId, body.user.id, "Please choose an entry to edit.", metadata.responseUrl);
    return;
  }

  const entry = await editManualEntryById(body.user.id, entryId, content);
  if (!entry) {
    await sendModalConfirmation(
      client,
      channelId,
      body.user.id,
      "I couldn't find that editable entry anymore.",
      metadata.responseUrl,
    );
    return;
  }

  await sendModalConfirmation(
    client,
    channelId,
    body.user.id,
    `✏️ Updated #${entry.displayId}: _"${entry.content}"_`,
    metadata.responseUrl,
  );
}

async function handleDeleteModalSubmission(args: ViewArgs) {
  const { ack, body, client, view } = args;
  await ack();

  const metadata = JSON.parse(view.private_metadata || "{}") as {
    channelId?: string;
    responseUrl?: string;
  };
  const entryId = resolveEntryIdFromModal(view);
  const channelId = metadata.channelId ?? body.user.id;

  if (!entryId) {
    await sendModalConfirmation(client, channelId, body.user.id, "Please choose an entry to delete.", metadata.responseUrl);
    return;
  }

  const entry = await deleteManualEntryById(body.user.id, entryId);
  if (!entry) {
    await sendModalConfirmation(
      client,
      channelId,
      body.user.id,
      "I couldn't find that deletable entry anymore.",
      metadata.responseUrl,
    );
    return;
  }

  await sendModalConfirmation(
    client,
    channelId,
    body.user.id,
    `🗑️ Deleted #${entry.displayId}: _"${entry.content}"_`,
    metadata.responseUrl,
  );
}

async function handleEntrySelectionChange(args: ActionArgs) {
  const { ack, body, client } = args;
  await ack();

  if (!body.view || (body.view.callback_id !== EDIT_MODAL_CALLBACK_ID && body.view.callback_id !== DELETE_MODAL_CALLBACK_ID)) {
    return;
  }

  const metadata = JSON.parse(body.view.private_metadata || "{}") as {
    channelId?: string;
    teamId?: string;
    responseUrl?: string;
    selectedEntryId?: string;
    entryCache?: unknown;
  };
  const cachedEntries = sanitizeEntryModalCache(metadata.entryCache);
  const entries =
    cachedEntries.length > 0
      ? cachedEntries
      : (await listRecentManualEntries(body.user.id, ENTRY_MODAL_RECENT_LIMIT)).map(toEntryModalItem);
  if (!entries.length) {
    return;
  }

  const action = body.actions[0];
  const selectedEntryId =
    action && "selected_option" in action ? action.selected_option?.value ?? "" : "";
  const nextEntry = entries.find((entry) => entry.entryId === selectedEntryId) ?? entries[0];

  await client.views.update({
    view_id: body.view.id,
    hash: body.view.hash,
    view: buildEntryManagementModalView({
      callbackId: body.view.callback_id,
      title: body.view.callback_id === EDIT_MODAL_CALLBACK_ID ? "Edit entry" : "Delete entry",
      submitLabel: body.view.callback_id === EDIT_MODAL_CALLBACK_ID ? "Save" : "Delete",
      channelId: metadata.channelId ?? body.user.id,
      teamId: metadata.teamId ?? body.team?.id ?? "",
      responseUrl: metadata.responseUrl,
      selectedEntry: nextEntry,
      entries,
      editText: body.view.callback_id === EDIT_MODAL_CALLBACK_ID ? nextEntry.content : undefined,
    }),
  });
}

const manage: CommandModule = {
  name: "manage",
  register(app) {
    app.command("/edit", async (args) => openEditModal(args));
    app.command("/delete", async (args) => openDeleteModal(args));

    app.view(EDIT_MODAL_CALLBACK_ID, handleEditModalSubmission);
    app.view(DELETE_MODAL_CALLBACK_ID, handleDeleteModalSubmission);
    app.action(ENTRY_SELECT_ACTION_ID, handleEntrySelectionChange);
  },
};

export default manage;
