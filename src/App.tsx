import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { PatientView } from "./views/PatientView.tsx";
import { DeskView } from "./views/DeskView.tsx";
import { ProvisionTag } from "./views/ProvisionTag.tsx";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/provision" replace />} />
        <Route path="/o/:officeId" element={<PatientView />} />
        <Route path="/desk/:officeId" element={<DeskView />} />
        <Route path="/provision" element={<ProvisionTag />} />
      </Routes>
    </BrowserRouter>
  );
}
