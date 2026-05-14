'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createProject } from '@/actions/projects';
import { findOrCreateClient } from '@/actions/clients';

const schema = z.object({
  projectNumber: z
    .string()
    .trim()
    .min(1, 'Project number is required')
    .max(40, 'Project number is too long'),
  siteAddress: z.string().trim().min(1, 'Site address is required').max(500),
  workflowId: z.string().uuid({ message: 'Choose a workflow' }),
  scopeSummary: z.string().trim().max(2000).optional(),
  // Optional client capture (lightweight — just email + name for Session 5;
  // full client editor lands in Session 6).
  clientEmail: z.string().email('Enter a valid client email').optional().or(z.literal('')),
  clientName: z.string().trim().max(120).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export function ProjectCreateForm({
  workflows,
}: {
  workflows: {
    workflowId: string;
    workflowName: string;
    isDefault: boolean;
    stages: { id: string; name: string; position: number }[];
  }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const defaultWorkflow = workflows.find((w) => w.isDefault) ?? workflows[0];

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      projectNumber: '',
      siteAddress: '',
      workflowId: defaultWorkflow?.workflowId ?? '',
      scopeSummary: '',
      clientEmail: '',
      clientName: '',
    },
  });

  function onSubmit(values: FormValues) {
    setError(null);
    startTransition(async () => {
      let clientId: string | undefined;
      const trimmedEmail = values.clientEmail?.trim();
      const trimmedName = values.clientName?.trim();
      if (trimmedEmail && trimmedName) {
        const clientResult = await findOrCreateClient({
          email: trimmedEmail,
          name: trimmedName,
        });
        if ('error' in clientResult) {
          const reason = clientResult.reason ?? clientResult.error;
          setError(`Client lookup failed: ${reason}`);
          toast.error(`Couldn't attach client: ${reason}`);
          return;
        }
        clientId = clientResult.data.clientId;
      } else if (trimmedEmail || trimmedName) {
        setError('Provide both client email and name, or leave both blank.');
        return;
      }

      const result = await createProject({
        projectNumber: values.projectNumber,
        siteAddress: values.siteAddress,
        workflowId: values.workflowId,
        scopeSummary: values.scopeSummary || undefined,
        clientId,
      });
      if ('error' in result) {
        const reason = result.reason ?? result.error;
        setError(reason);
        toast.error(`Couldn't create project: ${reason}`);
        return;
      }
      toast.success(`Project ${values.projectNumber} created.`);
      if (result.data.stakeholderWarning === 'invite_failed') {
        toast.warning(
          "Stakeholder invitation didn't send. You can re-invite from the project page.",
        );
      }
      router.push(`/dashboard/projects/${result.data.projectId}`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New project</CardTitle>
        <CardDescription>
          Assign a workflow and (optionally) a client. The project starts in the
          first stage of the chosen workflow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="projectNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project number</FormLabel>
                  <FormControl>
                    <Input placeholder="P-2026-001" autoComplete="off" {...field} />
                  </FormControl>
                  <FormDescription>
                    Unique within your firm. Pick anything you use internally.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="siteAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Site address</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="42 Riverside Court, London, EC1V 1AA"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="workflowId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workflow</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a workflow" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {workflows.map((w) => (
                        <SelectItem key={w.workflowId} value={w.workflowId}>
                          {w.workflowName}
                          {w.isDefault ? ' (default)' : ''} · {w.stages.length} stages
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scopeSummary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scope summary (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Measured survey, 3 floors, party-wall agreement…"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="rounded-md border bg-muted/30 p-4">
              <p className="text-sm font-medium">Client (optional)</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Attach a client now or add later. Both fields are required if
                you fill either.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="clientName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Client name</FormLabel>
                      <FormControl>
                        <Input placeholder="Jane Homeowner" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="clientEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Client email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="jane@example.com"
                          autoComplete="off"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create project'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
