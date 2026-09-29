import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";
import { PwaManager } from "@/components/pwa/PwaManager";
import { CommandPaletteHost } from "@/components/command/CommandPaletteHost";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const display = Space_Grotesk({ subsets: ["latin"], display: "swap", variable: "--font-display", weight: ["500", "600", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: {
    default: "Agri-SHIELD — AI-Powered Climate Decision Intelligence",
    template: "%s | Agri-SHIELD",
  },
  description:
    "Agri-SHIELD turns climate data into actionable intelligence for farmers, governments, and supply chains across Asia. Predict floods, track saltwater intrusion, and protect livelihoods with AI.",
  keywords: [
    "climate agriculture",
    "flood prediction",
    "saltwater intrusion",
    "AI farming",
    "climate resilience",
    "Asia agriculture",
    "early warning system",
    "crop protection",
  ],
  authors: [{ name: "Nitya Prakash Pandey" }],
  creator: "Nitya Prakash Pandey",
  publisher: "Agri-SHIELD",
  applicationName: "Agri-SHIELD",
  category: "agriculture",
  appleWebApp: { capable: true, title: "Agri-SHIELD", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_APP_URL ?? "https://agrishield.io",
    title: "Agri-SHIELD — AI-Powered Climate Decision Intelligence",
    description:
      "Act before the flood hits. Save before the salt spreads. Agri-SHIELD protects farmers, empowers governments, and secures supply chains across Asia.",
    siteName: "Agri-SHIELD",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Agri-SHIELD Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agri-SHIELD — Climate Intelligence for Asia's Farmers",
    description:
      "AI-powered flood and salinity prediction platform for farmers, governments, and supply chains.",
    images: ["/og-image.png"],
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://agrishield.io"
  ),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#050a14" },
    { media: "(prefers-color-scheme: dark)", color: "#050a14" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>
          {children}
          <PwaManager />
          <CommandPaletteHost />
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "rgba(17, 24, 39, 0.95)",
                backdropFilter: "blur(16px)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#f8fafc",
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
