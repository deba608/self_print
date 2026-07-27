import Skeleton from "./Skeleton";

export default function ManagementSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="management-skeleton-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="management-skeleton-row">
          <Skeleton width="55%" height={16} />
          <Skeleton width="35%" height={13} />
          <Skeleton width="80%" height={13} />
        </div>
      ))}
    </div>
  );
}
