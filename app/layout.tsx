import type { Metadata } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Mono, Inter, Libre_Baskerville } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const libre = Libre_Baskerville({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const description =
  "Turn a DOI, PMID, PMCID, or arXiv ID into BibTeX with a Better BibTeX-style citation key.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const host =
    forwardedHost && /^[a-z0-9.-]+(?::\d+)?$/i.test(forwardedHost)
      ? forwardedHost
      : "doi2bbt.org";
  const protocol =
    requestHeaders.get("x-forwarded-proto") === "http" ? "http" : "https";
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "doi2bbt — Better citation keys from one identifier",
      template: "%s · doi2bbt",
    },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: "/",
      siteName: "doi2bbt",
      title: "doi2bbt — Better citation keys from one identifier",
      description,
      images: [
        {
          url: `${origin}/og.png`,
          width: 1200,
          height: 630,
          alt: "doi2bbt — Better citation keys. One identifier.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "doi2bbt — Better citation keys from one identifier",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${plexMono.variable} ${libre.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
