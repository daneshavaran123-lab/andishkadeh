package ir.andishkadeh.kiosk;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Kiosk shell around the web app: full screen (system bars hidden; a swipe shows them only
 * briefly), screen always on, and lock task mode whenever the device owner allows this app
 * (dedicated-device provisioning, see docs/android-kiosk-install.md). Without that policy the
 * app still runs full screen, but a user could leave it with the system gestures.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KioskPrinterPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        startLockTaskIfPermitted();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    private void startLockTaskIfPermitted() {
        DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (dpm == null || am == null || !dpm.isLockTaskPermitted(getPackageName())) {
            return;
        }
        if (am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE) {
            return;
        }
        try {
            startLockTask();
        } catch (IllegalStateException | SecurityException e) {
            // Not allowed right now (e.g. policy changed): keep running full screen.
        }
    }
}
