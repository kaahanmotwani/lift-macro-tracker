import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/nav";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Lift & Macro Tracker",
  description:
    "Track lifts, macros, and bodyweight. Import from plain notes, estimate meals from photos, and get AI insights on whether you're actually getting stronger.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    // This is what makes "Add to Home Screen" open without Safari chrome —
    // indistinguishable from a native app once it's on the home screen.
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tracker",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
  // Let people pinch-zoom; locking it out is a bad accessibility default.
  maximumScale: 5,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <div className={`mx-auto max-w-2xl px-4 ${user ? "pb-24" : "pb-8"} pt-2`}>{children}</div>
        {user && <BottomNav />}
      </body>
    </html>
  );
}
