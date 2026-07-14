import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Mail, Lock, ArrowRight, CheckCircle } from "lucide-react";
import { getSupabase } from "../lib/supabase.ts";
import { useAuth } from "../context/AuthContext.tsx";
import { CSS } from "../components/styles.ts";

type Mode = "magic" | "password";
type FormState = "idle" | "submitting" | "sent";

const LOGIN_CSS = `
.auth-wrap{
  min-height:100vh; display:flex; align-items:center; justify-content:center;
  padding:24px; font-family:'Inter',system-ui,sans-serif;
  background:radial-gradient(120% 90% at 12% -10%,#FBFAF6 0%,#F4F2EC 46%,#ECE9E0 100%);
  -webkit-font-smoothing:antialiased; box-sizing:border-box;
}
.auth-wrap *{ box-sizing:border-box; }
.auth-card{
  width:100%; max-width:400px; background:#fff;
  border:1px solid #E4E1D8; border-radius:24px;
  box-shadow:0 1px 2px rgba(22,24,43,.06),0 12px 30px -16px rgba(22,24,43,.28);
  padding:36px 32px;
}
.auth-logo{
  display:flex; align-items:center; gap:10px; margin-bottom:28px;
}
.auth-mark{
  width:36px; height:36px; border-radius:11px; display:grid; place-items:center;
  background:linear-gradient(150deg,#2F49D1,#5468ff); color:#fff; flex-shrink:0;
}
.auth-brand-name{
  font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:18px;
  letter-spacing:-.02em; color:#16182B; line-height:1;
}
.auth-brand-sub{ font-size:11px; color:#8A8C9C; margin-top:3px; letter-spacing:.01em; }
.auth-title{
  font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:22px;
  letter-spacing:-.02em; color:#16182B; margin:0 0 6px;
}
.auth-sub{ font-size:13px; color:#3A3D55; line-height:1.5; margin:0 0 24px; }
.auth-tabs{
  display:flex; gap:4px; background:#F4F2EC; border-radius:10px; padding:4px;
  margin-bottom:20px;
}
.auth-tab{
  flex:1; padding:8px; border:none; background:transparent; border-radius:7px;
  font-family:inherit; font-size:12.5px; font-weight:600; color:#8A8C9C;
  cursor:pointer; transition:all .15s;
}
.auth-tab[data-active="true"]{
  background:#fff; color:#16182B;
  box-shadow:0 1px 3px rgba(22,24,43,.1);
}
.auth-field{ margin-bottom:14px; }
.auth-field label{
  display:block; font-size:11px; font-weight:600; color:#3A3D55;
  text-transform:uppercase; letter-spacing:.07em; margin-bottom:6px;
}
.auth-input-wrap{ position:relative; }
.auth-input-wrap svg{
  position:absolute; left:13px; top:50%; transform:translateY(-50%);
  color:#8A8C9C; pointer-events:none;
}
.auth-input{
  width:100%; border:1px solid #E4E1D8; border-radius:11px;
  padding:11px 13px 11px 38px; font-family:inherit; font-size:13.5px;
  color:#16182B; background:#FAFAF8; outline:none; transition:border .15s, background .15s;
}
.auth-input:focus{ border-color:#2F49D1; background:#fff; }
.auth-hint{ font-size:11.5px; color:#8A8C9C; margin-top:6px; line-height:1.5; }
.auth-btn{
  width:100%; padding:13px; border:none; border-radius:12px;
  background:#16182B; color:#fff; font-family:'Space Grotesk',sans-serif;
  font-weight:600; font-size:14px; cursor:pointer;
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  transition:background .15s, transform .12s; margin-top:4px;
}
.auth-btn:hover:not(:disabled){ background:#23263E; transform:translateY(-1px); }
.auth-btn:disabled{ opacity:.45; cursor:not-allowed; transform:none; }
.auth-btn-cobalt{ background:#2F49D1; }
.auth-btn-cobalt:hover:not(:disabled){ background:#1E2F8F; }
.auth-err{
  display:flex; align-items:flex-start; gap:8px; background:#FEF2F2;
  border:1px solid #FECACA; border-radius:10px; padding:10px 12px;
  font-size:12.5px; color:#B91C1C; margin-bottom:14px; line-height:1.45;
}
.auth-sent{
  display:flex; flex-direction:column; align-items:center; text-align:center;
  padding:20px 0;
}
.auth-sent-icon{
  width:60px; height:60px; border-radius:50%; display:grid; place-items:center;
  background:#E4F1EC; color:#15806B; margin-bottom:14px;
}
.auth-sent-title{
  font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:18px;
  color:#16182B; margin:0 0 8px;
}
.auth-sent-body{ font-size:13px; color:#3A3D55; line-height:1.55; margin:0 0 20px; max-width:300px; }
`;

export function LoginView() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/provision";

  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [error, setError] = useState("");

  // Already signed in — redirect immediately.
  if (!loading && session) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFormState("submitting");

    const sb = getSupabase();

    if (mode === "magic") {
      const { error: err } = await sb.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}${from}`,
          shouldCreateUser: false,
        },
      });
      if (err) {
        setError(err.message);
        setFormState("idle");
      } else {
        setFormState("sent");
      }
    } else {
      const { error: err } = await sb.auth.signInWithPassword({ email, password });
      if (err) {
        setError(err.message);
        setFormState("idle");
      }
      // On success, onAuthStateChange fires → session updates → Navigate above redirects.
    }
  }

  return (
    <div className="auth-wrap">
      <style>{CSS}</style>
      <style>{LOGIN_CSS}</style>

      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <div className="auth-brand-name">Carry</div>
            <div className="auth-brand-sub">Staff portal</div>
          </div>
        </div>

        {formState === "sent" ? (
          <div className="auth-sent">
            <div className="auth-sent-icon">
              <CheckCircle size={28} />
            </div>
            <p className="auth-sent-title">Check your email</p>
            <p className="auth-sent-body">
              We sent a sign-in link to <strong>{email}</strong>. Click it to
              open your desk session — no password needed.
            </p>
            <button
              type="button"
              className="auth-btn"
              onClick={() => { setFormState("idle"); setEmail(""); }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <h1 className="auth-title">Staff sign-in</h1>
            <p className="auth-sub">
              Sign in to access your office's front desk.
            </p>

            {/* role="tablist" labels the two mode-select buttons as a group */}
            <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
              <button
                type="button"
                className="auth-tab"
                role="tab"
                aria-selected={mode === "magic"}
                data-active={mode === "magic" ? "true" : "false"}
                onClick={() => { setMode("magic"); setError(""); }}
              >
                Magic link
              </button>
              <button
                type="button"
                className="auth-tab"
                role="tab"
                aria-selected={mode === "password"}
                data-active={mode === "password" ? "true" : "false"}
                onClick={() => { setMode("password"); setError(""); }}
              >
                Password
              </button>
            </div>

            {/* role="alert" announces the error to screen readers as soon as it appears */}
            {error && (
              <div id="auth-err" className="auth-err" role="alert">
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(e)}>
              <div className="auth-field">
                <label htmlFor="auth-email">Email address</label>
                <div className="auth-input-wrap">
                  <Mail size={15} aria-hidden="true" />
                  <input
                    id="auth-email"
                    type="email"
                    className="auth-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@clinic.com"
                    autoComplete="email"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "auth-err" : undefined}
                    required
                  />
                </div>
              </div>

              {mode === "password" && (
                <div className="auth-field">
                  <label htmlFor="auth-password">Password</label>
                  <div className="auth-input-wrap">
                    <Lock size={15} aria-hidden="true" />
                    <input
                      id="auth-password"
                      type="password"
                      className="auth-input"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? "auth-err" : undefined}
                      required
                    />
                  </div>
                </div>
              )}

              {mode === "magic" && (
                <p className="auth-hint">
                  We'll email you a one-click sign-in link — no password required.
                </p>
              )}

              <button
                type="submit"
                className="auth-btn auth-btn-cobalt"
                disabled={formState === "submitting"}
                aria-busy={formState === "submitting"}
              >
                {formState === "submitting" ? (
                  "Signing in…"
                ) : mode === "magic" ? (
                  <>Send magic link <ArrowRight size={15} aria-hidden="true" /></>
                ) : (
                  <>Sign in <ArrowRight size={15} aria-hidden="true" /></>
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
