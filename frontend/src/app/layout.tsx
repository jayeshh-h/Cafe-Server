import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Playfair_Display, Poppins } from "next/font/google";
import CookieConsent from "@/components/CookieConsent";
import { Toaster } from "@/components/ui/toast";
import { TenantThemeProvider } from "@/components/TenantThemeProvider";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  display: "swap",
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#261C18",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  metadataBase: new URL("https://cafe-piza.vercel.app"),
  title: {
    default: "Jaadoo Pizza Project | Woodfired Neapolitan Pizza · Artisanal Coffee",
    template: "%s | Jaadoo Pizza Project",
  },
  description:
    "Authentic 48-hour slow-fermented Neapolitan wood-fired pizza, mountain Arabica espresso, and Himalayan wild-harvested tisanes in the heart of Old City, Udaipur.",
  keywords: [
    "Jaadoo Pizza Project",
    "Jaadoo Pizza Udaipur",
    "Italian Restaurant Udaipur",
    "Woodfired Pizza Udaipur",
    "Neapolitan Pizza Rajasthan",
    "Artisanal Coffee Udaipur",
    "Best Cafe Old City Udaipur",
    "Ganesh Ghati Italian Pizzeria",
    "Table Booking Udaipur Cafe",
  ],
  authors: [{ name: "Jaadoo Pizza Project" }],
  creator: "Jaadoo Pizza Project (Jazz and Blues Hospitality LLP)",
  publisher: "Jaadoo Pizza Project",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "https://cafe-piza.vercel.app",
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://cafe-piza.vercel.app",
    siteName: "Jaadoo Pizza Project · Udaipur",
    title: "Jaadoo Pizza Project | Woodfired Neapolitan Pizza · Artisanal Coffee",
    description:
      "48-hour slow fermentation Neapolitan pizza and specialty Arabica roasts at 32 Sitaphal ki gali, Ganesh Ghati, Old City Udaipur.",
    images: [
      {
        url: "/jaadoo-pizza-twilight.png",
        width: 1200,
        height: 630,
        alt: "Jaadoo Pizza Project Woodfired Neapolitan Pizza",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Jaadoo Udaipur | Woodfired Neapolitan Pizza · Artisanal Coffee",
    description:
      "Authentic wood-fired Neapolitan pizza and specialty Arabica roasts in Old City Udaipur.",
    images: ["/jaadoo-pizza-twilight.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
      { url: "/jaadoo-logo-circle.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
      </head>
      <body
        className={`${plusJakarta.variable} ${playfair.variable} ${poppins.variable} antialiased selection:bg-[#B85B43]/20 bg-[#F8F5F0] text-[#140E0A] min-h-screen flex flex-col justify-between`}
      >
        <TenantThemeProvider>
          <div className="flex-1">
            {children}
          </div>
          <Toaster />
          <CookieConsent />
        </TenantThemeProvider>
      </body>
    </html>
  );
}
