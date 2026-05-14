import type { ConversationListItem } from '@/db/queries/conversations';

// Labels the inbox row from the current participant list rather than the
// (frozen) `type` field. A conversation created as `one_to_one` that later
// gained a 3rd participant via addConversationParticipant should display as
// a group thread — `type` is history, participants are present-tense.
export function deriveTitle(
  item: ConversationListItem,
  callerName: string,
): string {
  if (item.name) return item.name;
  const otherNames = item.participantNames.filter((n) => n !== callerName);
  if (item.type === 'general') {
    return otherNames.join(', ') || 'General';
  }
  if (item.participantNames.length <= 2) {
    return otherNames.join(', ') || 'Direct';
  }
  return 'Group';
}
