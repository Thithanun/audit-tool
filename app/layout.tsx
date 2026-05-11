import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import { AuthProvider } from "@/contexts/AuthContext";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "Audit Tool — ISO 27001:2022 & NIST CSF 2.0",
  description: "Internal audit management tool for ISO 27001:2022 and NIST CSF 2.0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
  <html lang="en" className={ `${geist.variable} h-full` }>
    <body 
      className="min-h-full bg-slate-50 antialiased"
      suppressHydrationWarning        
    >
        <AuthProvider>
          <Navbar />
          <main>{children}</main>
        </AuthProvider>
    </body>
  </html>
);
}