import { createBrowserRouter } from 'react-router'
import { RequireAuth } from '@/components/shell/require-auth'
import { StaffIndex, StaffShell } from '@/components/shell/staff-shell'
import { StudentRoot, StudentShell } from '@/components/shell/student-shell'
import DevSignIn from '@/pages/auth/DevSignIn'
import Foundations from '@/pages/Foundations'
import NotFound from '@/pages/NotFound'
import StaffPlaceholder from '@/pages/staff/StaffPlaceholder'
import AdmissionsQueue from '@/pages/staff/admissions/Queue'
import AdmissionsReview from '@/pages/staff/admissions/Review'
import AnnouncementCompose from '@/pages/staff/announcements/Compose'
import AnnouncementsStaff from '@/pages/staff/announcements/List'
import LibraryDesk from '@/pages/staff/library/Desk'
import LibraryOverdue from '@/pages/staff/library/Overdue'
import LibraryReservations from '@/pages/staff/library/Reservations'
import ClassPage from '@/pages/staff/teaching/ClassPage'
import Marking from '@/pages/staff/teaching/Marking'
import Marks from '@/pages/staff/teaching/Marks'
import Register from '@/pages/staff/teaching/Register'
import LecturerToday from '@/pages/staff/teaching/Today'
import Home from '@/pages/student/Home'
import More from '@/pages/student/More'
import ModuleDetail from '@/pages/student/ModuleDetail'
import Modules from '@/pages/student/Modules'
import Deadlines from '@/pages/student/Deadlines'
import SubmitWork from '@/pages/student/SubmitWork'
import Timetable from '@/pages/student/Timetable'
import Results from '@/pages/student/Results'
import Fees from '@/pages/student/Fees'
import StudentCard from '@/pages/student/StudentCard'
import Library, { LibrarySearch, ReadingListPage } from '@/pages/student/Library'
import Search from '@/pages/student/Search'
import { AnnouncementDetail, AnnouncementsList } from '@/pages/student/Announcements'

// Route map follows docs/design-handoff.md. Screens are added as they are built.
export const router = createBrowserRouter([
  { path: '/login', element: <DevSignIn /> },
  { path: '/foundations', element: <Foundations /> },
  {
    element: (
      <RequireAuth roles={['student']}>
        <StudentRoot />
      </RequireAuth>
    ),
    children: [
      {
        element: <StudentShell />,
        children: [
          { index: true, element: <Home />, handle: { desk: true } },
          { path: '/modules', element: <Modules />, handle: { desk: true } },
          { path: '/deadlines', element: <Deadlines />, handle: { desk: true } },
          { path: '/library', element: <Library />, handle: { desk: true } },
        ],
      },
      { path: '/modules/:code', element: <ModuleDetail /> },
      { path: '/deadlines/:id/submit', element: <SubmitWork /> },
      { path: '/timetable', element: <Timetable /> },
      { path: '/results', element: <Results /> },
      { path: '/fees', element: <Fees /> },
      { path: '/card', element: <StudentCard /> },
      { path: '/library/search', element: <LibrarySearch /> },
      { path: '/search', element: <Search /> },
      { path: '/library/lists/:code', element: <ReadingListPage /> },
      {
        element: <StudentShell avatar={false} />,
        children: [{ path: '/more', element: <More />, handle: { desk: true } }],
      },
      { path: '/announcements', element: <AnnouncementsList /> },
      { path: '/announcements/:id', element: <AnnouncementDetail /> },
    ],
  },
  {
    // Taken on a phone in class (design/Register): no staff sidebar.
    path: '/staff/teaching/register/:slotId/:date',
    element: (
      <RequireAuth roles={['lecturer']}>
        <Register />
      </RequireAuth>
    ),
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
      { path: 'admissions', element: <AdmissionsQueue /> },
      { path: 'admissions/decided', element: <AdmissionsQueue decided /> },
      { path: 'admissions/places', element: <StaffPlaceholder context="Admissions" title="Intake places" /> },
      { path: 'admissions/:reference', element: <AdmissionsReview /> },
      { path: 'teaching', element: <LecturerToday /> },
      { path: 'teaching/marking', element: <Marking /> },
      { path: 'teaching/assessments/:id/marks', element: <Marks /> },
      { path: 'teaching/classes/:id', element: <ClassPage /> },
      { path: 'library', element: <LibraryDesk /> },
      { path: 'library/overdue', element: <LibraryOverdue /> },
      { path: 'library/reservations', element: <LibraryReservations /> },
      { path: 'library/catalogue', element: <StaffPlaceholder context="Library" title="Catalogue" /> },
      { path: 'library/reading-lists', element: <StaffPlaceholder context="Library" title="Reading lists" /> },
      { path: 'announcements', element: <AnnouncementsStaff /> },
      { path: 'announcements/new', element: <AnnouncementCompose /> },
      { path: 'announcements/:id', element: <AnnouncementCompose /> },
      { path: 'ask-questions', element: <StaffPlaceholder context="Student Affairs" title="Questions from Ask TCFL" /> },
      { path: 'students', element: <StaffPlaceholder context="College" title="Find a student" /> },
    ],
  },
  { path: '*', element: <NotFound /> },
])
