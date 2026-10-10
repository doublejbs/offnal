'use client';

import { useRef, useState } from 'react';

import { sendClientEvent } from '@/client/ClientAnalytics';
import { shareLaterLink } from '@/client/ShareLater';
import { AnalyticsEvent } from '@/domain/enums/AnalyticsEvent';

/** Share-later control state (Spec §26.4): one share/copy at a time, a status line, a measured click. */
export const useShareLaterState = (shareUrl: string) => {
  const [message, setMessage] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const busyRef = useRef(false);

  const handleShareLater = async () => {
    if (busyRef.current) {
      return;
    }

    busyRef.current = true;
    setIsSharing(true);
    setMessage(null);

    try {
      const result = await shareLaterLink(shareUrl);

      setMessage(result.message);
      sendClientEvent({ event: AnalyticsEvent.SHARE_LATER_CLICKED, properties: { method: result.method } });
    } finally {
      busyRef.current = false;
      setIsSharing(false);
    }
  };

  return { message, isSharing, handleShareLater };
};
