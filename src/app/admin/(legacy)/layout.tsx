import "../../legacy.css";

/** Songs, song detail and sign-in keep the original dark styling. */
export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="legacy">
      <div className="wrap">{children}</div>
    </div>
  );
}
