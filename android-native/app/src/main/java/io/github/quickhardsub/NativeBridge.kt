package io.github.quickhardsub

import android.app.Activity
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import org.json.JSONObject

class NativeBridge(
    private val activity: Activity,
    private val webView: WebView
) {
    @JavascriptInterface
    fun getBackendInfo(): String {
        return JSONObject()
            .put("available", true)
            .put("backend", "android-native")
            .put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
            .put("apiLevel", Build.VERSION.SDK_INT)
            .put("ffmpegKitVersion", FFmpegKitConfig.getVersion())
            .put("mediaCodecBuiltIn", true)
            .toString()
    }

    @JavascriptInterface
    fun cancelAll() {
        FFmpegKit.cancel()
    }
}
