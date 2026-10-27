/* eslint-disable @next/next/no-img-element -- product images are arbitrary external URLs */
"use client";

import { useState } from "react";

/** Product image, or the product name on a grey tile (as in the GAS catalog) when missing or broken. */
export function ProductThumb({ src, name, className = "" }: { src: string | null; name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    return <img src={src} alt={name} loading="lazy" className={`object-cover ${className}`} onError={() => setBroken(true)} />;
  }
  return (
    <div className={`flex items-center justify-center bg-slate-200 p-3 text-center font-semibold text-slate-400 ${className}`}>
      <span className="line-clamp-2">{name}</span>
    </div>
  );
}
