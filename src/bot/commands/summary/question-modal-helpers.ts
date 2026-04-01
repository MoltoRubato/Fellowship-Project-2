import type { Block, KnownBlock } from "@slack/types";
import type { SummaryAnswer, SummaryQuestion } from "@/server/services/summary";
import {
  applyCustomValueToPlaceholderOption,
  optionNeedsActualValue,
} from "@/lib/summary-placeholders";

export const OTHER_VALUE = "__other__";

const QUESTION_CHOICE_BLOCK_ID = "sq_choice";
const QUESTION_CHOICE_ACTION_ID = "sq_choice_action";
const QUESTION_OTHER_BLOCK_ID = "sq_other";
const QUESTION_OTHER_ACTION_ID = "sq_other_action";
const QUESTION_TEXT_BLOCK_ID = "sq_text";
const QUESTION_TEXT_ACTION_ID = "sq_text_action";

type QuestionAnswerResolution =
  | { ok: true; answer: SummaryAnswer }
  | { ok: false; blockId: string; error: string };

export function buildSingleQuestionBlocks(question: SummaryQuestion): (KnownBlock | Block)[] {
  if (question.options.length) {
    return [
      {
        type: "input" as const,
        block_id: QUESTION_CHOICE_BLOCK_ID,
        label: { type: "plain_text" as const, text: question.message },
        element: {
          type: "radio_buttons" as const,
          action_id: QUESTION_CHOICE_ACTION_ID,
          options: [
            ...question.options.map((option) => ({
              text: { type: "plain_text" as const, text: option },
              value: option,
            })),
            {
              text: { type: "plain_text" as const, text: "Other" },
              value: OTHER_VALUE,
            },
          ],
        },
      },
      {
        type: "divider" as const,
      },
      {
        type: "context" as const,
        elements: [
          {
            type: "mrkdwn" as const,
            text: "Selected *Other* or an option with placeholders like *X%* or *Y ms*? Enter the real value or your full answer below.",
          },
        ],
      },
      {
        type: "input" as const,
        block_id: QUESTION_OTHER_BLOCK_ID,
        label: { type: "plain_text" as const, text: "Actual value or custom answer" },
        optional: true,
        element: {
          type: "plain_text_input" as const,
          action_id: QUESTION_OTHER_ACTION_ID,
          placeholder: {
            type: "plain_text" as const,
            text: "e.g. 20%, from 5s to 1s, or a full replacement answer",
          },
        },
      },
    ];
  }

  return [
    {
      type: "input" as const,
      block_id: QUESTION_TEXT_BLOCK_ID,
      label: { type: "plain_text" as const, text: question.message },
      element: {
        type: "plain_text_input" as const,
        action_id: QUESTION_TEXT_ACTION_ID,
        placeholder: { type: "plain_text" as const, text: "Your answer..." },
      },
    },
  ];
}

export function resolveSingleQuestionAnswer(
  values: Record<string, Record<string, unknown>>,
  question: SummaryQuestion,
): QuestionAnswerResolution {
  if (question.options.length) {
    const radioState = values[QUESTION_CHOICE_BLOCK_ID]?.[QUESTION_CHOICE_ACTION_ID] as
      | { selected_option?: { value?: string } }
      | undefined;
    const selectedValue = radioState?.selected_option?.value;
    const otherState = values[QUESTION_OTHER_BLOCK_ID]?.[QUESTION_OTHER_ACTION_ID] as
      | { value?: string }
      | undefined;
    const customValue = otherState?.value?.trim() ?? "";

    if (!selectedValue) {
      return {
        ok: false,
        blockId: QUESTION_CHOICE_BLOCK_ID,
        error: "Choose one option before submitting.",
      };
    }

    if (selectedValue === OTHER_VALUE) {
      if (!customValue) {
        return {
          ok: false,
          blockId: QUESTION_OTHER_BLOCK_ID,
          error: "Add your custom answer below or choose one of the listed options.",
        };
      }

      return {
        ok: true,
        answer: {
          message: question.message,
          answer: customValue,
        },
      };
    }

    if (optionNeedsActualValue(selectedValue)) {
      if (!customValue) {
        return {
          ok: false,
          blockId: QUESTION_OTHER_BLOCK_ID,
          error: "Enter the real value below so the summary does not use a placeholder.",
        };
      }

      return {
        ok: true,
        answer: {
          message: question.message,
          answer: applyCustomValueToPlaceholderOption(selectedValue, customValue),
        },
      };
    }

    return {
      ok: true,
      answer: {
        message: question.message,
        answer: selectedValue,
      },
    };
  }

  const textState = values[QUESTION_TEXT_BLOCK_ID]?.[QUESTION_TEXT_ACTION_ID] as
    | { value?: string }
    | undefined;
  const textValue = textState?.value?.trim();

  if (!textValue) {
    return {
      ok: false,
      blockId: QUESTION_TEXT_BLOCK_ID,
      error: "Add an answer before submitting.",
    };
  }

  return {
    ok: true,
    answer: {
      message: question.message,
      answer: textValue,
    },
  };
}

export function mergeAnswers(existing: SummaryAnswer[], additions: SummaryAnswer[]) {
  const merged = new Map(existing.map((answer) => [answer.message, answer.answer]));

  for (const answer of additions) {
    merged.set(answer.message, answer.answer);
  }

  return [...merged.entries()].map(([message, answer]) => ({ message, answer }));
}
