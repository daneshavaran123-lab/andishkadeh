package ir.andishkadeh.kiosk;

import android.app.Activity;
import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Receipt printing through the Android print service (any printer with an installed print
 * service plugin). The receipt HTML comes from the shared kiosk core (80 mm layout).
 * Android may show its print dialog; silent printing to a specific thermal printer needs that
 * printer vendor's SDK and is a separate adapter to be connected once the model is confirmed.
 */
@CapacitorPlugin(name = "KioskPrinter")
public class KioskPrinterPlugin extends Plugin {

    /** 80 mm roll; the height only bounds one page, the receipt layout sets the real length. */
    private static final PrintAttributes.MediaSize RECEIPT_80MM = new PrintAttributes.MediaSize("RECEIPT_80MM", "Receipt 80 mm", 3150, 11690);

    /** Keeps the off-screen view alive until the print job has been handed to the print service. */
    private WebView printView;

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
            try {
                final WebView view = new WebView(activity);
                view.getSettings().setJavaScriptEnabled(false);
                view.setWebViewClient(new WebViewClient() {
                    private boolean sent = false;

                    @Override
                    public void onPageFinished(WebView v, String url) {
                        if (sent) {
                            return;
                        }
                        sent = true;
                        PrintManager pm = (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                        if (pm == null) {
                            respond(call, false, "print service unavailable");
                            return;
                        }
                        PrintDocumentAdapter adapter = v.createPrintDocumentAdapter(jobName);
                        PrintAttributes attributes = new PrintAttributes.Builder()
                            .setMediaSize(RECEIPT_80MM)
                            .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                            .build();
                        pm.print(jobName, adapter, attributes);
                        respond(call, true, null);
                    }
                });
                printView = view;
                view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (RuntimeException e) {
                respond(call, false, e.getMessage());
            }
        });
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
