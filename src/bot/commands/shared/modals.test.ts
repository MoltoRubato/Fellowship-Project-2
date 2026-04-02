import test from "node:test";
import assert from "node:assert/strict";
import { resolveSummaryReposFromModal } from "./modals";
import {
  SUMMARY_ALL_REPOS_OPTION_VALUE,
  SUMMARY_REPOS_SELECT_ACTION_ID,
  SUMMARY_REPOS_SELECT_BLOCK_ID,
} from "./constants";

function buildView(selectedValues: string[]) {
  return {
    state: {
      values: {
        [SUMMARY_REPOS_SELECT_BLOCK_ID]: {
          [SUMMARY_REPOS_SELECT_ACTION_ID]: {
            type: "multi_static_select",
            selected_options: selectedValues.map((value) => ({
              text: { type: "plain_text", text: value },
              value,
            })),
          },
        },
      },
    },
  } as never;
}

test("resolveSummaryReposFromModal returns null for all repos", () => {
  const repos = resolveSummaryReposFromModal(buildView([SUMMARY_ALL_REPOS_OPTION_VALUE]));

  assert.equal(repos, null);
});

test("resolveSummaryReposFromModal returns null when nothing is selected", () => {
  const repos = resolveSummaryReposFromModal(buildView([]));

  assert.equal(repos, null);
});

test("resolveSummaryReposFromModal returns normalized selected repos", () => {
  const repos = resolveSummaryReposFromModal(
    buildView(["ReadMeIO/ReadMe", "https://github.com/readmeio/gitto"]),
  );

  assert.deepEqual(repos, ["readmeio/readme", "readmeio/gitto"]);
});
