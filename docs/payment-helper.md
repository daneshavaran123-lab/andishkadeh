# کارتخوان بانکی و برنامه کمکی (PC-POS)

کیوسک ویندوز مبلغ را به پایانه بانک می‌فرستد و نتیجه را می‌گیرد. اتصال کامپیوتر به پایانه (PC-POS یا PcToPos) را هر شرکت پرداخت (PSP) با SDK خودش فراهم می‌کند. این SDKها معمولاً کتابخانه‌های ویندوزی .NET یا DLL هستند و مستقیم در برنامه کیوسک بارگذاری نمی‌شوند.

به همین دلیل کیوسک با یک **برنامه کمکی** کوچک کار می‌کند. این برنامه SDK را صدا می‌زند و کیوسک از طریق ورودی و خروجی استاندارد با آن حرف می‌زند.

| بخش | وضعیت |
| --- | --- |
| سمت کیوسک (آداپتر `helper`) | پیاده‌سازی و آزموده شده: فروش، رد، قطع برنامه، بی‌پاسخی، پاسخ نامعتبر، برنامه ناموجود (`apps/kiosk/test/payment-helper.test.ts`) |
| برنامه کمکی آسان پرداخت / بانک شهر | **پس از تحویل SDK** نوشته می‌شود؛ مستندات فنی SDK آسان پرداخت عمومی نیست |

## آنچه باید از آسان پرداخت / بانک شهر گرفت

1. **فعال‌سازی PC-POS روی همان پایانه.** این کار را پشتیبانی شرکت پرداخت انجام می‌دهد.
2. **SDK یا کتابخانه اتصال و مستند آن**، دست‌کم برای این کارها:
   - فروش با مبلغ مشخص
   - استعلام نتیجه یک تراکنش (یا آخرین تراکنش) با شماره مرجع
   - لغو پیش از کشیدن کارت، اگر پشتیبانی می‌شود
3. **نوع اتصال:** شبکه (IP و پورت پایانه)، USB یا سریال (COM).
4. **قالب پاسخ:** شماره مرجع (RRN)، شماره پیگیری (Trace)، سریال پایانه، کدهای خطا و متن آن‌ها.
5. **واحد مبلغ.** معمولاً ریال است.
6. **تأیید پس از فروش.** آیا پس از فروش موفق «تأیید» یا «settle» لازم است؟ اگر بله، برنامه کمکی پیش از پاسخ PAID آن را انجام می‌دهد.
7. **پایانه آزمایشی** یا روش آزمون با مبلغ کم.

## پیکربندی کیوسک

در `%APPDATA%\AndishkadehKiosk\kiosk.config.json`:

```json
{
  "adapters": {
    "payment": "helper",
    "paymentHelperPath": "C:\\Program Files\\AndishkadehPos\\pos-helper.exe",
    "paymentHelperArgs": ["--ip", "192.168.1.224"]
  }
}
```

- وقتی کارتخوان `helper` است، نوار «حالت آزمایشی» برای کارتخوان نمایش داده نمی‌شود.
- مهلت پاسخ فروش از پنل ← «تنظیمات» ← «مهلت پاسخ کارتخوان» (پیش‌فرض ۱۲۰ ثانیه) می‌آید.
- اگر برنامه کمکی پیدا یا اجرا نشود، فروش انجام نمی‌شود، کارتی کشیده نمی‌شود و وضعیت کارتخوان در پنل «خطا» است.

## پروتکل

برنامه کمکی یک بار اجرا می‌شود و تا بسته شدن کیوسک باز می‌ماند.

- **قالب پیام:** هر پیام یک شیء JSON در یک خط UTF-8 است. کیوسک درخواست‌ها را در stdin برنامه می‌نویسد و پاسخ‌ها را از stdout می‌خواند.
- **شناسه:** هر درخواست یک `id` دارد و پاسخ باید همان `id` را برگرداند. خط‌های غیر JSON و پاسخ‌های بدون `id` شناخته‌شده نادیده گرفته می‌شوند.
- **گزارش و خطاها:** فقط در stderr نوشته شوند. stderr در گزارش کیوسک ثبت می‌شود.

| درخواست | فیلدها | پاسخ |
| --- | --- | --- |
| `status` | — | `{"id", "state": "OK" \| "WARNING" \| "ERROR" \| "UNKNOWN", "detail"}` |
| `sale` | `amountRial`، `amountToman`، `orderRef` (شماره سفارش)، `attemptId` (شناسه یکتای تلاش) | نتیجه تراکنش (پایین) |
| `inquire` | `attemptId`، `terminalRef`، `amountRial`، `amountToman` | نتیجه تراکنش |
| `cancel` | `attemptId` | `{"id", "cancelled": true \| false}` |

نتیجه تراکنش:

```json
{ "id": "…", "outcome": "PAID", "terminalRef": "…", "rrn": "…", "traceNo": "…", "message": null }
```

مقدار `outcome` یکی از این‌هاست:
- `PAID`: پایانه تراکنش را تأیید کرد.
- `FAILED`: رد شد و مبلغی کسر نشد.
- `CANCELLED`: مشتری لغو کرد.
- `UNKNOWN`: نتیجه معلوم نیست.

نمونه:

```
→ {"id":"7f…","cmd":"sale","amountRial":12500000,"amountToman":1250000,"orderRef":"AK-000123","attemptId":"0b9f…"}
← {"id":"7f…","outcome":"PAID","terminalRef":"123456","rrn":"601234567890","traceNo":"000042","message":null}
```

### قواعد ایمنی (الزامی)

- **`PAID` فقط وقتی** که پایانه یا بانک تأیید قطعی داده است.
- **هر تردید `UNKNOWN` است،** نه `FAILED`: قطع ارتباط با پایانه، پایان مهلت یا پاسخ نامفهوم. کیوسک تلاش نامشخص را با `inquire` پیگیری می‌کند و مشتری دوباره پول نمی‌دهد.
- **`attemptId` شماره درخواست یا مرجع تراکنش در پایانه باشد** (اگر SDK اجازه می‌دهد)، تا `inquire` بعدی همان تراکنش را پیدا کند.
- **یک فروش در هر لحظه.** در طول فروش، کیوسک `status` نمی‌فرستد. استعلام تلاش‌های قبلی ممکن است برسد؛ برنامه می‌تواند آن را پس از پایان فروش پاسخ دهد.
- **اطلاعات کارت (شماره کارت، CVV، رمز) هرگز** در خروجی، گزارش یا پاسخ نیاید. پایانه فقط شماره‌های مرجع برمی‌گرداند.
- **خروج با بسته شدن stdin:** وقتی stdin بسته شد، برنامه خارج شود؛ کیوسک در حال بسته شدن است.

کیوسک خودش هم ایمن رفتار می‌کند:
- اگر برنامه کمکی وسط فروش متوقف شود یا تا پایان مهلت پاسخ ندهد، نتیجه `UNKNOWN` است.
- برنامه کمکی برای درخواست بعدی دوباره اجرا می‌شود.

## اسکلت برنامه کمکی (C#)

نمونه زیر فقط حلقه پروتکل است. فراخوانی‌های SDK با `TODO` مشخص شده‌اند و پس از دریافت SDK و مستند آسان پرداخت تکمیل می‌شوند.

```csharp
// pos-helper: bridge between the kiosk (JSON lines on stdin/stdout) and the PSP's PC-POS SDK.
using System.Text.Json;
using System.Text.Json.Nodes;

Console.InputEncoding = Console.OutputEncoding = new System.Text.UTF8Encoding(false);
string? line;
while ((line = Console.ReadLine()) != null) // null: the kiosk closed stdin, exit
{
    JsonNode? req;
    try { req = JsonNode.Parse(line); } catch { Console.Error.WriteLine("bad request line"); continue; }
    var id = req?["id"]?.GetValue<string>();
    if (id == null) continue;
    JsonObject reply;
    try
    {
        reply = req!["cmd"]?.GetValue<string>() switch
        {
            "status" => new JsonObject { ["state"] = "OK", ["detail"] = "connected" }, // TODO: ask the SDK
            "sale" => Sale(req["amountRial"]!.GetValue<long>(), req["attemptId"]!.GetValue<string>()),
            "inquire" => Inquire(req["attemptId"]!.GetValue<string>()),
            "cancel" => new JsonObject { ["cancelled"] = false }, // TODO: if the SDK supports it
            _ => new JsonObject { ["outcome"] = "UNKNOWN", ["message"] = "unknown command" },
        };
    }
    catch (Exception e)
    {
        Console.Error.WriteLine(e.Message);
        reply = new JsonObject { ["outcome"] = "UNKNOWN", ["message"] = "خطای ارتباط با پایانه" };
    }
    reply["id"] = id;
    Console.WriteLine(reply.ToJsonString());
}

static JsonObject Sale(long amountRial, string attemptId)
{
    // TODO: send the sale to the terminal with the SDK (attemptId as the request/reference number),
    // map approved → PAID, declined → FAILED, cancelled → CANCELLED, anything unclear → UNKNOWN.
    return new JsonObject { ["outcome"] = "UNKNOWN", ["message"] = "SDK not connected" };
}

static JsonObject Inquire(string attemptId)
{
    // TODO: query the terminal/bank for this transaction with the SDK.
    return new JsonObject { ["outcome"] = "UNKNOWN", ["message"] = "SDK not connected" };
}
```

## آزمون

- **نمونه مرجع پروتکل:** `apps/kiosk/test/fixtures/fake-pos-helper.mjs`. با این دستور قابل اجراست:

  ```
  node fake-pos-helper.mjs approve
  ```

- **آزمون خودکار سمت کیوسک:**

  ```
  pnpm --filter @andishkadeh/kiosk exec vitest run test/payment-helper.test.ts
  ```

- **با پایانه واقعی، پیش از بهره‌برداری:**
  1. فروش با مبلغ کم.
  2. رد با کارت بدون موجودی.
  3. لغو روی پایانه.
  4. قطع کابل شبکه پایانه وسط تراکنش. کیوسک باید «نامشخص» نشان دهد و بعداً با استعلام تعیین تکلیف کند.
  5. بستن و باز کردن برنامه کیوسک.
- **تطبیق با بانک:** نتیجه همه موارد بالا در پنل ← «پرداخت‌ها» با گزارش بانک تطبیق داده شود.
