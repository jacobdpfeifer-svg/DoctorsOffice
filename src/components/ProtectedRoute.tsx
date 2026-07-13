import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import { CSS } from "./styles.ts";

/**
 * Wraps a route so only authenticated staff can reach it.
 *
 * While the initial session is loading (a brief localStorage read) a minimal
 * spinner is shown to avoid a flash-redirect. Once loaded, unauthenticated
 * visitors are sent to /login with the intended destination preserved in
 * router state so LoginView can redirect back after sign-in.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="lf" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{CSS}</style>
        <div className="lf-empty" style={{ padding: "60px 28px" }}>
          <div className="lf-spin" />
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
