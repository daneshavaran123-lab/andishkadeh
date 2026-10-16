package ir.andishkadeh.kiosk;

import android.app.Activity;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;

/**
 * Receipt printing through the Android print service (any printer with an installed print
 * service plugin). The receipt HTML comes from the shared kiosk core (80 mm layout).
 * Android may show its print dialog; silent printing to a specific thermal printer needs that
 * printer vendor's SDK and is a separate adapter to be connected once the model is confirmed.
 * The call resolves only when the print job is completed, failed or cancelled (or times out and
 * is cancelled), so the kiosk never reports a receipt as printed while it is still queued.
 */
@CapacitorPlugin(name = "KioskPrinter")
public class KioskPrinterPlugin extends Plugin {

    /** 80 mm roll; the height only bounds one page, the receipt layout sets the real length. */
    private static final PrintAttributes.MediaSize RECEIPT_80MM = new PrintAttributes.MediaSize("RECEIPT_80MM", "Receipt 80 mm", 3150, 11690);
    private static final long POLL_MS = 500;
    /** Includes the time the customer may need to confirm the system print dialog. */
    private static final long TIMEOUT_MS = 120_000;

    /** Off-screen views stay alive until their job is settled (several receipts may be in flight). */
    private final Set<WebView> printViews = new HashSet<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void print(final PluginCall call) {
        final String html = call.getString("html");
        final String jobName = call.getString("jobName", "receipt");
        final Activity activity = getActivity();
        if (html == null || html.isEmpty()) {
            call.reject("html is required");
            return;
        }
        if (activity == null) {
            respond(call, false, "activity unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            final WebView view;
            try {
                view = new WebView(activity);
            } catch (RuntimeException e) {
                respond(call, false, e.getMessage());
                return;
            }
            printViews.add(view);
            try {
                view.getSettings().setJavaScriptEnabled(false);
                view.setWebViewClient(new WebViewClient() {
                    private boolean sent = false;

                    @Override
                    public void onPageFinished(WebView v, String url) {
                        if (sent) {
                            return;
                        }
                        sent = true;
                        try {
                            PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                            if (pm == null) {
                                finish(call, v, false, "print service unavailable");
                                return;
                            }
                            PrintDocumentAdapter adapter = v.createPrintDocumentAdapter(jobName);
                            PrintAttributes attributes = new PrintAttributes.Builder()
                                .setMediaSize(RECEIPT_80MM)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();
                            PrintJob job = pm.print(jobName, adapter, attributes);
                            watch(call, job, v, SystemClock.uptimeMillis() + TIMEOUT_MS);
                        } catch (RuntimeException e) {
                            finish(call, v, false, e.getMessage());
                        }
                    }
                });
                view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (RuntimeException e) {
                finish(call, view, false, e.getMessage());
            }
        });
    }

    private void watch(final PluginCall call, final PrintJob job, final WebView view, final long deadline) {
        if (job == null) {
            finish(call, view, false, "print job was not created");
        } else if (job.isCompleted()) {
            finish(call, view, true, null);
        } else if (job.isFailed()) {
            finish(call, view, false, "print job failed");
        } else if (job.isCancelled()) {
            finish(call, view, false, "print job cancelled");
        } else if (SystemClock.uptimeMillis() > deadline) {
            // Cancel so a late print cannot duplicate the receipt the customer may print again.
            job.cancel();
            finish(call, view, false, "print job timed out");
        } else {
            main.postDelayed(() -> watch(call, job, view, deadline), POLL_MS);
        }
    }

    private void finish(PluginCall call, WebView view, boolean ok, String detail) {
        if (printViews.remove(view)) {
            view.destroy();
        }
        respond(call, ok, detail);
    }

    private static void respond(PluginCall call, boolean ok, String detail) {
        JSObject result = new JSObject();
        result.put("ok", ok);
        if (detail != null) {
            result.put("detail", detail);
        }
        call.resolve(result);
    }
}
