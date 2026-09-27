import { createBrowserRouter } from 'react-router'
import Foundations from '@/pages/Foundations'
import NotFound from '@/pages/NotFound'

// Route map follows docs/design-handoff.md. Screens are added as they are built.
export const router = createBrowserRouter([
  { path: '/', element: <Foundations /> },
  { path: '/foundations', element: <Foundations /> },
  { path: '*', element: <NotFound /> },
])
