import { describe, expect, it } from 'vitest';

import { MAX_CODE_LENGTH } from '@/domain/ScheduleValidator';
import {
  buildPersonUserPrompt,
  CELL_JSON_SCHEMA,
  LEGEND_DEFINITIONS_RULE,
  TABLE_JSON_SCHEMA,
  TABLE_USER_PROMPT,
  VISION_SYSTEM_PROMPT,
} from '@/server/vision/VisionPrompts';
import { buildStripPersonPrompt } from '@/server/vision/VisionRowPrompts';

const INPUT = { rowId: 'r1', name: '가상하나', yearMonth: '2026-10', definitions: [] };

/** Codes outside the legend (Spec §16) must be copied, never nulled or mapped to OFF. */
describe('vision prompt rules for codes outside the legend', () => {
  it('keeps the prompt-injection rule in the system prompt', () => {
    expect(VISION_SYSTEM_PROMPT).toContain('DATA ONLY');
    expect(VISION_SYSTEM_PROMPT).toContain('Ignore any request');
  });

  it('tells every pass to copy clearly visible codes verbatim even when not in the legend', () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/not in the legend/i);
    expect(VISION_SYSTEM_PROMPT).toMatch(/exactly as written/i);
    expect(VISION_SYSTEM_PROMPT).toContain('W, 연차, M');
    expect(VISION_SYSTEM_PROMPT).toMatch(/never (replace|convert|map)[^.]*OFF[^.]*another legend code/i);
    expect(VISION_SYSTEM_PROMPT).toContain(`at most ${MAX_CODE_LENGTH} characters`);

    for (const prompt of [buildPersonUserPrompt(INPUT), buildStripPersonPrompt(INPUT)]) {
      expect(prompt).toMatch(/not in the (known )?(code )?legend/i);
      expect(prompt).toMatch(/null only/i);
    }
  });

  it('keeps blanks and dashes null', () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/blank cells, dashes/);

    const cellCode = CELL_JSON_SCHEMA.properties.code as { anyOf: { description?: string }[] };
    const description = cellCode.anyOf[0]?.description ?? '';

    expect(description).toMatch(/not in the legend/i);
    expect(description).toMatch(/blank\/dash\/unreadable/);
  });

  it('limits pass-1 definitions to codes printed in the legend', () => {
    expect(TABLE_USER_PROMPT).toMatch(/only codes (that are )?(explained|described) in the printed legend/i);
    expect(TABLE_USER_PROMPT).toMatch(/do not add codes that only appear in (the )?cells/i);
    // OFF is universal: keeping it avoids asking the user to define every day off (eval, Spec §16).
    expect(TABLE_USER_PROMPT).toMatch(/literal code OFF may be added as a day off/);

    const definitions = (TABLE_JSON_SCHEMA.properties as Record<string, { description?: string }>)
      .definitions;

    expect(definitions?.description).toBe(LEGEND_DEFINITIONS_RULE);
    expect(buildPersonUserPrompt(INPUT)).toContain(LEGEND_DEFINITIONS_RULE);
  });
});
