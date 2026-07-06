export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <main className="flex flex-col items-center gap-8 px-6 text-center">
        {/* Logo / Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-2xl font-bold text-white shadow-lg">
            C
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Cascada
          </h1>
        </div>

        {/* Tagline */}
        <p className="max-w-2xl text-xl text-slate-300">
          Regulatory cascade impact analysis for food manufacturers.
          Know what changed. Know what it means for your business.
        </p>

        {/* Value props */}
        <div className="grid max-w-3xl grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
            <div className="mb-3 text-3xl">🔍</div>
            <h3 className="mb-2 font-semibold text-white">Detect</h3>
            <p className="text-sm text-slate-400">
              Monitor 50 states, federal agencies, and retailer mandates in real time.
            </p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
            <div className="mb-3 text-3xl">🔗</div>
            <h3 className="mb-2 font-semibold text-white">Trace</h3>
            <p className="text-sm text-slate-400">
              Follow the cascade from regulation to ingredient to product to customer.
            </p>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-6">
            <div className="mb-3 text-3xl">📊</div>
            <h3 className="mb-2 font-semibold text-white">Decide</h3>
            <p className="text-sm text-slate-400">
              C-suite decision packages with SKU-level exposure and reformulation costs.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="flex gap-4">
          <a
            href="/login"
            className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-700"
          >
            Sign In
          </a>
          <a
            href="/register"
            className="rounded-lg border border-slate-600 px-6 py-3 font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            Get Started
          </a>
        </div>

        {/* Platform status */}
        <div className="mt-8 text-sm text-slate-500">
          Regulatory cascade impact analysis for food manufacturers
        </div>
      </main>
    </div>
  );
}
