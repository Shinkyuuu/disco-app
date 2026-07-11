// Reusable horizontal, wrapping list of preview tiles for a single-select
// setting (e.g. chat font, chat border style). Adding an option to the
// caller's `options` array is the only change needed to grow the list - this
// component never needs to change.
export default function OptionPickerGrid({
  options,
  selectedId,
  onSelect,
  renderPreview,
  tileStyle
}) {
  return (
    <div className="option-picker-grid">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={
            option.id === selectedId
              ? 'option-picker-tile option-picker-tile--active'
              : 'option-picker-tile'
          }
          style={tileStyle ? tileStyle(option) : undefined}
          onClick={() => onSelect(option.id)}
        >
          {renderPreview(option)}
        </button>
      ))}
    </div>
  )
}
