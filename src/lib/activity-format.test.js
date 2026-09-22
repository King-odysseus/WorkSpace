import { describe, expect, it } from 'vitest';
import { activityKindLabel, activityMessageParts } from './activity-format.js';

describe('activity formatting', () => {
  it('removes the actor prefix from its own activity message', () => {
    expect(activityMessageParts('Amara Okafor moved a task to In progress.', 'Amara Okafor')).toEqual({
      actor: 'Amara Okafor',
      detail: 'moved a task to In progress.',
    });
  });

  it('keeps messages that do not begin with the actor intact', () => {
    expect(activityMessageParts('Workspace capacity was updated.', 'System')).toEqual({
      actor: 'System',
      detail: 'Workspace capacity was updated.',
    });
  });

  it('uses a readable label for known and future activity kinds', () => {
    expect(activityKindLabel('task_status')).toBe('Task status');
    expect(activityKindLabel('screen_capture_viewed')).toBe('Screen Capture Viewed');
  });
});
