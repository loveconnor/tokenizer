import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Connor's Tokenizer",
  description: "Compare Connor's byte-lossless Unigram tokenizer with nine browser-local tokenizer baselines.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
