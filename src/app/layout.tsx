import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shopping AI Agent",
  description: "AI-powered price comparison across stores",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
