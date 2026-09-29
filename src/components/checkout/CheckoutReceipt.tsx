import { formatYearMonthLabel } from '@/domain/YearMonth';

type CheckoutReceiptProps = {
  yearMonth: string;
  amount: number;
};

const INCLUDED = ['이번 달 근무표 저장', '캘린더 추가 · 링크 · 이미지', '같은 달 근무 수정'];

/** Target month, server-decided amount and what the single purchase includes. */
const CheckoutReceipt = ({ yearMonth, amount }: CheckoutReceiptProps) => (
  <div className="block">
    <div className="tiny">{formatYearMonthLabel(yearMonth)} 이용권</div>
    <div className="price">
      {amount.toLocaleString('ko-KR')}
      <span>원</span>
    </div>
    {INCLUDED.map((item) => (
      <div key={item} className="receipt">
        <span>{item}</span>
        <span>포함</span>
      </div>
    ))}
    <p className="mt-14 mb-0 text-13">단건 구매예요. 다음 달 자동 결제는 없어요.</p>
  </div>
);

export default CheckoutReceipt;
