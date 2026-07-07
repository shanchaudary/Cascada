import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Cascada — Regulatory Cascade Impact Analysis",
    template: "%s | Cascada",
  },
  description:
    "Detect regulatory changes, trace them through your product portfolio, and deliver decision packages to the C-suite with SKU-level exposure and reformulation cost estimates.",
  keywords: [
    "food manufacturing",
    "regulatory compliance",
    "cascade analysis",
    "ingredient tracking",
    "reformulation",
    "FDA compliance",
    "state regulations",
    "food additives",
  ],
  openGraph: {
    title: "Cascada — Regulatory Cascade Impact Analysis",
    description:
      "Know what regulatory changes mean for YOUR business. Not a monitoring tool. Not a compliance tool. Strategic regulatory impact.",
    type: "website",
    locale: "en_US",
    siteName: "Cascada",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 font-sans antialiased">{children}</body>
    </html>
  );
}
