'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { updateNotificationPreference } from '@/actions/notifications';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  type NotificationChannel,
  type NotificationEventType,
} from '@/lib/notifications/events';

// Phase 1c §17 + Hard Rule 9: per-channel × per-event toggle matrix.
// One toggle per cell; click calls updateNotificationPreference and
// optimistically updates local state via useTransition.
//
// push + sms are scaffolded (schema-supported, dispatcher rejects with
// channel_not_implemented per Phase 4). Their column is rendered with a
// disabled checkbox and a "Coming soon" tooltip so users see the future
// matrix shape without being able to enable a non-functional channel.

const EVENT_LABELS: Record<NotificationEventType, string> = {
  'auth.password_changed': 'Password changed',
  'team.invited': 'Team invitation sent',
  'team.invitation_accepted': 'Team invitation accepted',
  'project.created': 'New project created',
  'project.stage_changed': 'Project stage moved',
  'project.completed': 'Project completed',
  'stakeholder.invited': 'Stakeholder invited',
  'stakeholder.added_to_project': 'Stakeholder joined project',
  'message.new': 'New message',
  'file.uploaded': 'File uploaded',
  'milestone.scheduled': 'Milestone scheduled',
  'milestone.completed': 'Milestone completed',
  'quote.sent': 'Quote sent',
  'quote.accepted': 'Quote accepted',
  'invoice.sent': 'Invoice sent',
  'invoice.revised': 'Invoice revised',
  'payment.recorded': 'Payment recorded',
  'payment.corrected': 'Payment corrected',
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: 'In-app',
  email: 'Email',
  push: 'Push',
  sms: 'SMS',
};

const ACTIVE_CHANNELS: NotificationChannel[] = ['in_app', 'email'];
const PENDING_CHANNELS: NotificationChannel[] = ['push', 'sms'];

type Pref = { channel: string; eventType: string; enabled: boolean };

export function NotificationPreferencesMatrix({
  identityType,
  initialPrefs,
}: {
  identityType: 'user' | 'client';
  initialPrefs: Pref[];
}) {
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [prefsByKey, setPrefsByKey] = useState<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    for (const p of initialPrefs) m.set(`${p.eventType}|${p.channel}`, p.enabled);
    return m;
  });

  const lookup = useMemo(
    () =>
      (eventType: NotificationEventType, channel: NotificationChannel): boolean => {
        // Default mirrors seed-defaults — in_app + email on, push + sms off.
        const fromState = prefsByKey.get(`${eventType}|${channel}`);
        if (typeof fromState === 'boolean') return fromState;
        return channel === 'in_app' || channel === 'email';
      },
    [prefsByKey],
  );

  function toggle(eventType: NotificationEventType, channel: NotificationChannel) {
    const key = `${eventType}|${channel}`;
    const next = !lookup(eventType, channel);
    // Optimistic update.
    setPrefsByKey((prev) => {
      const m = new Map(prev);
      m.set(key, next);
      return m;
    });
    setPending((prev) => {
      const s = new Set(prev);
      s.add(key);
      return s;
    });

    startTransition(async () => {
      const result = await updateNotificationPreference({
        identityType,
        channel,
        eventType,
        enabled: next,
      });
      setPending((prev) => {
        const s = new Set(prev);
        s.delete(key);
        return s;
      });
      if ('error' in result) {
        // Roll back optimistic state.
        setPrefsByKey((prev) => {
          const m = new Map(prev);
          m.set(key, !next);
          return m;
        });
        toast.error(
          `Could not save preference: ${result.reason ?? result.error}`,
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>
          Pick which events notify you, and how. In-app shows in your
          inbox; email arrives at the address on your account. Push and
          SMS channels are scaffolded for a future release.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium text-muted-foreground">Event</th>
                {NOTIFICATION_CHANNELS.map((c) => (
                  <th
                    key={c}
                    className="px-3 py-2 text-center font-medium text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span>{CHANNEL_LABELS[c]}</span>
                      {PENDING_CHANNELS.includes(c) && (
                        <Badge variant="outline" className="text-[10px]">
                          Coming soon
                        </Badge>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENT_TYPES.map((eventType) => (
                <tr key={eventType} className="border-b last:border-b-0">
                  <td className="py-3 pr-4">{EVENT_LABELS[eventType]}</td>
                  {NOTIFICATION_CHANNELS.map((channel) => {
                    const enabled = lookup(eventType, channel);
                    const isPending = pending.has(`${eventType}|${channel}`);
                    const disabled = !ACTIVE_CHANNELS.includes(channel);
                    return (
                      <td key={channel} className="px-3 py-3 text-center">
                        <label className="inline-flex cursor-pointer items-center justify-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                            checked={enabled}
                            disabled={disabled || isPending}
                            onChange={() => toggle(eventType, channel)}
                            aria-label={`${EVENT_LABELS[eventType]} via ${CHANNEL_LABELS[channel]}`}
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
