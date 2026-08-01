import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ACTIVE_CONTENT_PACK } from "@/packages/game-content/src";
import "./globals.css";

const CONTENT = ACTIVE_CONTENT_PACK;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: CONTENT.brand.fullTitle,
  description: CONTENT.brand.description,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        data-content-pack={CONTENT.id}
        style={CONTENT.theme.cssVariables as CSSProperties}
      >
        {children}
      </body>
    </html>
  );
}
