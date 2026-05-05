'use client';

import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ORG_TYPE_DESCRIPTIONS: Record<string, { headline: string; body: string }> = {
  surveyor: {
    headline: 'Surveyor firm',
    body: 'Measured building surveys, CAD drafting, site visits.',
  },
  architect: {
    headline: 'Architect firm',
    body: 'Design, planning, project delivery.',
  },
};

type OrgType = { slug: string; name: string };

export function OrgTypePicker({ orgTypes }: { orgTypes: OrgType[] }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold">Welcome to PCD</h1>
        <p className="text-muted-foreground">
          What kind of practice are you setting up?
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {orgTypes.map((t) => {
          const copy = ORG_TYPE_DESCRIPTIONS[t.slug] ?? {
            headline: t.name,
            body: '',
          };
          return (
            <Link
              key={t.slug}
              href={`/onboarding/${t.slug}`}
              className="block rounded-xl outline-none ring-offset-background transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="h-full cursor-pointer transition-colors hover:border-foreground/40">
                <CardHeader>
                  <CardTitle>{copy.headline}</CardTitle>
                  <CardDescription>{copy.body}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Continue →
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
