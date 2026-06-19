import Link from "next/link";
import { useRouter } from "next/router";
import { ReactNode, useState } from "react";

import AuthModal from "@/components/AuthModal";
import { randomProblem } from "@/lib/problems";
import { useAuth } from "@/lib/useAuth";

export default function Layout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [showAuth, setShowAuth] = useState<null | "login" | "signup">(null);

  const NavLink = ({ href, label }: { href: string; label: string }) => {
    const active = router.pathname === href || router.asPath.startsWith(href + "/");
    return (
      <Link
        href={href}
        className={
          "text-sm transition-colors " +
          (active ? "text-white" : "text-muted hover:text-white")
        }
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-border bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-semibold tracking-tight text-accent">
              CodeSphere
            </Link>
            <nav className="flex items-center gap-5">
              <NavLink href="/"            label="Problems"     />
              <NavLink href="/lists"       label="Study Plans"  />
              <NavLink href="/submissions" label="Submissions"  />
              <NavLink href="/leaderboard" label="Leaderboard"  />
              <NavLink href="/daily"       label="Daily"        />
              <button
                onClick={() => router.push(`/problems/${randomProblem().slug}`)}
                className="text-sm text-muted transition-colors hover:text-white"
                title="Open a random problem"
              >
                🎲 Random
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-3 text-sm">
            {loading ? (
              <span className="text-muted">…</span>
            ) : user ? (
              <>
                <Link
                  href={`/profile/${user.username}`}
                  className="flex items-center gap-2 rounded border border-border bg-bg px-3 py-1 hover:border-accent"
                >
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-bg text-[10px] font-bold"
                  >
                    {user.username[0].toUpperCase()}
                  </span>
                  <span>{user.username}</span>
                  <span className="text-xs text-muted">·</span>
                  <span className="text-xs text-muted">{user.rating}</span>
                </Link>
                <button
                  onClick={logout}
                  className="text-xs text-muted hover:text-white"
                  title="log out"
                >
                  logout
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setShowAuth("login")}
                  className="text-muted hover:text-white"
                >
                  log in
                </button>
                <button
                  onClick={() => setShowAuth("signup")}
                  className="rounded bg-accent px-3 py-1 text-bg font-semibold hover:opacity-90"
                >
                  sign up
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      {showAuth && (
        <AuthModal initialMode={showAuth} onClose={() => setShowAuth(null)} />
      )}
    </div>
  );
}
