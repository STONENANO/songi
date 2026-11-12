import "../legacy.css";

/** Internal and post-purchase pages keep the original dark styling. */
export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="legacy">
      <div className="wrap">{children}</div>
    </div>
  );
}
