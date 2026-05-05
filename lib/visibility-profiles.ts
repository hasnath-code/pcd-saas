// Stakeholder visibility profile presets per ARCHITECTURE-saas.md §14.
//
// A `project_stakeholders` row carries a textual `visibility_profile` plus the
// 5 individual flag columns. The profile is a documentation aid — it records
// which preset was selected at invite time. Individual flag changes after
// invite auto-flip the profile to 'custom' (handled by updateStakeholder).
//
// This module is pure data + a small resolver, server-and-client safe (no
// 'use server' directive, no Node imports). Imported by:
//   - actions/stakeholders.ts (invite + update derive flag values from profile)
//   - components/stakeholders/VisibilityProfilePicker.tsx (description card)

export const VISIBILITY_PROFILES = {
  full: {
    canViewFinancials: true,
    canViewDrawings: true,
    canViewSchedule: true,
    canMessage: true,
    canUploadFiles: true,
  },
  progress_only: {
    canViewFinancials: false,
    canViewDrawings: true,
    canViewSchedule: true,
    canMessage: true,
    canUploadFiles: true,
  },
  documents_only: {
    canViewFinancials: false,
    canViewDrawings: true,
    canViewSchedule: false,
    canMessage: false,
    canUploadFiles: true,
  },
  schedule_only: {
    canViewFinancials: false,
    canViewDrawings: false,
    canViewSchedule: true,
    canMessage: false,
    canUploadFiles: false,
  },
} as const;

export type VisibilityProfile = keyof typeof VISIBILITY_PROFILES | 'custom';

export type VisibilityFlags = {
  canViewFinancials: boolean;
  canViewDrawings: boolean;
  canViewSchedule: boolean;
  canMessage: boolean;
  canUploadFiles: boolean;
};

export const VISIBILITY_PROFILE_LABELS: Record<VisibilityProfile, string> = {
  full: 'Full access',
  progress_only: 'Progress only',
  documents_only: 'Documents only',
  schedule_only: 'Schedule only',
  custom: 'Custom',
};

// Resolve a profile + optional custom flags into the 5-flag tuple to write to
// the project_stakeholders row. For preset profiles, customFlags is ignored
// (preset values win); for 'custom', customFlags is required.
export function applyVisibilityProfile(
  profile: VisibilityProfile,
  customFlags?: VisibilityFlags,
): VisibilityFlags {
  if (profile === 'custom') {
    if (!customFlags) {
      throw new Error('applyVisibilityProfile: profile=custom requires customFlags');
    }
    return customFlags;
  }
  return VISIBILITY_PROFILES[profile];
}

// Inverse: given a row's 5 flags, find the matching preset (or 'custom').
// Used by EditStakeholderDialog to render the picker pre-populated.
export function inferVisibilityProfile(flags: VisibilityFlags): VisibilityProfile {
  for (const [name, preset] of Object.entries(VISIBILITY_PROFILES)) {
    if (
      preset.canViewFinancials === flags.canViewFinancials &&
      preset.canViewDrawings === flags.canViewDrawings &&
      preset.canViewSchedule === flags.canViewSchedule &&
      preset.canMessage === flags.canMessage &&
      preset.canUploadFiles === flags.canUploadFiles
    ) {
      return name as VisibilityProfile;
    }
  }
  return 'custom';
}
