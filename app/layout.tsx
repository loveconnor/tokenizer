import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tokenizer Lab — Connor Love's tokenizer",
  description: "Explore Connor Love's byte-lossless Unigram tokenizer alongside nine browser-local tokenizer baselines.",
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
