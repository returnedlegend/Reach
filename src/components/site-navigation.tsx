"use client";

import { ThemeToggle } from "./theme-toggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { CORE_FEATURES, type PublicFeatures } from "@/lib/public-feature-types";
import {
  ArrowUpRight,
  HeartHandshake,
  MapPin,
  Menu,
  Route,
  Soup,
  Users,
} from "lucide-react";

/** Shared navigation for supporting pages; the discovery screen keeps its in-page tabs. */
export function SiteNavigation({
  features = CORE_FEATURES,
}: {
  features?: PublicFeatures;
} = {}) {
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/food-hotspots") return null;
  const destinations = [
    { href: "/", label: "Find food", Icon: Soup },
    ...(features.community
      ? [{ href: "/food-hotspots", label: "Food sharing", Icon: MapPin }]
      : []),
    ...(features.volunteering
      ? [{ href: "/volunteer", label: "Volunteer", Icon: Users }]
      : []),
  ];
  return (
    <>
      <header className="site-navigation" data-secondary-nav>
        <div className="navbar site-navigation-inner">
          <Link href="/" className="site-logo" aria-label="Reach AI home">
            <span>
              <HeartHandshake size={21} aria-hidden="true" />
            </span>
            Reach AI
          </Link>
          <nav className="site-desktop-links" aria-label="Main navigation">
            {destinations.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={pathname === href ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <Link className="btn btn-primary" href="/share">
            Share food
          </Link>
          <ThemeToggle />
          <MoreMenu>
            <Link href="/pantry-planner">
              <Route size={18} />
              Detailed trip planner
            </Link>
            {features.volunteering && (
              <Link href="/volunteer">
                <Users size={18} />
                Volunteer pickups
              </Link>
            )}
            {features.accounts && (
              <Link href="/manage">
                <Soup size={18} />
                Manage a pantry
              </Link>
            )}
            <Link href="/share">
              <HeartHandshake size={18} />
              Host a Food Pickup / Share Extra Food
            </Link>
            <Link href="/admin">
              Admin submissions
              <ArrowUpRight size={15} />
            </Link>
            <Link href="/privacy">
              Privacy & location
              <ArrowUpRight size={15} />
            </Link>
          </MoreMenu>
        </div>
      </header>
      <nav className="dock site-mobile-navigation" aria-label="Main navigation">
        {destinations.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname === href ? "page" : undefined}
          >
            <Icon size={21} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

/** One keyboard-accessible menu shared by discovery and supporting pages. */
export function MoreMenu({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  return (
    <details
      className="dropdown dropdown-end site-more"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary className="btn btn-ghost" aria-label="More navigation">
        <Menu size={21} aria-hidden="true" />
        <span>More</span>
      </summary>
      <nav aria-label="More pages" className="dropdown-content menu">
        {children}
      </nav>
    </details>
  );
}
