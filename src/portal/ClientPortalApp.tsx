import React, { useState, useEffect } from 'react';
import { readPortalSession } from '../services/portalAuth';
import { portalDb } from '../services/portalDatabase';
import { PortalShell } from './PortalShell';
import { PortalLogin } from './pages/PortalLogin';
import { PortalDashboard } from './pages/PortalDashboard';
import { PortalWebsites } from './pages/PortalWebsites';
import { PortalProjects } from './pages/PortalProjects';
import { PortalBilling } from './pages/PortalBilling';
import { PortalHosting } from './pages/PortalHosting';
import { PortalDomains } from './pages/PortalDomains';
import { PortalFiles } from './pages/PortalFiles';
import { PortalSupport } from './pages/PortalSupport';
import { PortalNotifications } from './pages/PortalNotifications';
import { PortalProfile } from './pages/PortalProfile';
import { PortalConnectorDemo } from './pages/PortalConnectorDemo';
import { PortalAccess } from './pages/PortalAccess';
import { PortalMail } from './pages/PortalMail';

export function ClientPortalApp() {
  const getInitialPath = () => {
    if (typeof window === 'undefined') return '/portal/dashboard';
    const path = window.location.pathname;
    if (path === '/portal' || path === '/portal/' || path === '/client' || path === '/client/' || path === '/portal/login') {
      return '/portal/dashboard';
    }
    return path.startsWith('/portal') ? path : '/portal/dashboard';
  };

  const [currentPath, setCurrentPath] = useState<string>(getInitialPath);
  const [session, setSession] = useState(() => readPortalSession());
  const [portalDataVersion, setPortalDataVersion] = useState(0);
  const [portalSyncError, setPortalSyncError] = useState('');

  useEffect(() => {
    let active = true;
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const impersonateId = urlParams.get('impersonateClientId');

      if (impersonateId) {
        // Older links may still contain the requested client ID. The server-
        // authorized staff session must already be established before this
        // component loads; a URL parameter must never create or replace it.
        window.history.replaceState({}, '', '/portal/dashboard');
        setCurrentPath('/portal/dashboard');
      } else {
        const p = window.location.pathname;
        if (p === '/portal' || p === '/portal/' || p === '/client' || p === '/client/') {
          window.history.replaceState({}, '', '/portal/dashboard');
        }
      }
    }

    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === '/portal' || path === '/portal/') {
        setCurrentPath('/portal/dashboard');
      } else if (path.startsWith('/portal')) {
        setCurrentPath(path);
      }
    };

    const syncPortalData = async (clientId: string) => {
      try {
        await portalDb.syncWithServer(clientId);
        if (active) {
          setPortalSyncError('');
          setPortalDataVersion((version) => version + 1);
        }
      } catch (error) {
        if (active) {
          setPortalSyncError(error instanceof Error ? error.message : 'Could not refresh client portal data.');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    const handleAuthChange = () => {
      const s = readPortalSession();
      setSession(s);
      if (s?.client?.id) {
        void syncPortalData(s.client.id);
      }
    };
    window.addEventListener('cdx_portal_auth_changed', handleAuthChange);

    const initialSess = readPortalSession();
    if (initialSess?.client?.id) {
      void syncPortalData(initialSess.client.id);
    }

    return () => {
      active = false;
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('cdx_portal_auth_changed', handleAuthChange);
    };
  }, []);

  const navigate = (path: string) => {
    setCurrentPath(path);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
    }
  };

  // If unauthenticated, show login
  if (!session) {
    return (
      <PortalLogin
        onLoginSuccess={() => {
          navigate('/portal/dashboard');
        }}
      />
    );
  }

  const client = portalDataVersion > 0
    ? portalDb.getClientById(session.client.id) || session.client
    : session.client;

  // Render appropriate page inside PortalShell
  const renderPage = () => {
    if (currentPath === '/portal/websites') {
      return <PortalWebsites client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/access') {
      return <PortalAccess client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/mail') {
      return <PortalMail client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/projects') {
      return <PortalProjects client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/billing' || currentPath === '/portal/invoices') {
      return <PortalBilling client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/hosting') {
      return <PortalHosting client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/domains') {
      return <PortalDomains client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/files') {
      return <PortalFiles client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/support') {
      return <PortalSupport client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/notifications') {
      return <PortalNotifications client={client} onNavigate={navigate} />;
    }
    if (currentPath === '/portal/profile') {
      return <PortalProfile client={client} onNavigate={navigate} />;
    }
    if (currentPath.startsWith('/portal/connector-demo')) {
      return <PortalConnectorDemo onNavigate={navigate} />;
    }
    // Default to Dashboard
    return <PortalDashboard client={client} onNavigate={navigate} />;
  };

  return (
    <PortalShell currentPath={currentPath} onNavigate={navigate}>
      {portalSyncError && <div role="alert" className="mx-auto w-full px-6 py-2 text-sm text-red-600">{portalSyncError}</div>}
      {renderPage()}
    </PortalShell>
  );
}
