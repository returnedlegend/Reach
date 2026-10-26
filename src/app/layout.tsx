import type { Metadata } from "next";
import "./reach-theme.css";
import { SiteNavigation } from "@/components/site-navigation";
import { publicFeatures } from "@/lib/release-features";
export const dynamic = "force-dynamic";
import { themeBootstrap } from "@/lib/theme";
export const metadata: Metadata = {
  title: "ReachAI · Find food nearby",
  applicationName: "ReachAI",
  description:
    "Find source-backed food assistance across central Texas and plan a visit with in-app directions. Regional coverage is growing.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="reach-dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <a className="skip-link" href="#page-content">
          Skip to content
        </a>
        <SiteNavigation features={publicFeatures()} />
        <div id="page-content" tabIndex={-1}>
          {children}
        </div>
      </body>
    </html>
  );
}
