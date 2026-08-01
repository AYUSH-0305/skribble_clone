interface Props {
  options: string[];
  onPick: (word: string) => void;
}

export function WordPicker({ options, onPick }: Props) {
  return (
    <div className="overlay">
      <div className="picker">
        <h3>Choose a word to draw</h3>
        <div className="word-options">
          {options.map((w) => (
            <button key={w} onClick={() => onPick(w)}>
              {w}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
