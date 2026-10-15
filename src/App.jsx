import './App.css'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AppNav from './components/AppNav'
import { NAV_ROUTES } from './components/navItems'
import { cn } from './lib/utils'
import { NavPositionProvider, useNavPosition } from './components/NavPosition'
import { InboxPreferencesProvider } from './context/InboxPreferencesContext'
import { PhonePreferencesProvider } from './context/PhonePreferencesContext'
import InboxScreen from './screens/InboxScreen'
import StatusScreen from './screens/StatusScreen'
import ConversationScreen from './screens/ConversationScreen'
import BroadcastsScreen from './screens/BroadcastsScreen'
import EditTemplateScreen from './screens/EditTemplateScreen'
import ContactsScreen from './screens/ContactsScreen'
import EditContactScreen from './screens/EditContactScreen'
import EditListScreen from './screens/EditListScreen'
import GroupInfoScreen from './screens/GroupInfoScreen'
import SettingsScreen from './screens/SettingsScreen'
import GuardsScreen from './screens/GuardsScreen'
import AutomationScreen from './screens/AutomationScreen'
import GameScreen from './screens/GameScreen'
import RoninClashScreen from './screens/RoninClashScreen'
import LoginScreen from './screens/LoginScreen'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { InboxEventsProvider } from './context/InboxEventsContext'
import { InboxDataProvider, useInboxData } from './context/InboxDataContext'
import { ContactsDataProvider } from './context/ContactsDataContext'
import { useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'

/**
 * The inbox cache and the contacts/lists store live only while a user is signed
 * in. Remounting the providers with the user's id as the key means a sign-out
 * (or a switch of accounts) discards the previous session's data automatically.
 */
function InboxDataBoundary({ children }) {
  const { user } = useAuth()
  if (!user) return children
  return (
    <InboxDataProvider key={user.id}>
      <ContactsDataProvider>{children}</ContactsDataProvider>
    </InboxDataProvider>
  )
}


function Shell() {
  const { position } = useNavPosition()
  const { pathname } = useLocation()
  const { unreadCount } = useInboxData()

  // The bottom nav is the main tab bar. Detail screens (e.g. a conversation or
  // the template editor) have a back arrow in their header instead of the nav,
  // so only show it on the top-level tab routes.
  const showNav = NAV_ROUTES.includes(pathname)

  return (
    <div className="min-h-svh">
      {/* The nav floats over the content; pb-28 keeps the end of each page clear of it */}
      <main className={cn('px-4', showNav ? 'pb-28' : 'pb-4')}>
        <Routes>
          <Route path="/" element={<Navigate to="/inbox" replace />} />
          <Route path="/login" element={<LoginScreen />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/inbox" element={<InboxScreen />} />
            <Route path="/status" element={<StatusScreen />} />
            <Route path="/conversation" element={<Navigate to="/inbox" replace />} />
            <Route path="/conversation/:jid" element={<ConversationScreen />} />
            <Route path="/groups/:jid" element={<GroupInfoScreen />} />
            <Route path="/broadcasts" element={<BroadcastsScreen />} />
            <Route path="/broadcasts/templates/:id" element={<EditTemplateScreen />} />
            <Route path="/contacts" element={<ContactsScreen />} />
            <Route path="/contacts/lists" element={<Navigate to="/contacts?tab=lists" replace />} />
            <Route path="/contacts/lists/:id" element={<EditListScreen />} />
            <Route path="/contacts/:id" element={<EditContactScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/guards" element={<GuardsScreen />} />
            <Route path="/automation" element={<AutomationScreen />} />
            <Route path="/game" element={<GameScreen />} />
            <Route path="/game/roninclash" element={<RoninClashScreen />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>

      {showNav && <AppNav badges={{ inbox: unreadCount }} position={position} />}
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <NavPositionProvider>
          <InboxPreferencesProvider>
            <PhonePreferencesProvider>
              <InboxEventsProvider>
                <InboxDataBoundary>
                  <Shell />
                </InboxDataBoundary>
              </InboxEventsProvider>
            </PhonePreferencesProvider>
          </InboxPreferencesProvider>
        </NavPositionProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App