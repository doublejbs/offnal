'use client';

import EmptyState from '@/components/EmptyState';
import LoginOptions from '@/components/LoginOptions';

type AuthRequiredProps = {
  returnTo: string;
  description?: string;
};

const AuthRequired = ({
  returnTo,
  description = '로그인하면 이어서 확인할 수 있어요.',
}: AuthRequiredProps) => (
  <EmptyState label="로그인 필요" title="로그인이 필요해요" description={description}>
    <LoginOptions returnTo={returnTo} primaryLabel="로그인하고 계속하기" />
  </EmptyState>
);

export default AuthRequired;
