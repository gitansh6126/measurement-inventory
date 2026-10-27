import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <h2 className="text-xl font-bold text-slate-900">Page Not Found</h2>
      <p className="mt-2 text-sm text-slate-500">The requested resource could not be found.</p>
      <Link href="/products" className="btn-primary mt-4 inline-flex items-center">
        Go to Products
      </Link>
    </div>
  );
}
