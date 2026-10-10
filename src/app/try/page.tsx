import { type Metadata } from 'next';

import SampleTryScreen from '@/components/try/SampleTryScreen';
import { buildSampleTryMetadata, readSiteMetadataSource } from '@/server/metadata/SiteMetadata';

/** Public, data-free introduction page: indexable like the entry screen, no per-request lookup (Spec §26.3-B). */
export const generateMetadata = (): Metadata => buildSampleTryMetadata(readSiteMetadataSource());

const SampleTryPage = () => <SampleTryScreen />;

export default SampleTryPage;
