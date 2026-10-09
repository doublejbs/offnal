'use client';

import Link from 'next/link';
import { CalendarPlus, Image as ImageIcon, Link as LinkIcon, LoaderCircle, ScanLine } from 'lucide-react';
import { useId } from 'react';

import { formatMonthCount, formatPrice } from '@/client/DisplayText';
import { formatHours } from '@/client/LandingCopy';
import { TEAM_COMING_SOON_UPLOAD_TEXT } from '@/client/TeamComingSoonCopy';
import { usePublicConfig } from '@/components/ConfigProvider';
import LandingGuideView from '@/components/upload/LandingGuideView';
import { useUploadState } from '@/components/upload/UseUploadState';
import LoginOptions from '@/components/LoginOptions';
import { isBetaFree } from '@/domain/BillingPolicy';
import { LoginEmphasis } from '@/domain/enums/LoginEmphasis';
import { isTeamComingSoon } from '@/domain/TeamPolicy';

type UploadPanelProps = {
  isLoggedIn: boolean;
};

/**
 * Entry screen: free months and price from server config, AI/deletion notice before choosing a photo; signed out,
 * a service guide (Spec §17). Beta free mode shows no price, free months or payment (Spec §20.4).
 */
const UploadPanel = ({ isLoggedIn }: UploadPanelProps) => {
  const config = usePublicConfig();
  const { billingMode, freeMonthLimit, priceKrw, sourceTtlHours, uploadMaxBytes } = config;
  const isBeta = isBetaFree(config);
  const teamComingSoon = isTeamComingSoon(config);
  const { isUploading, statusText, error, handleFileChange } = useUploadState(uploadMaxBytes);
  const inputId = useId();
  const loginSectionId = useId();
  const freeMonths = formatMonthCount(freeMonthLimit);
  const price = formatPrice(priceKrw);

  return (
    <>
      {!isBeta && <div className="label">처음 {freeMonths}은 무료</div>}
      <h1>
        근무표 한 장이면
        <br />
        이번 달 준비 끝.
      </h1>
      <p>
        내 근무만 달력으로 정리하고
        <br />
        가족과 친구에게 공유해 보세요.
      </p>
      <div className="uploadbox">
        <div className="uploadicon" aria-hidden="true">
          <ScanLine size={22} />
        </div>
        <h2>근무표 사진을 올려 주세요</h2>
        <p>표 전체와 날짜가 선명하게 보이는 사진 (JPG·PNG·WebP)</p>
        <input
          id={inputId}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          disabled={isUploading}
        />
        <label htmlFor={inputId} className="primary" aria-disabled={isUploading} data-busy={isUploading}>
          {isUploading ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : null}
          {isUploading ? '올리는 중…' : '사진 선택'}
        </label>
        <div className="status-line mt-10" role="status" aria-live="polite">
          {statusText}
        </div>
        {error && (
          <div className="warning text-left" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="hint keep-all">
        사진은 AI로 분석하며 공유 화면에는 포함되지 않아요.
        <br />
        확인·저장 후 원본을 삭제해요. 저장하지 않아도 {formatHours(sourceTtlHours)}이 지나면 더 이상 열 수
        없고, 이후 자동으로 삭제돼요.
      </div>
      {/* Signed out, the guide's share section explains these three in detail; the chips would only repeat it. */}
      {isLoggedIn && (
        <div className="benefits">
          <span>
            <CalendarPlus size={16} aria-hidden="true" />
            캘린더 추가
          </span>
          <span>
            <LinkIcon size={16} aria-hidden="true" />
            링크 공유
          </span>
          <span>
            <ImageIcon size={16} aria-hidden="true" />
            이미지 저장
          </span>
        </div>
      )}
      {!isBeta && (
        <div className="block">
          <h2>{freeMonths} 써보고 결정하세요</h2>
          <p>
            그다음 달부터 한 달분 {price}.
            <br />
            필요한 달만 구매하고, 자동 결제는 없어요.
          </p>
        </div>
      )}
      {!isLoggedIn && (
        <LandingGuideView
          billingMode={billingMode}
          freeMonthLimit={freeMonthLimit}
          priceKrw={priceKrw}
          sourceTtlHours={sourceTtlHours}
          isTeamComingSoon={teamComingSoon}
        />
      )}
      {isLoggedIn ? (
        <div className="center">
          <Link href="/calendar" className="textbutton">
            내 달력 보기
          </Link>
          {teamComingSoon ? (
            <span className="tiny">{TEAM_COMING_SOON_UPLOAD_TEXT}</span>
          ) : (
            <Link href="/teams" className="textbutton">
              {isBeta ? '팀으로 함께 쓰기' : '팀으로 함께 쓰기 (베타 기간 무료)'}
            </Link>
          )}
        </div>
      ) : (
        <section className="block" aria-labelledby={loginSectionId}>
          <h2 id={loginSectionId}>이미 이용 중이신가요?</h2>
          <p>로그인하면 저장한 달력을 바로 볼 수 있어요.</p>
          <LoginOptions returnTo="/" primaryLabel="로그인" emphasis={LoginEmphasis.SECONDARY} />
        </section>
      )}
    </>
  );
};

export default UploadPanel;
