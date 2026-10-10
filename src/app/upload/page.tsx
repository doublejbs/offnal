import { type Metadata } from 'next';

import { buildShareLaterUrl } from '@/client/ShareLater';
import UploadPanel from '@/components/upload/UploadPanel';
import { getAppConfig } from '@/server/config/AppConfig';
import { getServerComponentContext } from '@/server/http/RequestContext';
import { buildEntryPageMetadata, readSiteMetadataSource } from '@/server/metadata/SiteMetadata';

/** Own og:url for link previews; the root layout leaves it unset so other pages don't inherit it. */
export const generateMetadata = (): Metadata => buildEntryPageMetadata(readSiteMetadataSource(), '/upload');

const UploadPage = async () => {
  const context = await getServerComponentContext();

  return (
    <UploadPanel
      isLoggedIn={Boolean(context.user)}
      shareLaterUrl={buildShareLaterUrl(getAppConfig().appUrl)}
    />
  );
};

export default UploadPage;
