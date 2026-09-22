/**
 * VS Code calls `provideFileDecoration` once per visible row on every
 * expand and scroll. Collecting requests for this long turns a viewport
 * into one git invocation: 1000 paths take ~23ms as a batch versus ~16s
 * one at a time.
 */
export const DECORATION_BATCH_WINDOW_MS = 50

/**
 * Requests arriving while git runs wait this long after it returns, so a scroll
 * does not fragment into many spawns.
 */
export const DECORATION_BATCH_COOLDOWN_MS = 20

/** VS Code renders at most two characters in a badge. */
export const MAX_BADGE_LENGTH = 2

/**
 * Repositories with very many ignored files exceed Node's default and get
 * truncated.
 */
export const GIT_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024

/**
 * `git check-ignore` exits with 1 for "no path matched", an answer rather than
 * a failure.
 */
export const GIT_EXIT_NO_MATCH = 1

/**
 * Fields per record in `git check-ignore -v -z`: source, line, pattern, path.
 */
export const CHECK_IGNORE_FIELDS_PER_RECORD = 4

export const CONFIGURATION_SECTION = 'gitIgnoresAndExcludes'

/**
 * Tooltips are markdown, where a lone newline collapses into a space. Two
 * trailing spaces make a hard break.
 */
export const TOOLTIP_ROW_BREAK = '  \n'
