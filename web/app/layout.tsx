import type { Metadata } from "next";
<<<<<<< HEAD
import { Outfit } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: "Blackrock Mail",
  description: "Webmail for securityblackrock.com",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('sbr-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
=======
import "./globals.css";

export const metadata: Metadata = {
  title: "Security Blackrock Mail",
  description: "Secure, modern webmail for Security Blackrock.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
>>>>>>> 5c00b5ac3a83bac3d4450112924e16bc7192fc80
}
