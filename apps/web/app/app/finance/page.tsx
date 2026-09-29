"use client";

/**
 * Lending & Finance — climate-adjusted credit risk, loan-book analytics,
 * climate stress tests and the physical-risk disclosure report.
 */
import { Suspense, useState } from "react";
import { FileText, Flame, Landmark, LayoutGrid, RefreshCw } from "lucide-react";
import { SectionHeader, Skeleton, SourceTag } from "@/components/hud";
import { Explain } from "@/components/help/Explain";
import Credit from "@/components/finance/Credit";
import Disclosure from "@/components/finance/Disclosure";
import Portfolio from "@/components/finance/Portfolio";
import Stress from "@/components/finance/Stress";
import { Btn, ErrorBox, PendingHistory, TabBar, useTab } from "@/components/insurance/kit";
import { trpc } from "@/lib/trpc";

const TABS = ["credit", "portfolio", "stress", "disclosure"] as const;
type Tab = (typeof TABS)[number];

function FinanceInner() {
  const [tab, setTab] = useTab<Tab>(TABS, "credit");
  const utils = trpc.useUtils();
  const rescore = trpc.finance.rescore.useMutation({ onSuccess: () => (utils.finance.book.invalidate(), utils.finance.stress.invalidate(), utils.finance.disclosure.invalidate()) });
  const book = trpc.finance.book.useQuery(undefined, { refetchInterval: (q) => ((q.state.data?.coverage.fallbackLoans ?? 0) > 0 ? 10_000 : false), staleTime: 5 * 60_000 });
  const me = trpc.workspace.me.useQuery();
  const [sel, setSel] = useState<string | null>(null);
  const open = (id: string | null) => {
    setSel(id);
    if (id) setTab("credit");
  };
  return (
    <div>
      <SectionHeader
        eyebrow="Workspace · Lending & Finance"
        title="Climate-adjusted credit risk"
        description={
          <>
            See how floods, drought, salinity and heat change each borrower’s <Explain term="pd">probability of default</Explain>, your <Explain term="expected_credit_loss">expected credit loss</Explain> and capital — from 35 years of real hazard history plus today’s forecast.
          </>
        }
        actions={
          <Btn variant="outline" loading={book.isFetching || rescore.isPending} onClick={() => rescore.mutate()}>
            <RefreshCw size={13} /> Re-score
          </Btn>
        }
      />
      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "credit", label: "Credit risk", icon: Landmark },
          { value: "portfolio", label: "Portfolio", icon: LayoutGrid },
          { value: "stress", label: "Stress tests", icon: Flame },
          { value: "disclosure", label: "Disclosure report", icon: FileText },
        ]}
      />
      <ErrorBox error={book.error} onRetry={() => book.refetch()} />
      {book.data && <PendingHistory pending={book.data.coverage.fallbackLoans ? book.data.coverage.cells - book.data.coverage.reanalysisCells : 0} total={book.data.coverage.cells} />}
      {!book.data ? (
        <Skeleton className="h-[600px]" />
      ) : tab === "credit" ? (
        <Credit book={book.data} onOpen={open} selected={sel} />
      ) : tab === "portfolio" ? (
        <Portfolio book={book.data} onOpen={open} />
      ) : tab === "stress" ? (
        <Stress onOpen={open} />
      ) : (
        <Disclosure preparedBy={me.data?.user.name ?? "Risk team"} />
      )}
      {book.data && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          <SourceTag>ERA5 / NASA POWER reanalysis · GloFAS v4</SourceTag>
          <SourceTag>{book.data.coverage.reanalysisCells}/{book.data.coverage.cells} reference locations</SourceTag>
          <SourceTag>scored {new Date(book.data.generatedAt).toLocaleString()}</SourceTag>
        </div>
      )}
    </div>
  );
}

export default function FinancePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[600px]" />}>
      <FinanceInner />
    </Suspense>
  );
}
