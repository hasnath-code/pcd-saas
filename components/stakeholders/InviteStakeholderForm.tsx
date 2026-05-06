'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { inviteStakeholder } from '@/actions/stakeholders';
import { VisibilityProfilePicker } from './VisibilityProfilePicker';
import type {
  VisibilityFlags,
  VisibilityProfile,
} from '@/lib/visibility-profiles';

const STAKEHOLDER_ROLES = [
  'primary_client',
  'collaborator',
  'observer',
  'billing_contact',
] as const;

const ROLE_LABELS: Record<(typeof STAKEHOLDER_ROLES)[number], string> = {
  primary_client: 'Primary client — main contact for the project',
  collaborator: 'Collaborator — works alongside the team',
  observer: 'Observer — read-only visibility',
  billing_contact: 'Billing contact — financials only',
};

const schema = z.object({
  email: z.string().email('Please enter a valid email').toLowerCase().trim(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  role: z.enum(STAKEHOLDER_ROLES),
});

type FormValues = z.infer<typeof schema>;

export function InviteStakeholderForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<VisibilityProfile>('progress_only');
  const [customFlags, setCustomFlags] = useState<VisibilityFlags | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', name: '', role: 'collaborator' },
  });

  function onSubmit(values: FormValues) {
    setError(null);
    startTransition(async () => {
      const result = await inviteStakeholder({
        projectId,
        ...values,
        visibilityProfile: profile,
        customFlags: profile === 'custom' && customFlags ? customFlags : undefined,
      });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        setError(reason);
        toast.error(`Couldn't invite stakeholder: ${reason}`);
        return;
      }
      if (result.deliveryWarning === 'email_send_failed') {
        toast.warning(
          `Stakeholder added for ${values.email}, but the email could not be delivered. Send them the link another way.`,
        );
      } else {
        toast.success(`Invitation sent to ${values.email}`);
      }
      form.reset({ email: '', name: '', role: 'collaborator' });
      setProfile('progress_only');
      setCustomFlags(null);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Invite stakeholder</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Invite a stakeholder</DialogTitle>
          <DialogDescription>
            They&apos;ll get a magic-link email to access the client portal for
            this project.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            id="invite-stakeholder-form"
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="homeowner@example.com"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Their full name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STAKEHOLDER_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <VisibilityProfilePicker
              profile={profile}
              customFlags={customFlags}
              onProfileChange={(p) => {
                setProfile(p);
                if (p !== 'custom') setCustomFlags(null);
              }}
              onCustomFlagsChange={setCustomFlags}
            />

            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        </Form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="invite-stakeholder-form"
            disabled={isPending}
          >
            {isPending ? 'Sending…' : 'Send invitation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
