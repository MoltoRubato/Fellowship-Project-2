import "dotenv/config";
import { db } from "../src/server/db";

type DailySequenceSeed = {
  userId: string;
  dateKey: string;
  nextLogDisplayId: number;
  nextSummaryUpdateNo: number;
};

const TEMP_SEQUENCE_OFFSET = 1_000_000_000;

function normalizeSequenceValue(value: number | bigint | null | undefined, fallback: number) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  return fallback;
}

async function backfillLogEntryDateKeys() {
  // Historical rows do not store the user's timezone at write time, so UTC is the safest stable fallback.
  await db.$executeRawUnsafe(`
    UPDATE log_entries
    SET display_date_key = TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    WHERE COALESCE(display_date_key, '') = '';
  `);
}

async function backfillLogEntryDisplayIds() {
  await backfillLogEntryDateKeys();

  await db.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT
        id,
        CASE
          WHEN deleted_at IS NULL AND source IN ('manual', 'dm')
            THEN ${TEMP_SEQUENCE_OFFSET} + ROW_NUMBER() OVER (
              PARTITION BY user_id, display_date_key, (deleted_at IS NULL AND source IN ('manual', 'dm'))
              ORDER BY created_at ASC, ABS(display_id) ASC, id ASC
            )
          ELSE -(${TEMP_SEQUENCE_OFFSET} + ROW_NUMBER() OVER (
            PARTITION BY user_id, display_date_key, (deleted_at IS NULL AND source IN ('manual', 'dm'))
            ORDER BY
              CASE WHEN deleted_at IS NULL THEN created_at ELSE updated_at END ASC,
              created_at ASC,
              ABS(display_id) ASC,
              id ASC
          ))
        END AS next_display_id
      FROM log_entries
    )
    UPDATE log_entries AS entry
    SET display_id = -ranked.next_display_id
    FROM ranked
    WHERE entry.id = ranked.id;
  `);

  await db.$executeRawUnsafe(`
    UPDATE log_entries
    SET display_id = CASE
      WHEN deleted_at IS NULL AND source IN ('manual', 'dm')
        THEN ABS(display_id) - ${TEMP_SEQUENCE_OFFSET}
      ELSE -1 * (ABS(display_id) - ${TEMP_SEQUENCE_OFFSET})
    END
    WHERE ABS(display_id) > ${TEMP_SEQUENCE_OFFSET};
  `);
}

async function backfillSummaryDateKeys() {
  // Historical rows do not store the user's timezone at write time, so UTC is the safest stable fallback.
  await db.$executeRawUnsafe(`
    UPDATE summary_sessions
    SET update_date_key = TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    WHERE COALESCE(update_date_key, '') = '';
  `);
}

async function backfillSummaryUpdateNumbers() {
  await backfillSummaryDateKeys();

  await db.$executeRawUnsafe(`
    WITH ranked AS (
      SELECT
        id,
        ${TEMP_SEQUENCE_OFFSET} + ROW_NUMBER() OVER (
          PARTITION BY user_id, update_date_key
          ORDER BY created_at ASC, ABS(update_no) ASC, id ASC
        ) AS next_update_no
      FROM summary_sessions
    )
    UPDATE summary_sessions AS session
    SET update_no = -ranked.next_update_no
    FROM ranked
    WHERE session.id = ranked.id;
  `);

  await db.$executeRawUnsafe(`
    UPDATE summary_sessions
    SET update_no = ABS(update_no) - ${TEMP_SEQUENCE_OFFSET}
    WHERE ABS(update_no) > ${TEMP_SEQUENCE_OFFSET};
  `);
}

async function rebuildDailySequences() {
  const seeds = await db.$queryRaw<DailySequenceSeed[]>`
    WITH all_keys AS (
      SELECT user_id, display_date_key AS date_key
      FROM log_entries
      WHERE COALESCE(display_date_key, '') <> ''
      UNION
      SELECT user_id, update_date_key AS date_key
      FROM summary_sessions
      WHERE COALESCE(update_date_key, '') <> ''
    ),
    log_stats AS (
      SELECT
        user_id,
        display_date_key AS date_key,
        MAX(display_id) + 1 AS next_log_display_id
      FROM log_entries
      WHERE deleted_at IS NULL
        AND source IN ('manual', 'dm')
      GROUP BY user_id, display_date_key
    ),
    summary_stats AS (
      SELECT
        user_id,
        update_date_key AS date_key,
        MAX(update_no) + 1 AS next_summary_update_no
      FROM summary_sessions
      GROUP BY user_id, update_date_key
    )
    SELECT
      all_keys.user_id AS "userId",
      all_keys.date_key AS "dateKey",
      COALESCE(log_stats.next_log_display_id, 1) AS "nextLogDisplayId",
      COALESCE(summary_stats.next_summary_update_no, 1) AS "nextSummaryUpdateNo"
    FROM all_keys
    LEFT JOIN log_stats
      ON log_stats.user_id = all_keys.user_id
      AND log_stats.date_key = all_keys.date_key
    LEFT JOIN summary_stats
      ON summary_stats.user_id = all_keys.user_id
      AND summary_stats.date_key = all_keys.date_key
    ORDER BY all_keys.user_id, all_keys.date_key;
  `;

  await db.dailySequence.deleteMany();

  for (const seed of seeds) {
    await db.dailySequence.create({
      data: {
        userId: seed.userId,
        dateKey: seed.dateKey,
        nextLogDisplayId: normalizeSequenceValue(seed.nextLogDisplayId, 1),
        nextSummaryUpdateNo: normalizeSequenceValue(seed.nextSummaryUpdateNo, 1),
      },
    });
  }
}

async function backfillDailyUserNumbering() {
  await backfillLogEntryDisplayIds();
  await backfillSummaryUpdateNumbers();
  await rebuildDailySequences();
}

backfillDailyUserNumbering()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (error) => {
    console.error("Failed to backfill per-user daily numbering", error);
    await db.$disconnect();
    process.exit(1);
  });
