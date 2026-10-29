// Ported unchanged from references for final inven/marble 2110/frontend1/components/icons.tsx (2026-10-13).
// Small inline SVG icons (no icon package dependency).
type P = { className?: string };
const base = (className = 'h-4 w-4') => ({ className, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true });

export const EyeIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-2.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
  </svg>
);

// Stacked boxes = stock adjustment.
export const BoxesIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

// Hand with coin = pricing.
export const PriceIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="15" cy="6" r="3.5" />
    <path d="M2 14h3.5l3.2-1.6a3 3 0 0 1 2.3-.1L15 14a1.5 1.5 0 0 1-.9 2.8H11v1h4.6l4.6-3a1.7 1.7 0 0 1 2.1 2.6L17 21H8l-3-1.5H2z" />
  </svg>
);


export const EditIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 4h9v2H6v12h12v-7h2v9H4zM18.4 2.6l3 3L12 15H9v-3z" />
  </svg>
);

export const TrashIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M9 2h6l1 2h4v2H4V4h4zM5 8h14l-1 14H6zm4 2v10h2V10zm4 0v10h2V10z" />
  </svg>
);

export const WarnIcon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 2 1 21h22zm-1 7h2v6h-2zm0 8h2v2h-2z" />
  </svg>
);

const stroke = (className = 'h-4 w-4') => ({ className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true });

export const ChevronIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="m9 6 6 6-6 6" /></svg>
);

export const SearchIcon = ({ className }: P) => (
  <svg {...stroke(className)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);

export const PlusIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M12 5v14M5 12h14" /></svg>
);

export const GroupedIcon = ({ className }: P) => (
  <svg {...stroke(className)}><rect x="3" y="4" width="18" height="6" rx="1.5" /><path d="M7 14h14M7 18h14" /></svg>
);

export const ListIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
);

export const DownloadIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" /></svg>
);

export const RupeeIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M7 4h10M7 9h10M7 4c5 0 7 2 7 5s-2 5-7 5l7 6" /></svg>
);

export const AlertIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
);

// ---- Navigation & page icons (stroke style) ----
export const DashboardIcon = ({ className }: P) => (
  <svg {...stroke(className)}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);
export const QuoteIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>
);
export const OrderIcon = ({ className }: P) => (
  <svg {...stroke(className)}><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" /></svg>
);
export const InvoiceIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>
);
export const ArrowInIcon = ({ className }: P) => (
  <svg {...stroke(className)}><circle cx="12" cy="12" r="9" /><path d="M12 7v9m0 0-3.5-3.5M12 16l3.5-3.5" /></svg>
);
export const ArrowOutIcon = ({ className }: P) => (
  <svg {...stroke(className)}><circle cx="12" cy="12" r="9" /><path d="M12 17V8m0 0-3.5 3.5M12 8l3.5 3.5" /></svg>
);
// V3.1 warehouses: a godown (roof + doors) and a shift (two opposite arrows).
export const WarehouseIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M3 10 12 4l9 6v10H3z" /><path d="M7 20v-6h10v6M7 17h10" /></svg>
);
export const ShiftIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3-3m-3 3 3 3" /></svg>
);
export const TruckIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></svg>
);
export const UsersIcon = ({ className }: P) => (
  <svg {...stroke(className)}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></svg>
);
export const BookIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20" /><path d="M8 7h8M8 11h6" /></svg>
);
export const CogIcon = ({ className }: P) => (
  <svg {...stroke(className)}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
);
export const CalendarIcon = ({ className }: P) => (
  <svg {...stroke(className)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
);
export const PrintIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" /></svg>
);
export const ArrowLeftIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M19 12H5m0 0 6-6m-6 6 6 6" /></svg>
);
export const ClockIcon = ({ className }: P) => (
  <svg {...stroke(className)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

export const LayersIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>
);

export const PackageIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <path d="m16.5 9.4-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

export const TagIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

export const BuildingIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
  </svg>
);

// ---- V1 additions (not in marble) ----
export const CartIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" /></svg>
);

export const SidebarIcon = ({ className }: P) => (
  <svg {...stroke(className)}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></svg>
);

export const CloseIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M18 6 6 18M6 6l12 12" /></svg>
);

export const UserIcon = ({ className }: P) => (
  <svg {...stroke(className)}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);

export const DatabaseIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
  </svg>
);

export const UploadIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export const KeyIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m21 3-9.5 9.5M15.5 7.5l3 3M18.5 4.5l3 3" />
  </svg>
);

export const ExpandIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" />
  </svg>
);

export const CollapseIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <path d="M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5" />
  </svg>
);

// Three sliders = display settings (page width, text size, spacing).
export const SlidersIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
);

export const FilterIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

export const LogOutIcon = ({ className }: P) => (
  <svg {...stroke(className)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);


