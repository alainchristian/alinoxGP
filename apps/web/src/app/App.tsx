import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { StepUpProvider } from '@/components/step-up';
import { Shell } from '@/components/shell';
import { AccountPage } from '@/features/account/AccountPage';
import { AcceptInvitationPage } from '@/features/auth/AcceptInvitationPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from '@/features/auth/RecoveryPages';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { AdminHomePage } from '@/features/organization/AdminHomePage';
import { DashboardPage } from '@/features/organization/DashboardPage';
import { AdminDeviceDetailPage, AdminDevicesPage } from '@/features/admin/AdminDevicesPage';
import { CataloguePage } from '@/features/admin/CataloguePage';
import { ProvidersPage } from '@/features/admin/ProvidersPage';
import { AccessLogPage } from '@/features/organization/AccessLogPage';
import { BrandingPage } from '@/features/provider/BrandingPage';
import { CustomersPage } from '@/features/provider/CustomersPage';
import { ProviderFleetPage } from '@/features/provider/ProviderFleetPage';
import { ProviderHomePage } from '@/features/provider/ProviderHomePage';
import { ConsentNoticesPage, SupportRequestsPage } from '@/features/admin/SupportAndConsentPages';
import { AddDevicePage } from '@/features/devices/AddDevicePage';
import { DeviceDetailPage } from '@/features/devices/DeviceDetailPage';
import { DevicesPage } from '@/features/devices/DevicesPage';
import { DriversPage } from '@/features/fleet/DriversPage';
import { VehicleDetailPage } from '@/features/fleet/VehicleDetailPage';
import { VehiclesPage } from '@/features/fleet/VehiclesPage';
import { LivePage } from '@/features/live/LivePage';
import { MonitorPage } from '@/features/monitor/MonitorPage';
import {
  AlertsEventsPage,
  BillingPage,
  DeviceHealthPage,
  GeneralSettingsPage,
  GeofencesPage,
  MaintenancePage,
  ReportsAnalyticsPage,
  TripsPlaybackPage,
  VehicleSecurityPage,
} from '@/features/operations/AegisModules';
import { OnboardingPage } from '@/features/organization/OnboardingPage';
import { OrganizationSettingsPage } from '@/features/organization/OrganizationSettingsPage';
import { UsersPage } from '@/features/users/UsersPage';
import { useAuthStore } from '@/lib/auth-store';
import { bootstrapSession, homePathFor } from '@/lib/session';
import { Booting, PublicOnly, RequireAuth, RequireCustomerOrg, RequirePlatformOrg, RequireProviderOrg } from './guards';

function NotFound() {
  return (
    <div className="grid min-h-full place-items-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-1 text-[13px] text-text-muted">The page you are looking for does not exist.</p>
        <a href="/" className="mt-4 inline-block text-[13px] text-brand underline">Go home</a>
      </div>
    </div>
  );
}

function Home() {
  const { status, me } = useAuthStore();
  if (status === 'booting') return <Booting />;
  return <Navigate to={status === 'authenticated' ? homePathFor(me) : '/login'} replace />;
}

export function App() {
  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <StepUpProvider>
      <Routes>
        <Route path="/" element={<Home />} />

        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        {/* Reachable whether or not signed in. */}
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route element={<Shell variant="customer" />}>
            <Route path="/account" element={<AccountPage />} />
          </Route>

          <Route element={<RequireCustomerOrg />}>
            {/* The live map fills the whole content area. */}
            <Route path="/app/live" element={<Shell variant="customer" fullBleed />}>
              <Route index element={<LivePage />} />
            </Route>
            <Route path="/app" element={<Shell variant="customer" />}>
              <Route index element={<DashboardPage />} />
              <Route path="vehicles" element={<VehiclesPage />} />
              <Route path="vehicles/:vehicleId" element={<VehicleDetailPage />} />
              <Route path="drivers" element={<DriversPage />} />
              <Route path="devices" element={<DevicesPage />} />
              <Route path="devices/new" element={<AddDevicePage />} />
              <Route path="devices/:deviceId" element={<DeviceDetailPage />} />
              <Route path="trips" element={<TripsPlaybackPage />} />
              <Route path="geofences" element={<GeofencesPage />} />
              <Route path="alerts" element={<AlertsEventsPage />} />
              <Route path="security" element={<VehicleSecurityPage />} />
              <Route path="device-health" element={<DeviceHealthPage />} />
              <Route path="reports" element={<ReportsAnalyticsPage />} />
              <Route path="maintenance" element={<MaintenancePage />} />
              <Route path="monitor" element={<MonitorPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="settings" element={<GeneralSettingsPage />} />
              <Route path="settings/organization" element={<OrganizationSettingsPage />} />
              <Route path="settings/users" element={<UsersPage />} />
              <Route path="settings/access-log" element={<AccessLogPage />} />
            </Route>
          </Route>

          <Route element={<RequireProviderOrg />}>
            <Route path="/provider" element={<Shell variant="provider" />}>
              <Route index element={<ProviderHomePage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="fleet" element={<ProviderFleetPage />} />
              <Route path="staff" element={<UsersPage title="Staff & permissions" />} />
              <Route path="branding" element={<BrandingPage />} />
            </Route>
          </Route>

          <Route element={<RequirePlatformOrg />}>
            <Route path="/admin" element={<Shell variant="admin" />}>
              <Route index element={<AdminHomePage />} />
              <Route path="staff" element={<UsersPage title="Staff & permissions" />} />
              <Route path="providers" element={<ProvidersPage />} />
              <Route path="catalogue" element={<CataloguePage />} />
              <Route path="devices" element={<AdminDevicesPage />} />
              <Route path="devices/:deviceId" element={<AdminDeviceDetailPage />} />
              <Route path="support" element={<SupportRequestsPage />} />
              <Route path="consent" element={<ConsentNoticesPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </StepUpProvider>
  );
}
