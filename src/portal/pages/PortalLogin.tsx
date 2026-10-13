import React from 'react';
import { ClientLoginSplitView } from '@/components/ClientLoginSplitView';
import { smoothNavigate } from '@/lib/nav';

export interface PortalLoginProps {
  onLoginSuccess?: () => void;
}

export function PortalLogin({ onLoginSuccess }: PortalLoginProps) {
  return (
    <ClientLoginSplitView
      onClose={() => {
        smoothNavigate('/');
      }}
      onSuccess={onLoginSuccess}
    />
  );
}

export default PortalLogin;
