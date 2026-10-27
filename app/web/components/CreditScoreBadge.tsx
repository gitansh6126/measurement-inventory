"use client";

export function getCreditScoreTier(score: number = 0) {
  const s = Math.max(0, Math.round(Number(score) || 0));
  if (s <= 20) {
    return {
      tier: "Poor",
      score: s,
      className: "bg-rose-50 text-rose-700 border-rose-200",
      dotColor: "#EF4444",
    };
  }
  if (s <= 40) {
    return {
      tier: "Low",
      score: s,
      className: "bg-orange-50 text-orange-700 border-orange-200",
      dotColor: "#F97316",
    };
  }
  if (s <= 60) {
    return {
      tier: "Moderate",
      score: s,
      className: "bg-amber-50 text-amber-700 border-amber-200",
      dotColor: "#F59E0B",
    };
  }
  if (s <= 80) {
    return {
      tier: "Good",
      score: s,
      className: "bg-blue-50 text-blue-700 border-blue-200",
      dotColor: "#3B82F6",
    };
  }
  if (s <= 100) {
    return {
      tier: "Excellent",
      score: s,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dotColor: "#10B981",
    };
  }
  return {
    tier: "Super",
    score: s,
    className: "bg-amber-100 text-amber-900 border-amber-300",
    dotColor: "#B45309",
  };
}

export function CreditScoreBadge({
  score = 0,
  showTier = false,
  className = "",
}: {
  score?: number;
  showTier?: boolean;
  className?: string;
}) {
  const tier = getCreditScoreTier(score);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums shadow-xs ${tier.className} ${className}`}
      title={`Credit Score: ${tier.score} (${tier.tier})`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: tier.dotColor }}
        aria-hidden="true"
      />
      <span>{tier.score}</span>
      {showTier && <span className="opacity-75 font-normal">· {tier.tier}</span>}
    </span>
  );
}
