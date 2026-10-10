import { type Metadata } from 'next';

import SampleTryScreen from '@/components/try/SampleTryScreen';
import { getServerComponentContext } from '@/server/http/RequestContext';
import { buildSampleTryMetadata, readSiteMetadataSource } from '@/server/metadata/SiteMetadata';

/** Public, data-free introduction page: indexable like the entry screen (Spec §26.3-B). */
export const generateMetadata = (): Metadata => buildSampleTryMetadata(readSiteMetadataSource());

/** Logged-in users may be redirected from `/` to their calendar, so they get the plain upload page. */
const UPLOAD_HREF_SIGNED_OUT = '/#upload';
const UPLOAD_HREF_SIGNED_IN = '/upload#upload';

const SampleTryPage = async () => {
  const context = await getServerComponentContext();

  return <SampleTryScreen ctaHref={context.user ? UPLOAD_HREF_SIGNED_IN : UPLOAD_HREF_SIGNED_OUT} />;
};

export default SampleTryPage;
