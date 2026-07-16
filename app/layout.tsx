import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import AuthGuard from "@/components/AuthGuard";
import { AuthProvider } from "@/contexts/AuthContext";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

// Force every route to render dynamically (no static HTML caching of the app
// shell). Data itself is fetched client-side, but this guarantees Vercel never
// serves a stale prerendered document. Applied at the root so it cascades to all
// pages (route segment config cannot live in a 'use client' page file).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Audit Tool — ISO 27001 & NIST CSF",
  description: "Internal audit management tool for ISO 27001 and NIST CSF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
  <html lang="en" className={ `${geist.variable} h-full` }>
    <body 
      className="min-h-full bg-slate-50 antialiased"
      suppressHydrationWarning        
    >
        <AuthProvider>
          <AuthGuard>
            <Navbar />
            <main>{children}</main>
          </AuthGuard>
        </AuthProvider>
    </body>
  </html>
);
}