import { useState } from "react";
import { emailLogIn, emailSignUp, useAuth } from "@/lib/useAuth";

type Mode = "login" | "signup";

export default function AuthModal({
  initialMode = "login",
  onClose,
}: {
  initialMode?: Mode;
  onClose: () => void;
}) {
  const { refreshProfile } = useAuth();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await emailSignUp(email, password, username);
      } else {
        await emailLogIn(email, password);
      }
      await refreshProfile();
      onClose();
    } catch (err) {
      // Surface Firebase auth errors verbatim — they're already terse.
      setError((err as Error).message || "auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-border bg-panel p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {mode === "signup" ? "Create account" : "Log in"}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-white">×</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <input
              className="w-full rounded border border-border bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none"
              placeholder="username (3-30 chars, a-z A-Z 0-9 _)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            className="w-full rounded border border-border bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
          <input
            type="password"
            className="w-full rounded border border-border bg-bg px-3 py-2 text-sm focus:border-accent focus:outline-none"
            placeholder="password (≥ 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <div className="text-xs text-bad">{error}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-accent py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "…" : mode === "signup" ? "sign up" : "log in"}
          </button>
        </form>
        <div className="mt-4 text-center text-xs text-muted">
          {mode === "signup" ? "Already have an account?" : "No account yet?"}{" "}
          <button
            className="text-accent hover:underline"
            onClick={() => { setError(null); setMode(mode === "signup" ? "login" : "signup"); }}
          >
            {mode === "signup" ? "log in" : "sign up"}
          </button>
        </div>
        <p className="mt-3 text-center text-[10px] text-muted">
          Powered by Firebase Auth
        </p>
      </div>
    </div>
  );
}
