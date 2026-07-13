import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { PatientView } from "./views/PatientView.tsx";
import { DeskView } from "./views/DeskView.tsx";
import { ProvisionTag } from "./views/ProvisionTag.tsx";
import { LoginView } from "./views/LoginView.tsx";
import { NotFound } from "./views/NotFound.tsx";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public — patient flow is intentionally unauthenticated */}
          <Route path="/o/:officeId" element={<PatientView />} />

          {/* Auth */}
          <Route path="/login" element={<LoginView />} />

          {/* Staff-only routes */}
          <Route
            path="/desk/:officeId"
            element={
              <ProtectedRoute>
                <DeskView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/provision"
            element={
              <ProtectedRoute>
                <ProvisionTag />
              </ProtectedRoute>
            }
          />

          {/* Public landing for the root and any unrecognised path.
              Patients always arrive via /o/:officeId (NFC) and never type
              a URL, so the root is not a meaningful entry point for them.
              This page tells visitors to scan the NFC sticker and offers
              a staff sign-in link without exposing the provisioning tool. */}
          <Route path="/" element={<NotFound />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
