/** Shown on every screen in demo mode so mock recognition/payment is never mistaken for the real thing. */
const DemoBanner = () => (
  <div className="demo-banner" role="note">
    개발 데모 모드 · 예시 인식·테스트 결제이며 실제 처리가 아니에요
  </div>
);

export default DemoBanner;
