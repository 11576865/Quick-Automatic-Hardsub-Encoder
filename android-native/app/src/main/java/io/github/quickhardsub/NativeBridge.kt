package io.github.quickhardsub

import android.app.Activity
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.storage.StorageManager
import android.system.Os
import android.system.OsConstants
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
    @Volatile
    private var nextPickerRole: String? = null

    private val pickedUris = mutableMapOf<String, List<Uri>>()
    private val pickerLock = Any()

    @JavascriptInterface
    fun preparePickerRole(role: String) {
        nextPickerRole = when (role) {
            "video", "ass", "fonts" -> role
            else -> null
        }
    }

    fun consumePickerRole(): String? {
        val role = nextPickerRole
        nextPickerRole = null
        return role
    }

    fun recordPickedUris(role: String?, uris: List<Uri>) {
        if (role == null) return
        synchronized(pickerLock) {
            if (uris.isEmpty()) pickedUris.remove(role)
            else pickedUris[role] = uris.toList()
        }
    }

    fun getPickedUris(role: String): List<Uri> =
        synchronized(pickerLock) { pickedUris[role]?.toList() ?: emptyList() }

    @JavascriptInterface
    fun getNativeSelectionState(): String {
        val snapshot = synchronized(pickerLock) {
            mapOf(
                "video" to (pickedUris["video"]?.size ?: 0),
                "ass" to (pickedUris["ass"]?.size ?: 0),
                "fonts" to (pickedUris["fonts"]?.size ?: 0)
            )
        }

        return JSONObject()
            .put("video", snapshot["video"])
            .put("ass", snapshot["ass"])
            .put("fonts", snapshot["fonts"])
            .toString()
    }
    @JavascriptInterface
    fun probeSelectedVideo() {
        thread(name = "native-input-probe") {
            val result = JSONObject()
            val uri = getPickedUris("video").firstOrNull()

            if (uri == null) {
                result.put("ok", false)
                result.put("error", "没有可供原生后端访问的视频 URI")
                postJsonCallback("__onNativeInputProbe", result)
                return@thread
            }

            var safUrl: String? = null
            try {
                var statSize = -1L
                var seekable = false
                activity.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                    statSize = pfd.statSize
                    seekable = try {
                        Os.lseek(pfd.fileDescriptor, 0L, OsConstants.SEEK_CUR)
                        true
                    } catch (_: Throwable) {
                        false
                    }
                }

                safUrl = FFmpegKitConfig.getSafParameterForRead(activity, uri, true)
                if (safUrl.isNullOrBlank()) throw IllegalStateException("无法创建 FFmpegKit SAF 读取 URL")

                val probe = FFprobeKit.getMediaInformation(safUrl)
                val info = probe.getMediaInformation()
                    ?: throw IllegalStateException(probe.getOutput().takeLast(1200).ifBlank { "FFprobe 无法读取该 URI" })

                val streams = info.getStreams()
                val video = streams.firstOrNull { it.getType() == "video" }
                    ?: throw IllegalStateException("FFprobe 没有发现视频流")
                val audioTracks = streams.count { it.getType() == "audio" }

                result
                    .put("ok", true)
                    .put("seekable", seekable)
                    .put("statSize", statSize)
                    .put("needsInputStaging", !seekable)
                    .put("format", info.getFormat() ?: "")
                    .put("duration", info.getDuration()?.toDoubleOrNull() ?: 0.0)
                    .put("videoCodec", video.getCodec() ?: "")
                    .put("width", video.getWidth() ?: 0)
                    .put("height", video.getHeight() ?: 0)
                    .put("fps", video.getAverageFrameRate() ?: "")
                    .put("audioTracks", audioTracks)
            } catch (e: Throwable) {
                result.put("ok", false)
                result.put("error", e.message ?: e.javaClass.simpleName)
            } finally {
                if (!safUrl.isNullOrBlank()) {
                    try { FFmpegKitConfig.unregisterSafProtocolUrl(safUrl) } catch (_: Throwable) {}
                }
                try { FFmpegKitConfig.clearSessions() } catch (_: Throwable) {}
            }

            postJsonCallback("__onNativeInputProbe", result)
        }
    }

    private fun postJsonCallback(callbackName: String, result: JSONObject) {
        val quoted = JSONObject.quote(result.toString())
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.$callbackName && window.$callbackName($quoted);",
                null
            )
        }
    }

    private fun getStagingAllocatableBytes(): Long {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val storage = activity.getSystemService(StorageManager::class.java)
                val uuid = storage.getUuidForPath(activity.filesDir)
                storage.getAllocatableBytes(uuid)
            } else {
                activity.filesDir.usableSpace
            }
        } catch (_: Throwable) {
            activity.filesDir.usableSpace
        }
    }

    private fun getThermalStatus(): Int? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return try {
            activity.getSystemService(PowerManager::class.java).currentThermalStatus
        } catch (_: Throwable) {
            null
        }
    }

    @JavascriptInterface
    fun getBackendInfo(): String {
        val power = activity.getSystemService(PowerManager::class.java)
        return JSONObject()
            .put("available", true)
            .put("backend", "android-native")
            .put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
            .put("apiLevel", Build.VERSION.SDK_INT)
            .put("ffmpegKitVersion", FFmpegKitConfig.getVersion())
            .put("mediaCodecBuiltIn", true)
            .put("mediaCodecEncodingDefault", false)
            .put("stagingAllocatableBytes", getStagingAllocatableBytes())
            .put("thermalStatus", getThermalStatus())
            .put("powerSaveMode", power.isPowerSaveMode)
            .put("sustainedPerformanceSupported", power.isSustainedPerformanceModeSupported)
            .toString()
    }

    private fun prepareNativeFonts(): Pair<List<String>, Boolean> {
        val fontDirs = mutableListOf<String>()

        listOf(
            "/system/fonts",
            "/product/fonts",
            "/system_ext/fonts"
        ).forEach { path ->
            if (File(path).isDirectory) fontDirs.add(path)
        }

        var bundledFallbackReady = false
        try {
            val appFontDir = File(activity.filesDir, "fonts")
            if (!appFontDir.exists()) appFontDir.mkdirs()

            val fallback = File(appFontDir, "NotoSansSC-Regular.otf")
            if (!fallback.exists() || fallback.length() == 0L) {
                activity.assets.open("www/vendor/fallback-fonts/NotoSansSC-Regular.otf").use { input ->
                    fallback.outputStream().use { output -> input.copyTo(output) }
                }
            }

            if (fallback.isFile && fallback.length() > 0L) {
                bundledFallbackReady = true
                fontDirs.add(appFontDir.absolutePath)
            }
        } catch (_: Throwable) {
            bundledFallbackReady = false
        }

        FFmpegKitConfig.setFontDirectoryList(
            activity,
            fontDirs.distinct(),
            emptyMap<String?, String?>()
        )

        return fontDirs.distinct() to bundledFallbackReady
    }

    private fun executeOk(args: Array<String>): Pair<Boolean, String> {
        val session = FFmpegKit.executeWithArguments(args)
        val ok = ReturnCode.isSuccess(session.getReturnCode())
        return ok to session.getOutput()
    }

    private fun codecSmoke(
        encoder: String,
        presetArgs: Array<String>,
        output: File
    ): Pair<Boolean, String> {
        output.delete()
        val args = mutableListOf(
            "-y",
            "-f", "lavfi",
            "-i", "testsrc2=size=160x96:rate=12:duration=0.5",
            "-an",
            "-frames:v", "6",
            "-c:v", encoder
        )
        args.addAll(presetArgs.asList())
        args.addAll(listOf("-pix_fmt", "yuv420p", output.absolutePath))

        val (encodeOk, logs) = executeOk(args.toTypedArray())
        if (!encodeOk || output.length() <= 0) {
            return false to logs
        }

        val probe = FFprobeKit.getMediaInformation(output.absolutePath)
        return (probe.getMediaInformation() != null) to logs
    }

    private fun libassVisualSmoke(assFile: File, fallbackFontDir: String): Pair<Boolean, String> {
        val base = File(activity.cacheDir, "native_hardsub_selftest_base.raw")
        val sub = File(activity.cacheDir, "native_hardsub_selftest_sub.raw")
        base.delete()
        sub.delete()

        val common = arrayOf(
            "-y",
            "-f", "lavfi",
            "-i", "color=c=black:s=320x180:r=1:d=1",
            "-frames:v", "1",
            "-pix_fmt", "rgb24"
        )

        val baseArgs = common + arrayOf("-f", "rawvideo", base.absolutePath)
        val (baseOk, baseLogs) = executeOk(baseArgs)
        if (!baseOk || base.length() <= 0) return false to baseLogs

        val subArgs = arrayOf(
            "-y",
            "-f", "lavfi",
            "-i", "color=c=black:s=320x180:r=1:d=1",
            "-vf", "ass=${assFile.absolutePath}:fontsdir=${fallbackFontDir}",
            "-frames:v", "1",
            "-pix_fmt", "rgb24",
            "-f", "rawvideo",
            sub.absolutePath
        )
        val (subOk, subLogs) = executeOk(subArgs)
        if (!subOk || sub.length() <= 0) return false to subLogs

        val different = !base.readBytes().contentEquals(sub.readBytes())
        base.delete()
        sub.delete()
        return different to subLogs
    }

    @JavascriptInterface
    fun runSelfTest() {
        thread(name = "native-hardsub-selftest") {
            val result = JSONObject()
            result.put("available", true)

            val tempFiles = mutableListOf<File>()
            try {
                // Keep only a small bounded history. FFmpegKit sessions retain logs and
                // callbacks, so an unbounded history is undesirable for a long-running app.
                FFmpegKitConfig.setSessionHistorySize(12)

                val encoders = FFmpegKit.executeWithArguments(arrayOf("-hide_banner", "-encoders")).getOutput()
                val decoders = FFmpegKit.executeWithArguments(arrayOf("-hide_banner", "-decoders")).getOutput()
                val filters = FFmpegKit.executeWithArguments(arrayOf("-hide_banner", "-filters")).getOutput()

                val hasX264 = Regex("""\blibx264\b""").containsMatchIn(encoders)
                val hasX265 = Regex("""\blibx265\b""").containsMatchIn(encoders)
                val hasSvt = Regex("""\blibsvtav1\b""").containsMatchIn(encoders)
                val hasDav1d = Regex("""\blibdav1d\b""").containsMatchIn(decoders)
                val hasAss = Regex("""\bass\b""").containsMatchIn(filters)

                result.put("x264", hasX264)
                result.put("x265", hasX265)
                result.put("svtAv1", hasSvt)
                result.put("dav1d", hasDav1d)
                result.put("assFilter", hasAss)
                result.put("h264MediaCodec", encoders.contains("h264_mediacodec"))
                result.put("hevcMediaCodec", encoders.contains("hevc_mediacodec"))
                result.put("av1MediaCodec", encoders.contains("av1_mediacodec"))

                val (nativeFontDirs, bundledFallbackReady) = prepareNativeFonts()
                result.put("fontDirs", nativeFontDirs.joinToString(" | "))
                result.put("bundledFallbackReady", bundledFallbackReady)

                val assFile = File(activity.cacheDir, "native_hardsub_selftest.ass")
                tempFiles.add(assFile)
                assFile.writeText(
                    """
                    [Script Info]
                    ScriptType: v4.00+
                    PlayResX: 320
                    PlayResY: 180

                    [V4+ Styles]
                    Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
                    Style: Default,Noto Sans SC,28,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,18,1

                    [Events]
                    Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
                    Dialogue: 0,0:00:00.00,0:00:00.80,Default,,0,0,0,,native libass test
                    """.trimIndent()
                )

                val fallbackFontDir = nativeFontDirs.lastOrNull { it.startsWith(activity.filesDir.absolutePath) }
                    ?: nativeFontDirs.firstOrNull()
                    ?: "/system/fonts"
                val libassVisual = if (hasAss && bundledFallbackReady) {
                    libassVisualSmoke(assFile, fallbackFontDir)
                } else {
                    false to if (!hasAss) "ass filter missing" else "bundled fallback font unavailable"
                }
                result.put("libassVisualSmoke", libassVisual.first)
                if (!libassVisual.first) {
                    result.put("libassError", libassVisual.second.takeLast(1200))
                }

                val x264Out = File(activity.cacheDir, "native_hardsub_selftest_x264.mkv")
                val x265Out = File(activity.cacheDir, "native_hardsub_selftest_x265.mkv")
                val av1Out = File(activity.cacheDir, "native_hardsub_selftest_av1.mkv")
                tempFiles.addAll(listOf(x264Out, x265Out, av1Out))

                val x264Smoke = if (hasX264) {
                    codecSmoke("libx264", arrayOf("-preset", "ultrafast", "-crf", "30"), x264Out)
                } else false to "libx264 missing"

                val x265Smoke = if (hasX265) {
                    codecSmoke("libx265", arrayOf("-preset", "ultrafast", "-crf", "32"), x265Out)
                } else false to "libx265 missing"

                val av1Smoke = if (hasSvt) {
                    codecSmoke(
                        "libsvtav1",
                        arrayOf("-preset", "12", "-crf", "40", "-svtav1-params", "lp=2"),
                        av1Out
                    )
                } else false to "libsvtav1 missing"

                result.put("x264EncodeSmoke", x264Smoke.first)
                result.put("x265EncodeSmoke", x265Smoke.first)
                result.put("svtAv1EncodeSmoke", av1Smoke.first)

                if (!x264Smoke.first) result.put("x264Error", x264Smoke.second.takeLast(1200))
                if (!x265Smoke.first) result.put("x265Error", x265Smoke.second.takeLast(1200))
                if (!av1Smoke.first) result.put("svtAv1Error", av1Smoke.second.takeLast(1200))

                val allSoftwareSmoke =
                    libassVisual.first &&
                    x264Smoke.first &&
                    x265Smoke.first &&
                    av1Smoke.first

                result.put("softwareEncodeSmoke", allSoftwareSmoke)
                result.put("ffprobeSmoke", x264Smoke.first && x265Smoke.first && av1Smoke.first)
            } catch (e: Throwable) {
                result.put("softwareEncodeSmoke", false)
                result.put("ffprobeSmoke", false)
                result.put("error", e.message ?: e.javaClass.simpleName)
            } finally {
                tempFiles.forEach { file ->
                    try { file.delete() } catch (_: Throwable) {}
                }
                try { FFmpegKitConfig.clearSessions() } catch (_: Throwable) {}
            }

            postJsonCallback("__onNativeSelfTest", result)
        }
    }

    @JavascriptInterface
    fun cancelAll() {
        FFmpegKit.cancel()
    }
}
