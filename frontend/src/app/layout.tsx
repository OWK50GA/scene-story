import { ThemeProvider } from "@wrksz/themes/next";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";

const fontSans = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

// still deciding
const fontMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Living Movie Memory",
    template: "%s · Living Movie Memory",
  },
  description:
    "A live story-state engine. Catch continuity errors before they reach production, and answer audience questions without spoiling what they haven't seen yet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          themes={["light", "dark"]}
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
