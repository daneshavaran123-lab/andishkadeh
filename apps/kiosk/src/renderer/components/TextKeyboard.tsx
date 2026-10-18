/** On-screen keyboard for the staff sign-in (the kiosk has a touch screen and no physical keyboard). */
import { useState } from 'react';
import { Icon } from './Icon';

const LETTERS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOLS = ['1234567890', '@#$%&*-_+=', '!?./:;()', ',\'"~^|'];

export function TextKeyboard({ onKey, onBackspace }: { onKey: (ch: string) => void; onBackspace: () => void }) {
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const rows = symbols ? SYMBOLS : LETTERS;
  const type = (ch: string) => {
    onKey(shift ? ch.toUpperCase() : ch);
    setShift(false);
  };
  return (
    <div className="textkbd" dir="ltr" data-testid="text-keyboard">
      {rows.map((row, i) => (
        <div className="row" key={i}>
          {i === 3 && !symbols && (
            <button type="button" className={`fn${shift ? ' on' : ''}`} onClick={() => setShift((v) => !v)} aria-label="حروف بزرگ" aria-pressed={shift}>
              ⇧
            </button>
          )}
          {[...row].map((ch) => (
            <button type="button" key={ch} onClick={() => type(ch)} data-testid={`tk-${ch}`}>
              {shift ? ch.toUpperCase() : ch}
            </button>
          ))}
          {i === 3 && (
            <button type="button" className="fn" onClick={onBackspace} aria-label="حذف" data-testid="tk-back">
              <Icon name="backspace" />
            </button>
          )}
        </div>
      ))}
      <div className="row">
        <button type="button" className="fn wide" onClick={() => setSymbols((v) => !v)} data-testid="tk-mode">
          {symbols ? 'abc' : '#+='}
        </button>
      </div>
    </div>
  );
}
