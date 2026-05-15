import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Phase 2 Session 14 — "Coming Soon" placeholder for the deferred financial-
// model surface (income breakdown, expenses, profit, people/payroll, AW
// snapshot — see phase-2-scope.md §3.1). Org-side ONLY: per the kickoff
// boundary, clients never see this surface even when it ships.
//
// The placeholder is intentional — it signals "this view is queued, not
// abandoned" to the in-house team, and serves as a self-imposed contract
// that the Phase 2 schema leaves a clean seam for it (line items carry
// `category`, documents store subtotal/vat/total, no read coupling between
// the future model and the documents/payments tables).

export function ProfitabilityComingSoon() {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Profitability</CardTitle>
          <Badge variant="outline">Coming soon</Badge>
        </div>
        <CardDescription>
          Income breakdown across the 9 categories, expenses, profit before
          and after average wage, and the people/payroll block — queued for a
          future phase. The schema seam is in place: line items already carry
          a category and documents store subtotal / VAT / total, so the model
          bolts on without a migration.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Until then, the figures you can see are the source-of-truth
          quote / invoice / payment / receipt records above.
        </p>
      </CardContent>
    </Card>
  );
}
