export default function Skeleton({
  width,
  height = 16,
  style,
}: {
  width?: number | string;
  height?: number | string;
  style?: React.CSSProperties;
}) {
  return <div className="ui-skeleton" aria-hidden="true" style={{ width, height, ...style }} />;
}
