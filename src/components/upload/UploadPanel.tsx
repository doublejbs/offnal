'use client';

import { CalendarPlus, Image as ImageIcon, Link as LinkIcon, LoaderCircle, ScanLine } from 'lucide-react';
import { useId } from 'react';

import { formatMonthCount, formatPrice } from '@/client/DisplayText';
import { usePublicConfig } from '@/components/ConfigProvider';
import { useUploadState } from '@/components/upload/UseUploadState';

/** Entry screen: free months and price from server config, AI/deletion notice before choosing a photo. */
const UploadPanel = () => {
  const { freeMonthLimit, priceKrw, uploadMaxBytes } = usePublicConfig();
  const { isUploading, statusText, error, handleFileChange } = useUploadState(uploadMaxBytes);
  const inputId = useId();
  const freeMonths = formatMonthCount(freeMonthLimit);
  const price = formatPrice(priceKrw);

  return (
    <>
      <div className="label">처음 {freeMonths}은 무료</div>
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
        <label
          htmlFor={inputId}
          className="primary"
          aria-disabled={isUploading}
          style={isUploading ? { opacity: 0.6 } : undefined}
        >
          {isUploading ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : null}
          {isUploading ? '올리는 중…' : '사진 선택'}
        </label>
        <div className="status-line" role="status" aria-live="polite" style={{ marginTop: 10 }}>
          {statusText}
        </div>
        {error && (
          <div className="warning" role="alert" style={{ textAlign: 'left' }}>
            {error}
          </div>
        )}
      </div>
      <div className="hint">
        사진은 AI로 분석하며 공유 화면에는 포함되지 않아요.
        <br />
        확인·저장 후 원본을 삭제하고, 저장하지 않아도 보관 기간이 지나면 삭제해요.
      </div>
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
      <div className="block">
        <h2>{freeMonths} 써보고 결정하세요</h2>
        <p>
          그다음 달부터 한 달분 {price}.
          <br />
          필요한 달만 구매하고, 자동 결제는 없어요.
        </p>
      </div>
    </>
  );
};

export default UploadPanel;
