'use client';

import { useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  VISIBILITY_PROFILES,
  VISIBILITY_PROFILE_LABELS,
  type VisibilityFlags,
  type VisibilityProfile,
} from '@/lib/visibility-profiles';

const PROFILE_OPTIONS: VisibilityProfile[] = [
  'full',
  'progress_only',
  'documents_only',
  'schedule_only',
  'custom',
];

const PROFILE_DESCRIPTIONS: Record<Exclude<VisibilityProfile, 'custom'>, string> = {
  full: 'Sees everything — schedule, drawings, financials, and can message + upload.',
  progress_only:
    'Sees schedule + drawings, can message + upload. No financials.',
  documents_only:
    'Sees drawings only — no schedule, no messaging, no financials. Can still upload.',
  schedule_only:
    'Sees schedule only — no drawings, no messaging, no uploads, no financials.',
};

const FLAG_LABELS: Record<keyof VisibilityFlags, string> = {
  canViewSchedule: 'Schedule',
  canViewDrawings: 'Drawings & files',
  canViewFinancials: 'Financials (invoices & quotes)',
  canMessage: 'Send messages',
  canUploadFiles: 'Upload files',
};

const DEFAULT_CUSTOM_FLAGS: VisibilityFlags = {
  canViewFinancials: false,
  canViewDrawings: true,
  canViewSchedule: true,
  canMessage: true,
  canUploadFiles: true,
};

export function VisibilityProfilePicker({
  profile,
  customFlags,
  onProfileChange,
  onCustomFlagsChange,
}: {
  profile: VisibilityProfile;
  customFlags: VisibilityFlags | null;
  onProfileChange: (next: VisibilityProfile) => void;
  onCustomFlagsChange: (next: VisibilityFlags) => void;
}) {
  // When user switches to 'custom', seed the customFlags from the previously
  // selected preset so the toggles reflect a sensible starting point.
  useEffect(() => {
    if (profile === 'custom' && !customFlags) {
      onCustomFlagsChange(DEFAULT_CUSTOM_FLAGS);
    }
  }, [profile, customFlags, onCustomFlagsChange]);

  const effectiveFlags: VisibilityFlags =
    profile === 'custom'
      ? customFlags ?? DEFAULT_CUSTOM_FLAGS
      : VISIBILITY_PROFILES[profile];

  const description =
    profile === 'custom'
      ? 'Custom — pick exactly what this stakeholder can see.'
      : PROFILE_DESCRIPTIONS[profile];

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="visibility-profile">Visibility profile</Label>
        <Select value={profile} onValueChange={(v) => onProfileChange(v as VisibilityProfile)}>
          <SelectTrigger id="visibility-profile">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROFILE_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {VISIBILITY_PROFILE_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {profile === 'custom' && (
        <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            What can they see?
          </legend>
          {(Object.keys(FLAG_LABELS) as (keyof VisibilityFlags)[]).map((flag) => (
            <label key={flag} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={effectiveFlags[flag]}
                onChange={(e) =>
                  onCustomFlagsChange({ ...effectiveFlags, [flag]: e.target.checked })
                }
                className="h-4 w-4 rounded border-input"
              />
              {FLAG_LABELS[flag]}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
