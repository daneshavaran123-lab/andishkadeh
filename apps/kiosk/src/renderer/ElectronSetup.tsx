/**
 * Windows app, first run: the setup screen (activation code from the panel, server already filled in)
 * writes kiosk.config.json through the main process, which then restarts.
 */
import { useEffect, useState } from 'react';
import { Setup } from './screens/Setup';

const WINDOWS_PRINTERS = [
  { value: 'windows', label: 'چاپگر ویندوز' },
  { value: 'mock', label: 'شبیه‌ساز' },
];

export function ElectronSetup() {
  const api = window.kiosk!.setup!;
  const [printers, setPrinters] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.printers().then(setPrinters, () => setPrinters([]));
  }, [api]);

  if (saved) {
    return (
      <div className="setup">
        <div className="spinner" />
      </div>
    );
  }
  return (
    <Setup
      initial={{ serverUrl: __KIOSK_DEFAULT_SERVER__, payment: 'none', printer: 'windows' }}
      printerOptions={WINDOWS_PRINTERS}
      printerNames={printers}
      verify={(s) => api.verify(s)}
      activate={(serverUrl, code) => api.activate({ serverUrl, code })}
      onSave={async (s) => {
        await api.save(s);
        setSaved(true);
      }}
    />
  );
}
