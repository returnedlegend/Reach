"use client";

import { ThemeToggle } from "./theme-toggle";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  HeartHandshake,
  MapPin,
  Menu,
  Route,
  Soup,
  UserRound,
  Users,
} from "lucide-react";

const destinations = [
  { href: "/", label: "Find food", Icon: Soup },
  { href: "/food-hotspots", label: "Food sharing", Icon: MapPin },
  { href: "/volunteer", label: "Volunteer", Icon: Users },
  { href: "/account", label: "Account", Icon: UserRound },
];

/** Shared navigation for supporting pages; the discovery screen keeps its in-page tabs. */
export function SiteNavigation() {
  const pathname = usePathname();
  if (pathname === "/" || pathname === "/food-hotspots") return null;
  return (
    <>
      <header className="site-navigation" data-secondary-nav>
        <div className="navbar site-navigation-inner">
          <Link href="/" className="site-logo" aria-label="Reach home">
            <span>
              <HeartHandshake size={21} aria-hidden="true" />
            </span>
            reach<span className="site-logo-dot">.</span>
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
          <ThemeToggle />
          <MoreMenu>
            <Link href="/pantry-planner">
              <Route size={18} />
              Detailed trip planner
            </Link>
            <Link href="/volunteer">
              <Users size={18} />
              Volunteer pickups
            </Link>
            <Link href="/manage">
              <Soup size={18} />
              Manage a pantry
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
