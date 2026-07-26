import type { Metadata } from "next";
import { Poppins, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Email Outreach Tool",
  description: "Scrape, enrich, and run AI-personalized cold outreach campaigns.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full min-h-screen bg-[var(--content-bg)] font-sans text-[var(--foreground)]">
        <Sidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1400px] px-8 py-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
