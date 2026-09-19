package io.github.quickhardsub

import android.app.Activity
import android.os.Build
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

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
            .put("mediaCodecEncodingDefault", false)
            .toString()
    }

    @JavascriptInterface
    fun runSelfTest() {
        thread(name = "native-hardsub-selftest") {
            val result = JSONObject()
            result.put("available", true)

            try {
                val encoders = FFmpegKit.execute("-hide_banner -encoders").output
                val decoders = FFmpegKit.execute("-hide_banner -decoders").output
                val filters = FFmpegKit.execute("-hide_banner -filters").output

                result.put("x264", Regex("""\\blibx264\\b""").containsMatchIn(encoders))
                result.put("x265", Regex("""\\blibx265\\b""").containsMatchIn(encoders))
                result.put("svtAv1", Regex("""\\blibsvtav1\\b""").containsMatchIn(encoders))
                result.put("dav1d", Regex("""\\blibdav1d\\b""").containsMatchIn(decoders))
                result.put("assFilter", Regex("""\\bass\\b""").containsMatchIn(filters))
                result.put("h264MediaCodec", encoders.contains("h264_mediacodec"))
                result.put("hevcMediaCodec", encoders.contains("hevc_mediacodec"))
                result.put("av1MediaCodec", encoders.contains("av1_mediacodec"))

                FFmpegKitConfig.setFontDirectoryList(
                    activity,
                    listOf("/system/fonts"),
                    emptyMap<String?, String?>()
                )

                val assFile = File(activity.cacheDir, "native_hardsub_selftest.ass")
                val outFile = File(activity.cacheDir, "native_hardsub_selftest.mkv")
                outFile.delete()
                assFile.writeText(
                    """
                    [Script Info]
                    ScriptType: v4.00+
                    PlayResX: 320
                    PlayResY: 180

                    [V4+ Styles]
                    Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
                    Style: Default,sans-serif,28,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,18,1

                    [Events]
                    Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
                    Dialogue: 0,0:00:00.00,0:00:00.80,Default,,0,0,0,,native libass test
                    """.trimIndent()
                )

                val command =
                    "-y -f lavfi -i color=c=black:s=320x180:r=24:d=1 " +
                    "-vf \"ass='\${assFile.absolutePath}':fontsdir='/system/fonts'\" " +
                    "-c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -an '\${outFile.absolutePath}'"

                val session = FFmpegKit.execute(command)
                val encodeOk = ReturnCode.isSuccess(session.returnCode) && outFile.length() > 0
                result.put("softwareEncodeSmoke", encodeOk)

                if (encodeOk) {
                    val probe = FFprobeKit.getMediaInformation(outFile.absolutePath)
                    val info = probe.mediaInformation
                    result.put("ffprobeSmoke", info != null)
                    result.put("smokeBytes", outFile.length())
                } else {
                    result.put("ffprobeSmoke", false)
                    result.put("error", session.output.takeLast(1200))
                }

                assFile.delete()
                outFile.delete()
            } catch (e: Throwable) {
                result.put("softwareEncodeSmoke", false)
                result.put("ffprobeSmoke", false)
                result.put("error", e.message ?: e.javaClass.simpleName)
            }

            val quoted = JSONObject.quote(result.toString())
            activity.runOnUiThread {
                webView.evaluateJavascript(
                    "window.__onNativeSelfTest && window.__onNativeSelfTest($quoted);",
                    null
                )
            }
        }
    }

    @JavascriptInterface
    fun cancelAll() {
        FFmpegKit.cancel()
    }
}
