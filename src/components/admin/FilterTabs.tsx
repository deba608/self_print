export default function FilterTabs({
  filters,
  activeFilter,
  counts,
  onFilterChange
}: {
  filters: { value: string; label: string }[];
  activeFilter: string;
  counts: Record<string, number>;
  onFilterChange: (filter: string) => void;
}) {
  return (
    <div className="filter-bar">
      {filters.map((filter) => (
        <button
          type="button"
          key={filter.value}
          className={`filter-tab ${activeFilter === filter.value ? "active" : ""}`}
          onClick={() => onFilterChange(filter.value)}
        >
          {filter.label}
          <span className="filter-count">{counts[filter.value] || 0}</span>
        </button>
      ))}
    </div>
  );
}
