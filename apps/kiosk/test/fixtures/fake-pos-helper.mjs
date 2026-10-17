// Test double of a bank-terminal helper program (docs/payment-helper.md). Behaviour: argv[2].
//   approve | decline | crash (exits on a sale) | hang (never answers a sale) | garbage (bad lines)
import { createInterface } from 'node:readline';

const mode = process.argv[2] ?? 'approve';
const ledger = new Map();
const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.cmd === 'status') return send({ id: m.id, state: 'OK', detail: `fake ${mode}` });
  if (m.cmd === 'sale') {
    if (mode === 'crash') process.exit(3);
    if (mode === 'hang') return;
    if (mode === 'garbage') {
      process.stdout.write('this is not json\n');
      return send({ id: m.id, outcome: 'MAYBE' });
    }
    const r =
      mode === 'decline'
        ? { outcome: 'FAILED', message: 'موجودی کافی نیست' }
        : { outcome: 'PAID', terminalRef: `T-${m.attemptId.slice(0, 8)}`, rrn: String(m.amountRial), traceNo: '42', message: null };
    ledger.set(m.attemptId, r);
    return send({ id: m.id, ...r });
  }
  if (m.cmd === 'inquire') return send({ id: m.id, ...(ledger.get(m.attemptId) ?? { outcome: 'FAILED', message: 'تراکنش یافت نشد' }) });
  if (m.cmd === 'cancel') return send({ id: m.id, cancelled: true });
});
// The kiosk closed our stdin: it is shutting down.
rl.on('close', () => process.exit(0));
