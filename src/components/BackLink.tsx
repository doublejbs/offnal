import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

type BackLinkProps = {
  href: string;
  label?: string;
  /** false where the page must not fetch anything in the background (the sample trial, Spec §26.3). */
  prefetch?: boolean;
};

const BackLink = ({ href, label = '돌아가기', prefetch }: BackLinkProps) => (
  <Link href={href} className="back" prefetch={prefetch}>
    <ChevronLeft size={18} aria-hidden="true" />
    {label}
  </Link>
);

export default BackLink;
