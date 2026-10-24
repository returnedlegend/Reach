import type { HTMLAttributes, ButtonHTMLAttributes } from "react";

export function Surface({
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) {
  return <article className={`card bg-base-100 ${className}`} {...props} />;
}
export function ActionButton({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <button
      type="button"
      className={`btn ${variant === "primary" ? "btn-primary" : variant === "secondary" ? "btn-outline" : "btn-ghost"} ${className}`}
      {...props}
    />
  );
}
