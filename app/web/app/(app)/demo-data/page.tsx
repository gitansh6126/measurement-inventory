"use client";

import { DemoDataManager } from "@/components/DemoDataManager";
import { Restricted } from "@/components/Restricted";
import { PageHeader } from "@/components/ui";

export default function DemoDataPage() {
  return (
    <Restricted permission="company.settings">
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title="Demo Data"
          subtitle="Manage demo data inside the app: reset to clean/empty state or apply sample demo data"
        />

        <DemoDataManager />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="card p-4 space-y-2">
            <h3 className="font-semibold text-xs uppercase tracking-wide text-slate-700">Clean / Empty State</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Use this when you want to test the application from zero: adding fresh categories, entering suppliers,
              creating custom products, or testing CSV/Excel data import workflows.
            </p>
          </div>

          <div className="card p-4 space-y-2">
            <h3 className="font-semibold text-xs uppercase tracking-wide text-slate-700">Rich Demo Dataset</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Use this when you want to explore or demonstrate full features: multi-warehouse transfers, piece cut offcuts,
              chain hoist sets, vendor price spread comparisons, and shortage order fulfillment.
            </p>
          </div>

          <div className="card p-4 space-y-2">
            <h3 className="font-semibold text-xs uppercase tracking-wide text-slate-700">Non-Destructive for Logins</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Both actions preserve your administrator session, company profile, and password accounts, so you never get
              logged out when switching states.
            </p>
          </div>
        </div>
      </div>
    </Restricted>
  );
}
