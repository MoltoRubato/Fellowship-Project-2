import type { ViewArgs } from "../types.js";
import { normalizeRepo } from "@/server/services/standup";
import {
  REPO_SELECT_BLOCK_ID,
  REPO_SELECT_ACTION_ID,
  REPO_INPUT_BLOCK_ID,
  REPO_INPUT_ACTION_ID,
  ENTRY_SELECT_BLOCK_ID,
  ENTRY_SELECT_ACTION_ID,
  EDIT_TEXT_BLOCK_ID,
  EDIT_TEXT_ACTION_ID,
} from "./constants";

export function resolveRepoFromModal(view: ViewArgs["view"]) {
  const selectedRepo =
    view.state.values[REPO_SELECT_BLOCK_ID]?.[REPO_SELECT_ACTION_ID] &&
    "selected_option" in view.state.values[REPO_SELECT_BLOCK_ID][REPO_SELECT_ACTION_ID]
      ? view.state.values[REPO_SELECT_BLOCK_ID][REPO_SELECT_ACTION_ID].selected_option?.value
      : undefined;

  const typedRepo =
    view.state.values[REPO_INPUT_BLOCK_ID]?.[REPO_INPUT_ACTION_ID] &&
    "value" in view.state.values[REPO_INPUT_BLOCK_ID][REPO_INPUT_ACTION_ID]
      ? view.state.values[REPO_INPUT_BLOCK_ID][REPO_INPUT_ACTION_ID].value
      : undefined;

  return normalizeRepo(selectedRepo ?? typedRepo ?? null);
}

export function resolveDisplayIdFromModal(view: ViewArgs["view"]) {
  const selectedValue =
    view.state.values[ENTRY_SELECT_BLOCK_ID]?.[ENTRY_SELECT_ACTION_ID] &&
    "selected_option" in view.state.values[ENTRY_SELECT_BLOCK_ID][ENTRY_SELECT_ACTION_ID]
      ? view.state.values[ENTRY_SELECT_BLOCK_ID][ENTRY_SELECT_ACTION_ID].selected_option?.value
      : undefined;
  const displayId = Number(selectedValue ?? "");

  return Number.isInteger(displayId) && displayId > 0 ? displayId : null;
}

export function resolveEditTextFromModal(view: ViewArgs["view"]) {
  const matchingBlockId = Object.keys(view.state.values).find((blockId) => blockId.startsWith(EDIT_TEXT_BLOCK_ID));
  const matchingActionId = matchingBlockId
    ? Object.keys(view.state.values[matchingBlockId] ?? {}).find((actionId) => actionId.startsWith(EDIT_TEXT_ACTION_ID))
    : undefined;
  const value =
    matchingBlockId &&
    matchingActionId &&
    view.state.values[matchingBlockId]?.[matchingActionId] &&
    "value" in view.state.values[matchingBlockId][matchingActionId]
      ? view.state.values[matchingBlockId][matchingActionId].value
      : "";

  return (value ?? "").trim();
}
