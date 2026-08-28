import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import AdminLayout from "./layouts/AdminLayout";
import AdminTasksPage from "./pages/admin/AdminTasksPage";
import AdminMembersPage from "./pages/admin/AdminMembersPage";
import AdminLogsPage from "./pages/admin/AdminLogsPage";
import MemberLayout from "./layouts/MemberLayout";
import MemberPendingPage from "./pages/member/MemberPendingPage";
import MemberInProgressPage from "./pages/member/MemberInProgressPage";
import MemberCompletedPage from "./pages/member/MemberCompletedPage";
import useAuthStore from "./store/useAuthStore";
import AdminMessagesPage from "./pages/admin/AdminMessagesPage";
import MemberMessagesPage from "./pages/member/MemberMessagesPage";

function ProtectedRoute({ children, role }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/admin"
          element={
            <ProtectedRoute role="admin">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="tasks" replace />} />
          <Route path="tasks" element={<AdminTasksPage />} />
          <Route path="members" element={<AdminMembersPage />} />
          <Route path="logs" element={<AdminLogsPage />} />
          <Route path="messages" element={<AdminMessagesPage />} />
        </Route>

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute role="member">
              <MemberLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="pending" replace />} />
          <Route path="pending" element={<MemberPendingPage />} />
          <Route path="in-progress" element={<MemberInProgressPage />} />
          <Route path="completed" element={<MemberCompletedPage />} />
          <Route path="messages" element={<MemberMessagesPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}