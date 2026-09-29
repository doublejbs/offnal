import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

type BackLinkProps = {
  href: string;
  label?: string;
};

const BackLink = ({ href, label = '돌아가기' }: BackLinkProps) => (
  <Link href={href} className="back">
    <ChevronLeft size={18} aria-hidden="true" />
    {label}
  </Link>
);

export default BackLink;
