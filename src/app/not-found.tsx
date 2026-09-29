import Link from 'next/link';

import EmptyState from '@/components/EmptyState';

const NotFoundPage = () => (
  <EmptyState
    label="페이지 없음"
    title="찾는 화면이 없어요"
    description="주소를 다시 확인하거나 처음 화면에서 시작해 주세요."
  >
    <Link href="/" className="primary">
      처음으로
    </Link>
    <Link href="/calendar" className="secondary">
      내 달력 보기
    </Link>
  </EmptyState>
);

export default NotFoundPage;
