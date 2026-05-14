import { describe, expect, it } from 'vitest';
import { deriveTitle } from '@/components/conversations/deriveTitle';
import type { ConversationListItem } from '@/db/queries/conversations';

function makeItem(overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return {
    id: 'conv-1',
    type: 'one_to_one',
    name: null,
    projectId: null,
    projectNumber: null,
    projectSiteAddress: null,
    lastMessageAt: null,
    lastMessagePreview: null,
    unreadCount: 0,
    participantNames: ['Alice', 'Bob'],
    ...overrides,
  };
}

describe('deriveTitle', () => {
  it('returns the explicit conversation name when set, regardless of count', () => {
    const item = makeItem({
      name: 'Project kickoff',
      participantNames: ['Alice', 'Bob', 'Carol'],
    });
    expect(deriveTitle(item, 'Alice')).toBe('Project kickoff');
  });

  it('labels a 2-participant thread with the other name', () => {
    const item = makeItem({
      type: 'one_to_one',
      participantNames: ['Alice', 'Bob'],
    });
    expect(deriveTitle(item, 'Alice')).toBe('Bob');
  });

  it('falls back to "Direct" when the 1:1 has no other participant', () => {
    const item = makeItem({
      type: 'one_to_one',
      participantNames: ['Alice'],
    });
    expect(deriveTitle(item, 'Alice')).toBe('Direct');
  });

  // Core regression: type=one_to_one with 3 participants should NOT label
  // as "Direct". DEBT-052 — type is frozen at creation but participants can
  // grow via addConversationParticipant.
  it('labels a 3-participant thread as "Group" even when type is still one_to_one', () => {
    const item = makeItem({
      type: 'one_to_one',
      participantNames: ['Alice', 'Bob', 'Carol'],
    });
    expect(deriveTitle(item, 'Alice')).toBe('Group');
  });

  it('labels a 4-participant group thread as "Group"', () => {
    const item = makeItem({
      type: 'group',
      participantNames: ['Alice', 'Bob', 'Carol', 'Dave'],
    });
    expect(deriveTitle(item, 'Alice')).toBe('Group');
  });

  it('joins other participants for general threads', () => {
    const item = makeItem({
      type: 'general',
      participantNames: ['Alice', 'Bob', 'Carol'],
    });
    expect(deriveTitle(item, 'Alice')).toBe('Bob, Carol');
  });

  it('falls back to "General" for an empty general thread', () => {
    const item = makeItem({
      type: 'general',
      participantNames: ['Alice'],
    });
    expect(deriveTitle(item, 'Alice')).toBe('General');
  });
});
