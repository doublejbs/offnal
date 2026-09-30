type DemoBannerProps = {
  message: string;
};

/** Shown on every screen while mock recognition/payment or demo login is active, so it is never mistaken for the real thing. */
const DemoBanner = ({ message }: DemoBannerProps) => (
  <div className="demo-banner" role="note">
    {message}
  </div>
);

export default DemoBanner;
