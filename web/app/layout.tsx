import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Security Blackrock Mail",
  description: "Secure, modern webmail for Security Blackrock.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
