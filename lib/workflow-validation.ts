import { z } from 'zod';

// Zod schemas + helpers for workflow CRUD server actions.
// Auto-slugify is required because workflow_stages has UNIQUE(workflow_id, slug)
// at the DB layer; we derive slugs from user-provided names so the UI stays
// name-only.

// kebab-case, alphanumerics + hyphens, collapses runs of separators, trims edges.
// Examples: "Quote Accepted" -> "quote_accepted", "Drawings In Progress" -> "drawings_in_progress",
// "QA Review!" -> "qa_review". Uses underscores (not hyphens) to match the
// existing system-template slugs in db/seed/data/workflows.ts.
export function slugifyStageName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export const StageInput = z.object({
  name: z.string().trim().min(1, 'Stage name is required').max(60, 'Stage name is too long'),
  position: z.number().int().min(1).max(99),
  isTerminal: z.boolean(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #RRGGBB hex')
    .nullable()
    .optional(),
});

export const CreateWorkflowInput = z.object({
  name: z.string().trim().min(1, 'Workflow name is required').max(100),
  description: z.string().trim().max(500).nullable().optional(),
  stages: z.array(StageInput).min(1, 'At least one stage is required').max(50),
});

export const UpdateWorkflowInput = z.object({
  workflowId: z.string().uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export const AddWorkflowStageInput = z.object({
  workflowId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  position: z.number().int().min(1).max(99),
  isTerminal: z.boolean(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});

export const RemoveWorkflowStageInput = z.object({
  stageId: z.string().uuid(),
});

export const DeleteWorkflowInput = z.object({
  workflowId: z.string().uuid(),
});

export type StageDraft = z.infer<typeof StageInput>;

export type StageValidationFailure =
  | { kind: 'duplicate_name'; name: string }
  | { kind: 'duplicate_slug'; slug: string }
  | { kind: 'duplicate_position'; position: number }
  | { kind: 'non_sequential_positions'; positions: number[] }
  | { kind: 'no_terminal_stage' };

// Validate a draft stage list before any DB calls. Returns the first failure
// (if any). Order: duplicate names → duplicate slugs (after slugify) →
// duplicate positions → non-sequential positions (must be 1..N with no gaps) →
// at least one terminal.
export function validateStageDraft(stages: StageDraft[]): StageValidationFailure | null {
  const nameSet = new Set<string>();
  for (const s of stages) {
    const lc = s.name.trim().toLowerCase();
    if (nameSet.has(lc)) return { kind: 'duplicate_name', name: s.name };
    nameSet.add(lc);
  }

  const slugSet = new Set<string>();
  for (const s of stages) {
    const slug = slugifyStageName(s.name);
    if (slug.length === 0) return { kind: 'duplicate_slug', slug };
    if (slugSet.has(slug)) return { kind: 'duplicate_slug', slug };
    slugSet.add(slug);
  }

  const positions = stages.map((s) => s.position).sort((a, b) => a - b);
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] !== i + 1) {
      return { kind: 'non_sequential_positions', positions };
    }
  }

  const seen = new Set<number>();
  for (const p of stages.map((s) => s.position)) {
    if (seen.has(p)) return { kind: 'duplicate_position', position: p };
    seen.add(p);
  }

  if (!stages.some((s) => s.isTerminal)) {
    return { kind: 'no_terminal_stage' };
  }

  return null;
}

// Build a server-action error reason string from a stage-validation failure.
// Action layer maps these into { error: 'validation_error', reason: <string> }.
export function stageValidationReason(f: StageValidationFailure): string {
  switch (f.kind) {
    case 'duplicate_name':
      return `duplicate_stage_name:${f.name}`;
    case 'duplicate_slug':
      return `duplicate_stage_slug:${f.slug}`;
    case 'duplicate_position':
      return `duplicate_stage_position:${f.position}`;
    case 'non_sequential_positions':
      return `non_sequential_positions:[${f.positions.join(',')}]`;
    case 'no_terminal_stage':
      return 'no_terminal_stage';
  }
}
