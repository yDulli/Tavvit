import { BotPortalPage } from './components/developers/BotPortalPage';
import { BotInvitePage } from './components/bots/BotInvitePage';
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { ImprintPage, PrivacyPage, ReportPage, TermsPage } from './components/legal/LegalPages';
import { LegalController } from './components/legal/LegalController';
import { NotFoundPage } from './components/NotFoundPage';
import { LoginPage } from './components/auth/LoginPage';
import { ForgotPasswordPage } from './components/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './components/auth/ResetPasswordPage';
import { VerifyEmailPage } from './components/auth/VerifyEmailPage';
import { LinkedAccountReturnPage } from './components/linkedAccounts/LinkedAccountReturnPage';
import { MailLanguageController } from './components/MailLanguageController';
import { MfaPromptDialog } from './components/modals/MfaPromptDialog';
import { RegisterPage } from './components/auth/RegisterPage';
import { AppLayout } from './components/layout/AppLayout';
import { JoinPage } from './components/JoinPage';
import { DownloadPage } from './components/download/DownloadPage';
import { SwAutoUpdate } from './components/ui/SwUpdatePrompt';
import { InstanceBranding } from './components/ui/InstanceBranding';
import { AppearanceController } from './components/ui/AppearanceController';
import { ScreenShareSetup } from './components/voice/ScreenShareSetup';
import { TooltipLayer } from './components/ui/TooltipLayer';
import { ContextMenuRenderer } from './components/ui/ContextMenuRenderer';
import { useAuthStore } from './stores/authStore';
import { isElectron } from './platform/platform';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  // i18n-check: allow-literal — the `; return` between the two elements is code, not text.
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AuthRedirect({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  if (token) {
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) {
      return <Navigate to={redirect} replace />;
    }
    return <Navigate to="/channels/@me" replace />;
  }
  return <>{children}</>;
}

export function App() {
  // Boot-completion ping — disarms the main-process boot timer.
  // MUST be first hook on the unconditional render path. Single fire on
  // first commit; main owns "armed once" gating so duplicate calls (e.g.
  // ErrorBoundary path) are idempotent. Semantic: "renderer survived
  // render," NOT "data loaded." A spinner on screen counts as boot success.
  //
  // Gated on VITE_FORCE_BOOT_STALL so the smoke-test harness can build a
  // variant that intentionally never pings, exercising the renderer-stalled
  // recovery path without hand-editing source. Set 'true' / '1' to force stall.
  useEffect(() => {
    if (import.meta.env.VITE_FORCE_BOOT_STALL) return;
    if (typeof window.backspace?.rendererReady === 'function') {
      window.backspace.rendererReady();
    }
  }, []);

  const showTitleBar = isElectron();

  return (
    <div className={`flex flex-col ${showTitleBar ? 'h-screen' : 'contents'}`}>
      {showTitleBar && (
        <div className="flex-shrink-0 bg-surface-base border-b border-border-hard titlebar-drag"
          style={{ height: 'var(--titlebar-inset)', borderBottomWidth: 'calc(1px / var(--interface-scale))' }} />
      )}
      <div className={showTitleBar ? 'flex-1 min-h-0' : 'contents'}>
        <SwAutoUpdate />
        <InstanceBranding />
        <AppearanceController />
        <ScreenShareSetup />
        {/* One menu for the whole app, signed in or not, so a right click
            never falls through to the browser's own (globalContextMenu.ts). */}
        <ContextMenuRenderer />
        {/* One tooltip for the whole app: the name of every icon-only control (ui/TooltipLayer.tsx). */}
        <TooltipLayer />
        <LegalController />
        <MailLanguageController />
        <MfaPromptDialog />
        <Routes>
          <Route
            path="/login"
            element={
              <AuthRedirect>
                <LoginPage />
              </AuthRedirect>
            }
          />
          <Route
            path="/register"
            element={
              <AuthRedirect>
                <RegisterPage />
              </AuthRedirect>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <AuthRedirect>
                <ForgotPasswordPage />
              </AuthRedirect>
            }
          />
          {/* Public, and not behind AuthRedirect: a link works whoever is signed in on this browser. */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          {/* Where a service sends a person back after they signed in there; signs them in here first if needed. */}
          <Route path="/linked-accounts/:provider" element={<LinkedAccountReturnPage />} />
          <Route
            path="/channels/:spaceId/events"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/channels/:spaceId/:channelId?"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/bots/:botId/add"
            element={
              <ProtectedRoute>
                <BotInvitePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/developers/bots/:botId?"
            element={
              <ProtectedRoute>
                <BotPortalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/join/:inviteCode"
            element={<JoinPage />}
          />
          <Route
            path="/explore"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/friends"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inbox"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/about"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          {/* The admin console, under the app's own frame. The server is what protects it. */}
          <Route
            path="/admin/:section?"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
          {/* Public: the desktop installers, for visitors and members alike. */}
          <Route path="/download" element={<DownloadPage />} />
          {/* Public: reachable before and without an account (docs/systems/legal.md). */}
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/imprint" element={<ImprintPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/" element={<Navigate to="/channels/@me" replace />} />
          <Route path="/channels" element={<Navigate to="/channels/@me" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
    </div>
  );
}
