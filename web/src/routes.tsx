import { createBrowserRouter, Outlet } from 'react-router'
import { RequireAuth } from '@/components/shell/require-auth'
import { StaffIndex, StaffShell } from '@/components/shell/staff-shell'
import { StudentShell } from '@/components/shell/student-shell'
import DevSignIn from '@/pages/auth/DevSignIn'
import Foundations from '@/pages/Foundations'
import NotFound from '@/pages/NotFound'
import StaffPlaceholder from '@/pages/staff/StaffPlaceholder'
import Home from '@/pages/student/Home'
import More from '@/pages/student/More'
import { AnnouncementDetail, AnnouncementsList } from '@/pages/student/Announcements'

// Route map follows docs/design-handoff.md. Screens are added as they are built.
export const router = createBrowserRouter([
  { path: '/login', element: <DevSignIn /> },
  { path: '/foundations', element: <Foundations /> },
  {
    element: (
      <RequireAuth roles={['student']}>
        <Outlet />
      </RequireAuth>
    ),
    children: [
      { element: <StudentShell />, children: [{ index: true, element: <Home /> }] },
      { element: <StudentShell avatar={false} />, children: [{ path: '/more', element: <More /> }] },
      { path: '/announcements', element: <AnnouncementsList /> },
      { path: '/announcements/:id', element: <AnnouncementDetail /> },
    ],
  },
  {
    path: '/staff',
    element: (
      <RequireAuth roles={['lecturer', 'admissions', 'registry', 'librarian', 'admin', 'student_affairs']}>
        <StaffShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <StaffIndex /> },
      { path: 'admissions', element: <StaffPlaceholder context="Admissions" title="Applications" /> },
      { path: 'admissions/decided', element: <StaffPlaceholder context="Admissions" title="Decisions sent" /> },
      { path: 'admissions/places', element: <StaffPlaceholder context="Admissions" title="Intake places" /> },
      { path: 'teaching', element: <StaffPlaceholder context="Teaching" title="Today" /> },
      { path: 'teaching/marking', element: <StaffPlaceholder context="Teaching" title="Marking" /> },
      { path: 'library', element: <StaffPlaceholder context="Library" title="Issue and return" /> },
      { path: 'library/overdue', element: <StaffPlaceholder context="Library" title="Overdue" /> },
      { path: 'library/reservations', element: <StaffPlaceholder context="Library" title="Reservations" /> },
      { path: 'library/catalogue', element: <StaffPlaceholder context="Library" title="Catalogue" /> },
      { path: 'library/reading-lists', element: <StaffPlaceholder context="Library" title="Reading lists" /> },
      { path: 'announcements', element: <StaffPlaceholder context="College" title="Announcements" /> },
      { path: 'ask-questions', element: <StaffPlaceholder context="Student Affairs" title="Questions from Ask TCFL" /> },
      { path: 'students', element: <StaffPlaceholder context="College" title="Find a student" /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])
